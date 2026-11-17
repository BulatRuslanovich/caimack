// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkedBody,
  download,
  fileInfo,
  serveFile,
  transfer,
} from "./files.mjs";
import { digest, uuid } from "./storage.mjs";

const manifestType = "application/vnd.apple.mpegurl";
const assetRoute =
  /^\/api\/(albums|artists|playlists|tracks)\/([0-9a-f-]+)\/(cover|image)$/i;
const audioRoute = /^\/api\/tracks\/([0-9a-f-]+)\/(stream|hls\/.+)$/i;

export function isTrack(track) {
  return (
    track &&
    typeof track.id === "string" &&
    uuid.test(track.id) &&
    typeof track.title === "string" &&
    typeof track.artistName === "string"
  );
}

export class Assets {
  constructor(db, scope, directory, server) {
    this.db = db;
    this.prefix = scope + ":asset:";
    this.directory = join(directory, "artwork");
    this.server = server;
    this.inFlight = new Map();
  }

  key(path) {
    return path.split("?")[0];
  }

  record(path) {
    return this.db.get(this.prefix + this.key(path));
  }

  async serve(request, path) {
    const saved = this.record(path);
    return (
      saved &&
      serveFile(request, join(this.directory, saved.file), saved.contentType)
    );
  }

  async save(
    path,
    { force = false, version, signal, lan = false, response } = {},
  ) {
    if (!assetRoute.test(path)) {
      await response?.body?.cancel();
      return;
    }
    const key = this.key(path);
    const existing = this.inFlight.get(key);
    if (existing) {
      await response?.body?.cancel();
      return existing;
    }
    const work = this.retain(key, {
      force,
      version,
      signal,
      lan,
      response,
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  async retain(path, { force, version, signal, lan, response }) {
    const prior = this.record(path);
    const file = prior && (await fileInfo(join(this.directory, prior.file)));
    if (
      file &&
      !force &&
      (version
        ? version === prior.version
        : Date.now() - prior.checkedAt < 3600000)
    ) {
      await response?.body?.cancel();
      return;
    }
    response ??= await this.server.request(path, {
      headers: file && prior.etag ? { "If-None-Match": prior.etag } : {},
      signal,
      lan,
    });
    if (response.status === 304 && file) {
      this.db.set(this.prefix + path, {
        ...prior,
        checkedAt: Date.now(),
        version,
      });
      return;
    }
    const type = response.headers.get("content-type")?.split(";")[0];
    if (
      !response.ok ||
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/avif",
      ].includes(type)
    ) {
      await response.body?.cancel();
      return;
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const name = digest(path) + ".image";
    const target = join(this.directory, name);
    try {
      await transfer(response, target + ".part", {
        signal,
        onProgress(bytes) {
          if (bytes > 32 * 1024 * 1024)
            throw new Error("Artwork exceeds 32 MiB.");
        },
      });
      await rename(target + ".part", target);
      this.db.set(this.prefix + path, {
        file: name,
        contentType: type,
        etag: response.headers.get("etag"),
        version,
        checkedAt: Date.now(),
      });
    } finally {
      await rm(target + ".part", { force: true });
    }
  }

  trackArtwork(track) {
    const paths = [];
    if (track.hasCover) {
      paths.push("/api/tracks/" + track.id + "/cover");
      if (uuid.test(track.albumId ?? ""))
        paths.push("/api/albums/" + track.albumId + "/cover");
    }
    const artists = new Set([
      track.artistId,
      ...(track.artists ?? []).map((artist) => artist.id),
    ]);
    for (const id of artists)
      if (uuid.test(id ?? "")) paths.push("/api/artists/" + id + "/image");
    return paths;
  }
}

export class Downloads {
  constructor(db, scope, directory, server, catalog, assets, canRun) {
    this.db = db;
    this.prefix = scope + ":download:";
    this.directory = join(directory, "downloads");
    this.server = server;
    this.catalog = catalog;
    this.assets = assets;
    this.canRun = canRun;
    this.jobs = new Map();
    this.removing = new Set();
    this.detailsInFlight = new Map();
    this.detailChecks = new Map();
    this.abort = new AbortController();
    for (const [key, item] of db.entries(this.prefix)) {
      if (item.status === "running") db.set(key, { ...item, status: "queued" });
    }
  }

  entries() {
    return this.db
      .entries(this.prefix)
      .map(([, item]) => this.jobs.get(item.track.id)?.item ?? item);
  }

  item(id) {
    return this.db.get(this.prefix + id);
  }

  path(id) {
    return join(this.directory, id);
  }

  add(tracks, quality, automatic = false) {
    this.db.transaction(() => {
      for (const track of tracks) {
        if (!isTrack(track) || this.removing.has(track.id)) continue;
        const old = this.item(track.id);
        this.catalog.rememberTrack(track);
        if (old && old.status !== "failed") {
          if (old.automatic && !automatic) {
            this.db.set(this.prefix + track.id, { ...old, automatic: false });
            const running = this.jobs.get(track.id);
            if (running) running.item.automatic = false;
          }
          continue;
        }
        this.db.set(this.prefix + track.id, {
          ...old,
          track,
          quality,
          automatic,
          status: "queued",
          error: null,
          bytes: old?.bytes ?? 0,
          total: old?.total ?? null,
        });
      }
    });
    this.pump();
  }

  pump() {
    if (!this.canRun() || this.abort.signal.aborted) return;
    for (const item of this.entries()) {
      if (this.jobs.size >= 2) break;
      const { id } = item.track;
      if (
        item.status !== "queued" ||
        this.jobs.has(id) ||
        this.removing.has(id)
      )
        continue;
      const controller = new AbortController();
      const work = {
        controller,
        item: { ...item, status: "running" },
        done: null,
      };
      this.jobs.set(id, work);
      this.db.set(this.prefix + id, work.item);
      work.done = this.run(work)
        .catch((error) => {
          const paused = controller.signal.aborted;
          this.db.set(this.prefix + id, {
            ...work.item,
            status: paused ? "queued" : "failed",
            error: paused ? null : error.message,
          });
        })
        .finally(() => {
          this.jobs.delete(id);
          this.pump();
        });
    }
  }

  pause() {
    for (const { controller } of this.jobs.values()) controller.abort();
  }

  async close() {
    this.abort.abort();
    this.pause();
    await Promise.allSettled([...this.jobs.values()].map((job) => job.done));
  }

  async remove(id) {
    if (!uuid.test(id) || this.removing.has(id)) return;
    this.removing.add(id);
    try {
      const work = this.jobs.get(id);
      work?.controller.abort();
      await work?.done;
      await rm(this.path(id), { recursive: true, force: true, maxRetries: 3 });
      this.db.delete(this.prefix + id);
    } finally {
      this.removing.delete(id);
      this.pump();
    }
  }

  async run(work) {
    const { item } = work;
    const { id } = item.track;
    const signal = work.controller.signal;
    const directory = this.path(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const hls =
      item.quality !== "Original" && (await this.hls(work, directory, signal));
    if (hls) {
      item.source = "hls";
    } else {
      const target = join(directory, "original");
      const part = target + ".part";
      const result = await download(
        (headers) =>
          this.server.request("/api/tracks/" + id + "/stream", {
            headers,
            signal,
          }),
        part,
        {
          etag: item.etag,
          total: item.total ?? undefined,
          signal,
          onHeaders: (etag, total, contentType) => {
            item.etag = etag;
            item.total = total;
            item.contentType = contentType ?? "application/octet-stream";
            this.db.set(this.prefix + id, item);
          },
          onProgress: (bytes) => {
            item.bytes = bytes;
          },
        },
      );
      signal.throwIfAborted();
      await rename(part, target);
      item.source = "original";
      item.bytes = result.size;
      item.total = result.size;
    }
    signal.throwIfAborted();
    this.db.set(this.prefix + id, { ...item, status: "complete", error: null });
    this.refreshDetails(item.track);
  }

  async hls(work, directory, signal) {
    const { item } = work;
    const base = "/api/tracks/" + item.track.id + "/hls/";
    const response = await this.server.request(
      base + "master.m3u8?maxQuality=" + item.quality,
      { signal },
    );
    if (
      response.status === 204 ||
      response.status === 404 ||
      response.status === 425
    ) {
      await response.body?.cancel();
      return false;
    }
    await checkedBody(response);
    const lines = (await response.text()).trim().split(/\r?\n/);
    const candidates = lines.flatMap((line, index) =>
      /^(?:low|normal)\/[a-z0-9_-]+\.m3u8$/i.test(line) &&
      lines[index - 1]?.startsWith("#EXT-X-STREAM-INF:")
        ? [{ path: line, info: lines[index - 1] }]
        : [],
    );
    const variant =
      candidates.find(({ path }) =>
        path.startsWith(item.quality.toLowerCase() + "/"),
      ) ?? candidates.at(-1);
    if (!variant) return false;
    const playlist = await this.server.request(base + variant.path, { signal });
    await checkedBody(playlist);
    const playlistText = await playlist.text();
    if (!playlistText.includes("#EXT-X-ENDLIST"))
      throw new Error("Incomplete HLS playlist.");
    const names = playlistText
      .split(/\r?\n/)
      .flatMap((line) =>
        line && !line.startsWith("#")
          ? [line]
          : [...line.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]),
      );
    if (
      !names.length ||
      names.some((name) => !/^[a-z0-9_-]+\.(?:m4s|mp4|aac|ts)$/i.test(name))
    ) {
      throw new Error("Invalid HLS asset name.");
    }
    const version = digest((playlist.headers.get("etag") ?? "") + playlistText);
    const hlsDirectory = join(directory, "hls");
    if (item.variantVersion !== version) {
      await rm(hlsDirectory, { recursive: true, force: true });
      item.variantVersion = version;
      item.hlsAssets = {};
      item.bytes = 0;
      item.total = null;
      this.db.set(this.prefix + item.track.id, item);
    }
    await mkdir(hlsDirectory, { recursive: true, mode: 0o700 });
    const stem = variant.path.split("/")[0] + "/";
    let complete = 0;
    for (const name of new Set(names)) {
      const filename = join(hlsDirectory, name);
      const stat = item.hlsAssets[name] && (await fileInfo(filename));
      if (stat) {
        complete += stat.size;
        continue;
      }
      const partial =
        item.partialAsset?.name === name ? item.partialAsset : null;
      const result = await download(
        (headers) =>
          this.server.request(base + stem + name, { signal, headers }),
        filename + ".part",
        {
          signal,
          etag: partial?.etag,
          total: partial?.size ?? undefined,
          onHeaders: (etag, size, type) => {
            item.partialAsset = { name, etag, size, type };
            this.db.set(this.prefix + item.track.id, item);
          },
          onProgress: (bytes) => {
            item.bytes = complete + bytes;
          },
        },
      );
      await rename(filename + ".part", filename);
      item.hlsAssets[name] = item.partialAsset.type ?? "audio/mp4";
      delete item.partialAsset;
      complete += result.size;
      item.bytes = complete;
      this.db.set(this.prefix + item.track.id, item);
    }
    await writeFile(join(hlsDirectory, "playlist.m3u8"), playlistText, {
      mode: 0o600,
    });
    item.variant = variant.path;
    item.variantInfo = variant.info;
    item.total = complete;
    return true;
  }

  refreshDetails(track, force = false) {
    const { id } = track;
    if (this.detailsInFlight.has(id) || this.abort.signal.aborted) return;
    if (!force && Date.now() - (this.detailChecks.get(id) ?? 0) < 3600000)
      return;
    const signal = this.abort.signal;
    const assets = this.assets
      .trackArtwork(track)
      .map((path) => this.assets.save(path, { signal, force }));
    const work = Promise.allSettled([
      ...assets,
      this.lyrics(track, signal),
      this.waveform(track, signal),
    ]).finally(() => this.detailsInFlight.delete(id));
    this.detailsInFlight.set(id, work);
    this.detailChecks.set(id, Date.now());
  }

  async waveform(track, signal) {
    const path = "/api/tracks/" + track.id + "/waveform";
    const result = await this.server.json(path, { signal });
    this.catalog.cache(path, result);
  }

  async lyrics(track, signal) {
    const path = "/api/tracks/" + track.id + "/lyrics";
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await this.server.request(path, { signal });
      if (response.status === 200) {
        const result = await response.json();
        const prior = this.catalog.cached(path);
        const timed = result?.lines?.some((line) => line.words?.length);
        if (
          result &&
          (timed ||
            !prior?.lines?.some((line) => line.words?.length) ||
            result.source === "Manual")
        ) {
          this.catalog.cache(path, result);
        }
        if (timed || result?.source === "Manual") return;
      } else {
        await response.body?.cancel();
      }
      if (attempt < 4) {
        const { setTimeout } = await import("node:timers/promises");
        await setTimeout(15000, undefined, { signal });
      }
    }
  }

  async serve(request, path) {
    const match = audioRoute.exec(path);
    if (!match || !uuid.test(match[1])) return null;
    const [, id, resource] = match;
    const item = this.item(id);
    if (item?.status !== "complete") return null;
    const directory = this.path(id);
    if (resource === "stream" && item.source === "original") {
      return serveFile(request, join(directory, "original"), item.contentType);
    }
    if (item.source !== "hls") return null;
    const hlsDirectory = join(directory, "hls");
    if (resource === "hls/master.m3u8") {
      if (!(await fileInfo(join(hlsDirectory, "playlist.m3u8")))) return null;
      return new Response(
        "#EXTM3U\n#EXT-X-VERSION:7\n" +
          item.variantInfo +
          "\n" +
          item.variant +
          "\n",
        { headers: { "content-type": manifestType } },
      );
    }
    if (resource === "hls/" + item.variant) {
      return serveFile(
        request,
        join(hlsDirectory, "playlist.m3u8"),
        manifestType,
      );
    }
    const file = resource.split("/").at(-1);
    const variantPath = item.variant.split("/")[0];
    if (
      resource === "hls/" + variantPath + "/" + file &&
      Object.hasOwn(item.hlsAssets, file)
    ) {
      return serveFile(request, join(hlsDirectory, file), item.hlsAssets[file]);
    }
    return null;
  }
}

export { assetRoute };
