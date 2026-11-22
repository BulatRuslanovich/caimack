// SPDX-License-Identifier: AGPL-3.0-only
import { JSONParser } from "@streamparser/json";
import { randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  checkedBody,
  download,
  fileHash,
  fileInfo,
  serveFile,
  transfer,
} from "./files.mjs";
import { isTrack } from "./downloads.mjs";
import { digest, uuid } from "./storage.mjs";

const hash = /^[a-f0-9]{64}$/;
const syncFields = [
  "protocol",
  "serverId",
  "user",
  "generatedAt",
  "tracks",
  "files",
  "albums",
  "artists",
  "libraryOrder",
  "savedLibrary",
  "libraryFolders",
  "genres",
  "playlists",
  "playlistTracks",
  "recent",
  "assets",
  "vectorVersion",
  "recommendationsEnabled",
  "feed",
  "settings",
  "mixes",
  "radio",
];
const detailFields = { lyrics: "lyrics", waveforms: "waveform" };
const noSymlinks =
  "The synchronization folder contains a symbolic link or has moved.";

export function safeName(value) {
  let name = String(value ?? "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^[ .]+|[ .]+$/g, "");
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))
    name = "_" + name;
  let result = "";
  for (const character of name) {
    if (Buffer.byteLength(result + character) > 90) break;
    result += character;
  }
  return result.replace(/[ .]+$/g, "") || "_";
}

function withSuffix(name, suffix) {
  const extension = /\.[^./]+$/.exec(basename(name))?.[0] ?? "";
  return (
    (extension ? name.slice(0, -extension.length) : name) + suffix + extension
  );
}

function lrc(lyrics) {
  const pad = (value) => String(Math.floor(value)).padStart(2, "0");
  return (
    (lyrics.lines ?? [])
      .map((line) => {
        const at = Math.max(0, Number(line.at) || 0);
        return (
          "[" +
          pad(at / 60000) +
          ":" +
          pad((at / 1000) % 60) +
          "." +
          pad((at / 10) % 100) +
          "]" +
          String(line.text).replace(/\r?\n/g, " ")
        );
      })
      .join("\n") + "\n"
  );
}

async function inspectPath(path) {
  try {
    return await lstat(path);
  } catch (reason) {
    if (reason.code === "ENOENT") return null;
    throw reason;
  }
}

async function copyExclusive(source, target) {
  try {
    await link(source, target);
  } catch (reason) {
    if (
      !["EPERM", "EXDEV", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes(
        reason.code,
      )
    )
      throw reason;
    await copyFile(source, target, constants.COPYFILE_EXCL);
  }
}

export class Mirror {
  constructor(db, profile, folder, binding) {
    this.db = db;
    this.folder = folder;
    this.binding = binding;
    this.prefix = profile + ":mirror:" + digest(folder + binding) + ":";
    this.name = db.get(this.prefix + "directory");
  }

  get root() {
    return this.name ? join(this.folder, this.name) : null;
  }

  async begin() {
    if ((await realpath(this.folder)) !== this.folder)
      throw new Error(noSymlinks);
    if (!this.name) {
      const base = "Caimack-" + this.binding;
      for (let attempt = 0; attempt < 10; attempt++) {
        const next = attempt ? base + "-" + randomUUID().slice(0, 8) : base;
        try {
          await mkdir(join(this.folder, next));
          this.name = next;
          this.db.set(this.prefix + "directory", next);
          break;
        } catch (reason) {
          if (reason.code !== "EEXIST") throw reason;
        }
      }
      if (!this.name)
        throw new Error("Could not create a managed music folder.");
    }
    await this.path(".caimack/partial/placeholder", true);
    for (const [key, pending] of this.db.entries(this.prefix + "publish:")) {
      const target = await this.path(pending.record.path, true);
      if (
        (await fileInfo(target)) &&
        (await fileHash(target)) === pending.record.hash
      ) {
        this.commit(key, pending.index, pending.record, pending.previous);
      } else {
        this.db.delete(key);
      }
    }
    await this.clean();
  }

  async path(local, create = false) {
    if (!this.root || isAbsolute(local))
      throw new Error("Invalid managed file path.");
    const absolute = resolve(this.root, local);
    const path = relative(this.root, absolute);
    if (
      !path ||
      path === ".." ||
      path.startsWith(".." + sep) ||
      isAbsolute(path)
    ) {
      throw new Error("Invalid managed file path.");
    }
    let parent = this.root;
    const root = await inspectPath(parent);
    if (!root?.isDirectory() || root.isSymbolicLink())
      throw new Error(noSymlinks);
    for (const item of path.split(sep).slice(0, -1)) {
      parent = join(parent, item);
      if (create) {
        await mkdir(parent).catch((reason) => {
          if (reason.code !== "EEXIST") throw reason;
        });
      }
      const stat = await inspectPath(parent);
      if (!stat && !create) return null;
      if (!stat?.isDirectory() || stat.isSymbolicLink())
        throw new Error(noSymlinks);
    }
    return absolute;
  }

  async partial(key) {
    const target = await this.path(
      ".caimack/partial/" + digest(key) + ".part",
      true,
    );
    const stat = await inspectPath(target);
    if (stat && !stat.isFile()) throw new Error(noSymlinks);
    return target;
  }

  item(index) {
    return this.db.get(this.prefix + "file:" + index);
  }

  items() {
    return this.db
      .entries(this.prefix + "file:")
      .map(([key, record]) => [
        key.slice((this.prefix + "file:").length),
        record,
      ]);
  }

  async existing(record) {
    if (!record) return null;
    const path = await this.path(record.path);
    const stat = path && (await fileInfo(path));
    return stat ? { path, stat } : null;
  }

  async publish(index, desired, partial, metadata, signal) {
    signal?.throwIfAborted();
    const previous = this.item(index);
    const hash = metadata.hash ?? (await fileHash(partial, signal));
    const oldFile = await this.existing(previous);
    if (
      previous?.hash === hash &&
      previous.desired === desired &&
      oldFile?.stat.size === metadata.size &&
      (await fileHash(oldFile.path, signal)) === hash
    ) {
      const record = { ...previous, ...metadata, hash };
      this.db.set(this.prefix + "file:" + index, record);
      await rm(partial, { force: true });
      return record;
    }
    let local = desired;
    let target = await this.path(local, true);
    const previousOwns =
      previous &&
      target === oldFile?.path &&
      (await fileHash(target, signal)) === previous.hash;
    if (!previousOwns && (await inspectPath(target))) {
      do {
        local = withSuffix(desired, " [" + randomUUID().slice(0, 8) + "]");
        target = await this.path(local, true);
      } while (await inspectPath(target));
    }
    signal?.throwIfAborted();
    const record = { ...metadata, path: local, desired, hash };
    const journal = this.prefix + "publish:" + index;
    this.db.set(journal, { record, index, previous });
    if (previousOwns) await rename(partial, target);
    else await copyExclusive(partial, target);
    this.commit(journal, index, record, previous);
    await rm(partial, { force: true });
    return record;
  }

  commit(journal, index, record, previous) {
    this.db.transaction(() => {
      this.db.set(this.prefix + "file:" + index, record);
      this.db.delete(journal);
      if (previous && previous.path !== record.path) this.queueDelete(previous);
    });
  }

  queueDelete(record) {
    this.db.set(this.prefix + "delete:" + digest(record.path), record);
  }

  retire(index) {
    const record = this.item(index);
    if (!record) return;
    this.db.transaction(() => {
      this.db.delete(this.prefix + "file:" + index);
      this.queueDelete(record);
    });
  }

  async clean(signal) {
    for (const [key, record] of this.db.entries(this.prefix + "delete:")) {
      signal?.throwIfAborted();
      const existing = await this.existing(record);
      if (
        existing &&
        existing.stat.size === record.size &&
        (await fileHash(existing.path, signal)) === record.hash
      ) {
        await rm(existing.path, { force: true });
      }
      this.db.delete(key);
    }
  }

  async text(index, name, text, signal) {
    const partial = await this.partial(index);
    await writeFile(partial, text, { mode: 0o600 });
    return this.publish(
      index,
      name,
      partial,
      { size: Buffer.byteLength(text), hash: digest(text) },
      signal,
    );
  }
}

function validate(snapshot, user, binding) {
  const { protocol, serverId, tracks, files, assets, vectorVersion } = snapshot;
  if (
    protocol !== 1 ||
    !uuid.test(serverId ?? "") ||
    snapshot.user?.id !== user.id ||
    (binding && binding !== serverId) ||
    !Array.isArray(tracks) ||
    !Array.isArray(files) ||
    !Array.isArray(assets) ||
    !Array.isArray(snapshot.albums) ||
    !Array.isArray(snapshot.artists) ||
    !Array.isArray(snapshot.playlists) ||
    !Array.isArray(snapshot.savedLibrary) ||
    typeof snapshot.playlistTracks !== "object" ||
    snapshot.playlistTracks === null ||
    typeof snapshot.generatedAt !== "string" ||
    !hash.test(vectorVersion ?? "")
  ) {
    throw new Error(
      "The server returned an incomplete or different library snapshot.",
    );
  }
  const seen = new Set();
  const trackIds = new Set(tracks.filter(isTrack).map((track) => track.id));
  if (
    trackIds.size !== tracks.length ||
    files.length !== tracks.length ||
    files.some((file) => {
      if (
        !file ||
        seen.has(file.id) ||
        !trackIds.has(file.id) ||
        !hash.test(file.fileHash ?? "") ||
        !/^(?:opaque:)?[a-f0-9]{64}$/.test(file.audioVersion ?? "") ||
        !Number.isSafeInteger(file.size) ||
        file.size < 1 ||
        !["mp3", "flac"].includes(file.extension)
      )
        return true;
      seen.add(file.id);
      return false;
    })
  )
    throw new Error("The library file manifest is incomplete or invalid.");
  return snapshot;
}

export async function parseSnapshot(path, catalog, user, signal) {
  const revision = randomUUID();
  const prefix = catalog.detailPrefix(revision);
  const snapshot = { detailsRevision: revision };
  const parser = new JSONParser({
    paths: [
      ...syncFields.map((key) => "$." + key),
      "$.lyrics.*",
      "$.waveforms.*",
    ],
    keepStack: false,
    stringBufferSize: 65536,
  });
  let details = [];
  const flush = () => {
    if (!details.length) return;
    catalog.db.transaction(() => {
      for (const [key, value] of details) catalog.db.set(key, value);
    });
    details = [];
  };
  parser.onValue = ({ key, value, stack }) => {
    if (stack.length === 1 && syncFields.includes(key)) {
      if (Object.hasOwn(snapshot, key))
        throw new Error("Duplicate library snapshot field.");
      snapshot[key] = value;
    }
    const category = stack.length === 2 && detailFields[stack[1].key];
    if (category && uuid.test(key)) {
      details.push([prefix + category + ":" + key, value]);
      if (details.length >= 16) flush();
    }
  };
  try {
    for await (const chunk of createReadStream(path, { signal }))
      parser.write(chunk);
    if (!parser.isEnded) parser.end();
    flush();
    return validate(snapshot, user, catalog.snapshot?.serverId);
  } catch (reason) {
    catalog.db.deletePrefix(prefix);
    throw reason;
  }
}

export class LibrarySync {
  constructor(
    db,
    scope,
    directory,
    server,
    user,
    catalog,
    assets,
    coverToJpeg,
  ) {
    this.db = db;
    this.scope = scope;
    this.directory = directory;
    this.server = server;
    this.user = user;
    this.catalog = catalog;
    this.assets = assets;
    this.coverToJpeg = coverToJpeg;
    this.config = db.get(scope + ":sync", {
      folder: null,
      enabled: false,
      paused: false,
      lastAt: null,
    });
    this.progress = {
      completed: 0,
      total: 0,
      bytes: 0,
      trackBytes: 0,
      error: null,
    };
    this.controller = null;
    this.work = null;
    this.actionTimer = null;
    this.lastAttempt = 0;
    this.mirror = this.mirrorFor(catalog.snapshot);
  }

  mirrorFor(snapshot) {
    if (!snapshot || !this.config.folder) return null;
    const identity =
      snapshot.serverId.slice(0, 8) + "-" + this.user.id.slice(0, 8);
    return new Mirror(this.db, this.scope, this.config.folder, identity);
  }

  configure(changes) {
    if (
      Object.hasOwn(changes, "folder") &&
      this.config.folder !== changes.folder
    ) {
      if (this.catalog.outbox().length)
        throw new Error(
          "Synchronize pending changes before switching folders.",
        );
      if (this.work)
        throw new Error("Pause synchronization before switching folders.");
    }
    if (changes.enabled && !this.config.folder)
      throw new Error("Choose a music folder first.");
    Object.assign(this.config, changes);
    this.db.set(this.scope + ":sync", this.config);
    if (Object.hasOwn(changes, "folder"))
      this.mirror = this.mirrorFor(this.catalog.snapshot);
    if (!this.config.enabled || this.config.paused) this.controller?.abort();
  }

  status() {
    const items = (this.mirror?.items() ?? []).filter(([key]) =>
      key.startsWith("audio:"),
    );
    return {
      ...this.config,
      ...this.progress,
      running: !!this.work,
      size: items.reduce((size, [, item]) => size + item.size, 0),
      pending: this.catalog.outbox().length,
      rejected: this.catalog.rejections(),
    };
  }

  ready() {
    return (this.mirror?.items() ?? [])
      .filter(([key]) => key.startsWith("audio:"))
      .map(([key]) => key.slice(6));
  }

  async serve(request, path) {
    const id = /^\/api\/tracks\/([a-f0-9-]+)\/stream$/i.exec(path)?.[1];
    if (!id || !this.mirror) return null;
    const record = this.mirror.item("audio:" + id);
    const file = await this.mirror.existing(record).catch(() => null);
    return file && serveFile(request, file.path, record.contentType);
  }

  schedule(delay = 1500) {
    if (this.config.enabled && !this.config.paused && !this.actionTimer) {
      this.actionTimer = setTimeout(() => {
        this.actionTimer = null;
        this.start();
      }, delay);
      this.actionTimer.unref();
    }
  }

  start() {
    if (
      !this.config.enabled ||
      this.config.paused ||
      !this.config.folder ||
      this.work
    )
      return;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.progress = {
      completed: 0,
      total: 0,
      bytes: 0,
      trackBytes: 0,
      error: null,
    };
    this.lastAttempt = Date.now();
    this.work = this.run(signal)
      .then(() => {
        if (this.catalog.outbox().length) this.schedule();
      })
      .catch((reason) => {
        if (!signal.aborted) this.progress.error = reason.message;
      })
      .finally(() => {
        this.controller = null;
        this.work = null;
      });
  }

  async close() {
    clearTimeout(this.actionTimer);
    this.actionTimer = null;
    this.controller?.abort();
    await this.work;
  }

  async uploadActions(signal) {
    if (!this.catalog.snapshot) return [];
    const pending = this.catalog.outbox();
    const acknowledged = [];
    for (let index = 0; index < pending.length; index += 100) {
      signal.throwIfAborted();
      const group = pending.slice(index, index + 100);
      const { results } = await this.server.json("/api/sync/actions", {
        method: "POST",
        lan: true,
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: this.catalog.snapshot.serverId,
          userId: this.user.id,
          actions: group,
        }),
      });
      const ids = new Set(group.map((item) => item.id));
      if (!Array.isArray(results) || results.length !== ids.size)
        throw new Error("Invalid synchronization receipts.");
      for (const result of results) {
        if (!ids.delete(result.id))
          throw new Error("Invalid action receipt identifier.");
        if (result.status === "applied") acknowledged.push(result.id);
        else if (result.status === "rejected") this.catalog.reject(result);
        else throw new Error("Unknown synchronization receipt.");
      }
    }
    return acknowledged;
  }

  async run(signal) {
    const acknowledged = await this.uploadActions(signal);
    const stage = join(this.directory, "snapshot.part");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const response = await this.server.request("/api/sync/snapshot", {
      signal,
      lan: true,
    });
    await transfer(response, stage, { signal });
    const snapshot = await parseSnapshot(
      stage,
      this.catalog,
      this.user,
      signal,
    );
    try {
      signal.throwIfAborted();
      const mirror = this.mirrorFor(snapshot);
      await mirror.begin();
      this.mirror = mirror;
      const exported = await mirror.partial("catalog");
      await copyFile(stage, exported);
      await mirror.publish(
        "catalog",
        ".caimack/library.json",
        exported,
        {
          size: (await fileInfo(exported)).size,
        },
        signal,
      );
      this.catalog.accept(snapshot, acknowledged);
    } finally {
      if (this.catalog.snapshot?.detailsRevision !== snapshot.detailsRevision) {
        this.db.deletePrefix(
          this.catalog.detailPrefix(snapshot.detailsRevision),
        );
      }
      await rm(stage, { force: true });
    }

    const mirror = this.mirror;
    this.progress.total = snapshot.files.length;
    const vector = mirror.item("vectors");
    if (
      vector?.version !== snapshot.vectorVersion ||
      !(await mirror.existing(vector))
    ) {
      const partial = await mirror.partial("vectors");
      const response = await this.server.request("/api/sync/vectors", {
        signal,
        lan: true,
      });
      const size = await transfer(response, partial, { signal });
      await mirror.publish(
        "vectors",
        ".caimack/vectors.json",
        partial,
        {
          size,
          version: snapshot.vectorVersion,
        },
        signal,
      );
    }
    for (const asset of snapshot.assets) {
      signal.throwIfAborted();
      if (typeof asset.path !== "string" || typeof asset.version !== "string")
        continue;
      await this.assets
        .save("/" + asset.path, { version: asset.version, signal, lan: true })
        .catch(() => {});
    }
    const tracks = new Map(snapshot.tracks.map((track) => [track.id, track]));
    const wanted = new Set(snapshot.files.map((file) => file.id));
    for (const file of snapshot.files) {
      signal.throwIfAborted();
      const track = tracks.get(file.id);
      const record = await this.audio(mirror, file, track, signal);
      await this.companions(mirror, snapshot, track, record, signal);
      this.progress.completed++;
    }
    await this.playlists(mirror, snapshot, signal);
    for (const [key] of mirror.items()) {
      if (key.startsWith("audio:") && !wanted.has(key.slice(6)))
        mirror.retire(key);
      if (/^(?:lyrics|cover):/.test(key) && !wanted.has(key.split(":")[1]))
        mirror.retire(key);
    }
    await mirror.clean(signal);
    this.config.lastAt = new Date().toISOString();
    this.db.set(this.scope + ":sync", this.config);
  }

  async audio(mirror, file, track, signal) {
    const { id, size, fileHash: expected, audioVersion, extension } = file;
    const index = "audio:" + id;
    const desired = join(
      safeName(track.artistName),
      safeName(track.albumTitle || "Singles"),
      safeName(track.title) + " [" + id.slice(0, 8) + "]." + extension,
    );
    const previous = mirror.item(index);
    const existing = await mirror.existing(previous);
    if (
      existing &&
      previous.hash === expected &&
      previous.desired === desired &&
      existing.stat.size === size &&
      existing.stat.mtimeMs === previous.mtimeMs
    ) {
      return previous;
    }
    const partKey = index + ":" + expected;
    const pending = mirror.prefix + "partial:" + index;
    const prior = this.db.get(pending);
    if (prior && prior !== partKey) {
      const abandoned = await mirror.partial(prior);
      await rm(abandoned, { force: true });
    }
    this.db.set(pending, partKey);
    const target = await mirror.partial(partKey);
    const root = "/api/sync/tracks/" + id;
    this.progress.bytes = 0;
    this.progress.trackBytes = size;
    let tags = null;
    let patched = false;
    let contentType =
      previous?.contentType ??
      (extension === "flac" ? "audio/flac" : "audio/mpeg");
    if (
      existing &&
      previous.hash === expected &&
      (await fileHash(existing.path, signal)) === expected
    ) {
      await copyFile(existing.path, target);
      patched = true;
    } else if (
      existing &&
      previous.audioVersion === audioVersion &&
      previous.hash !== expected &&
      previous.payloadSize > 0 &&
      !audioVersion.startsWith("opaque:")
    ) {
      tags = await this.tags(root, expected, audioVersion, size, signal);
      if (previous.payloadSize === tags.payloadSize) {
        const range = {
          start: previous.prefix,
          end: previous.prefix + previous.payloadSize - 1,
          signal,
        };
        const bytes = async function* () {
          yield tags.head;
          yield* createReadStream(existing.path, range);
          yield tags.tail;
        };
        await pipeline(
          Readable.from(bytes()),
          createWriteStream(target, { mode: 0o600 }),
          { signal },
        );
        patched = (await fileHash(target, signal)) === expected;
        if (!patched) await rm(target, { force: true });
      }
    }
    if (!patched) {
      await download(
        (headers) =>
          this.server.request(root + "/audio?version=" + expected, {
            signal,
            lan: true,
            headers,
          }),
        target,
        {
          etag: '"' + expected + '"',
          total: size,
          exact: true,
          signal,
          onHeaders: (_etag, _size, type) => {
            if (type?.startsWith("audio/") || type === "video/mp4")
              contentType = type;
          },
          onProgress: (bytes) => {
            this.progress.bytes = bytes;
          },
        },
      );
    }
    if ((await fileHash(target, signal)) !== expected) {
      await rm(target, { force: true });
      throw new Error("Checksum failed for " + track.title);
    }
    tags ??= await this.tags(root, expected, audioVersion, size, signal);
    const record = await mirror.publish(
      index,
      desired,
      target,
      {
        size,
        hash: expected,
        audioVersion,
        payloadSize: tags.payloadSize,
        prefix: tags.head.length,
        contentType,
      },
      signal,
    );
    record.mtimeMs = (await mirror.existing(record)).stat.mtimeMs;
    this.db.set(mirror.prefix + "file:" + index, record);
    this.db.delete(pending);
    return record;
  }

  async tags(path, expected, audioVersion, size, signal) {
    const result = await this.server.json(path + "/tags?version=" + expected, {
      lan: true,
      signal,
    });
    const head = Buffer.from(result.prefix, "base64");
    const tail = Buffer.from(result.suffix, "base64");
    if (
      result.fileHash !== expected ||
      result.audioVersion !== audioVersion ||
      !Number.isSafeInteger(result.payloadSize) ||
      result.payloadSize < 1 ||
      head.length + tail.length + result.payloadSize !== size
    ) {
      throw new Error(
        "The server audio metadata changed during synchronization.",
      );
    }
    return { head, tail, payloadSize: result.payloadSize };
  }

  async companions(mirror, snapshot, track, record, signal) {
    const key = track.id;
    const base = record.path.replace(/\.[^.]+$/, "");
    const lyrics = this.catalog.detail(snapshot.detailsRevision, "lyrics", key);
    if (lyrics?.lines?.length || lyrics?.plain) {
      const timed = !!lyrics.lines?.length;
      await mirror.text(
        "lyrics:" + key,
        base + (timed ? ".lrc" : ".txt"),
        timed ? lrc(lyrics) : lyrics.plain,
        signal,
      );
    } else mirror.retire("lyrics:" + key);
    if (!track.hasCover) {
      mirror.retire("cover:" + key);
      return;
    }
    const asset = track.albumId && !track.coverRevision
      ? "/api/albums/" + track.albumId + "/cover"
      : "/api/tracks/" + key + "/cover";
    await this.assets.save(asset, { signal, lan: true }).catch(() => {});
    const art = this.assets.record(asset);
    if (!art) return;
    const image = await this.coverToJpeg(join(this.assets.directory, art.file));
    if (!image?.length) return;
    const partial = await mirror.partial("cover:" + key);
    await writeFile(partial, image, { mode: 0o600 });
    await mirror.publish(
      "cover:" + key,
      base + ".jpg",
      partial,
      { size: image.length },
      signal,
    );
  }

  async playlists(mirror, snapshot, signal) {
    const keep = new Set();
    const write = async (key, name, ids) => {
      keep.add(key);
      const rows = ids.flatMap((id) => {
        const file = mirror.item("audio:" + id);
        return file ? [file.path.split(sep).join("/")] : [];
      });
      await mirror.text(
        key,
        name + ".m3u8",
        "#EXTM3U\n" + rows.join("\n") + "\n",
        signal,
      );
    };
    for (const list of snapshot.playlists) {
      if (!uuid.test(list.id ?? "")) continue;
      await write(
        "playlist:" + list.id,
        safeName(list.name) + " [" + list.id.slice(0, 8) + "]",
        snapshot.playlistTracks[list.id] ?? [],
      );
    }
    for (const kind of ["daily", "new", "top"]) {
      await write(
        "playlist:" + kind,
        "Caimack " + kind,
        (snapshot.mixes?.[kind]?.tracks ?? []).map((track) => track.id),
      );
    }
    await write(
      "playlist:radio",
      "Caimack Radio",
      (snapshot.radio?.tracks ?? []).map((item) => item.track.id),
    );
    for (const [key] of mirror.items()) {
      if (key.startsWith("playlist:") && !keep.has(key)) mirror.retire(key);
    }
  }
}
