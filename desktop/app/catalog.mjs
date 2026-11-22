// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { digest, uuid } from "./storage.mjs";
import { isTrack } from "./downloads.mjs";

const browse =
  /^\/api\/(config|me\/(?:library(?:\/folders|\/order)?|settings)|home\/(?:feed|mixes\/(?:daily|new|top))|library\/overview|tracks(?:\/[0-9a-f-]+\/(?:lyrics|waveform))?|artists(?:\/[0-9a-f-]+(?:\/top-tracks)?)?|albums(?:\/[0-9a-f-]+)?|genres(?:\/[0-9a-f-]+\/tracks)?|playlists(?:\/(?:public|[0-9a-f-]+))?|favorites|search(?:\/(?:popular|tracks|albums|artists|genres))?|history(?:\/recent)?|recommendations\/rules)$/i;
const entities = { album: "albums", artist: "artists", playlist: "playlists" };
const empty = () => new Response(null, { status: 204 });
const own = (object, key) =>
  object && Object.hasOwn(object, key) ? object[key] : undefined;
const array = (data) => (Array.isArray(data) ? data : []);
const lower = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase();
const includes = (q, ...texts) =>
  !q || texts.some((text) => lower(text).includes(q));
const trackMatch = (track, q) =>
  includes(q, track.title, track.artistName, track.albumTitle, track.genreName);
const byName = (field) => (a, b) =>
  String(a[field] ?? "").localeCompare(String(b[field] ?? ""));
const latest = (a, b) =>
  String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
const byTrackNumber = (a, b) =>
  (a.discNumber ?? 0) - (b.discNumber ?? 0) ||
  (a.trackNumber ?? Infinity) - (b.trackNumber ?? Infinity) ||
  byName("title")(a, b);

function popularSearch(view) {
  const trackPlays = new Map();
  const albumPlays = new Map();
  const artistPlays = new Map();
  const count = (plays, id) => plays.set(id, (plays.get(id) ?? 0) + 1);
  for (const entry of view.history) {
    const track = view.tracks.get(entry.track.id);
    if (!track) continue;
    count(trackPlays, track.id);
    if (track.albumId) count(albumPlays, track.albumId);
    const credits = track.artists?.length
      ? track.artists.map(({ id }) => id)
      : [track.artistId];
    for (const id of credits) count(artistPlays, id);
  }
  const top = (items, plays, field, limit) =>
    [...items.values()]
      .sort(
        (a, b) =>
          (plays.get(b.id) ?? 0) - (plays.get(a.id) ?? 0) ||
          byName(field)(a, b),
      )
      .slice(0, limit);
  return {
    tracks: top(view.tracks, trackPlays, "title", 10),
    albums: top(view.albums, albumPlays, "title", 5),
    artists: top(view.artists, artistPlays, "name", 5),
  };
}

function page(items, params) {
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pageSize = Math.max(
    1,
    Math.min(500, Math.floor(Number(params.get("pageSize")) || 50)),
  );
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
  };
}

function trackSort(items, params) {
  const sort = params.get("sort");
  const comparators = {
    Recent: latest,
    Artist: byName("artistName"),
    Album: byName("albumTitle"),
    Bpm: (a, b) => (a.cues?.bpm ?? 0) - (b.cues?.bpm ?? 0),
    Key: (a, b) =>
      String(a.key?.camelot ?? "").localeCompare(String(b.key?.camelot ?? "")),
    Loudness: (a, b) => (b.loudness?.lufs ?? -99) - (a.loudness?.lufs ?? -99),
  };
  const key = params.get("key");
  const low = params.get("bpmMin");
  const high = params.get("bpmMax");
  return items
    .filter(
      (track) =>
        (!key || track.key?.camelot === key) &&
        (!low || (track.cues?.bpm ?? -1) >= Number(low)) &&
        (!high || (track.cues?.bpm ?? Infinity) <= Number(high)),
    )
    .sort(own(comparators, sort) ?? byName("title"));
}

function action(
  kind,
  entityId,
  payload,
  occurredAt = new Date().toISOString(),
  id = randomUUID(),
) {
  return { id, kind, entityId, occurredAt, payload };
}

function signalId(event) {
  const hash = digest(JSON.stringify(event));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class Catalog {
  constructor(db, scope, user) {
    this.db = db;
    this.scope = scope + ":catalog:";
    this.user = user;
    this.snapshot = db.get(this.scope + "snapshot");
    this.projected = null;
  }

  cacheKey(path) {
    const url = new URL(path, "https://local.invalid");
    url.searchParams.delete("v");
    url.searchParams.sort();
    return url.pathname + url.search;
  }

  cached(path) {
    return this.db.get(this.scope + "cache:" + this.cacheKey(path), undefined);
  }

  rememberTrack(track) {
    if (isTrack(track)) {
      this.db.set(this.scope + "track:" + track.id, track);
      this.projected = null;
    }
  }

  cache(path, value) {
    if (!browse.test(path.split("?")[0])) return;
    this.db.transaction(() => {
      this.db.set(this.scope + "cache:" + this.cacheKey(path), value);
      const collect = (part) => {
        if (isTrack(part)) this.rememberTrack(part);
        else if (part && typeof part === "object")
          Object.values(part).forEach(collect);
      };
      if (!/\/(?:lyrics|waveform)$/.test(path.split("?")[0])) collect(value);
    });
    this.projected = null;
  }

  async cacheResponse(path, response) {
    if (
      response.status !== 200 ||
      !browse.test(path.split("?")[0]) ||
      !response.headers.get("content-type")?.includes("json")
    )
      return;
    this.cache(path, await response.json());
  }

  accept(snapshot, acknowledged) {
    const oldRevision = this.snapshot?.detailsRevision;
    this.db.transaction(() => {
      this.db.set(this.scope + "snapshot", snapshot);
      if (oldRevision && oldRevision !== snapshot.detailsRevision)
        this.db.deletePrefix(this.detailPrefix(oldRevision));
      for (const id of acknowledged)
        this.db.delete(this.scope + "outbox:" + id);
    });
    this.snapshot = snapshot;
    this.projected = null;
  }

  detailPrefix(revision) {
    return this.scope + "detail:" + revision + ":";
  }

  detail(revision, category, id) {
    return this.db.get(this.detailPrefix(revision) + category + ":" + id);
  }

  outbox() {
    return this.db.entries(this.scope + "outbox:").map(([, value]) => value);
  }

  rejections() {
    return this.db.entries(this.scope + "rejected:").map(([, value]) => value);
  }

  reject(result) {
    this.db.transaction(() => {
      this.db.set(this.scope + "rejected:" + result.id, result);
      this.db.delete(this.scope + "outbox:" + result.id);
    });
    this.projected = null;
  }

  enqueue(actions) {
    this.db.transaction(() => {
      for (const change of actions) {
        if (!this.db.get(this.scope + "outbox:" + change.id))
          this.db.set(this.scope + "outbox:" + change.id, change);
      }
    });
    this.projected = null;
  }

  view() {
    this.projected ??= this.project();
    return this.projected;
  }

  project() {
    const snapshot = this.snapshot;
    const tracks =
      snapshot?.tracks ??
      this.db.entries(this.scope + "track:").map(([, item]) => item);
    const catalog = {
      tracks: new Map(tracks.map((track) => [track.id, track])),
      albums: new Map(
        array(snapshot?.albums).map((album) => [album.id, album]),
      ),
      artists: new Map(
        array(snapshot?.artists).map((artist) => [artist.id, artist]),
      ),
      genres: new Map(
        array(snapshot?.genres ?? this.cached("/api/genres")).map((genre) => [
          genre.id,
          genre,
        ]),
      ),
      playlists: new Map(
        array(
          snapshot?.playlists ?? [
            ...array(this.cached("/api/playlists")),
            ...array(this.cached("/api/playlists/public")),
          ],
        ).map((playlist) => [playlist.id, playlist]),
      ),
      members: new Map(Object.entries(snapshot?.playlistTracks ?? {})),
      library: new Map(
        array(snapshot?.savedLibrary ?? this.cached("/api/me/library")).map(
          (item) => [item.kind + ":" + item.id, item],
        ),
      ),
      folders: new Map(
        array(
          snapshot?.libraryFolders ?? this.cached("/api/me/library/folders"),
        ).map((folder) => [folder.id, folder]),
      ),
      order: {
        ...(snapshot?.libraryOrder ?? this.cached("/api/me/library/order")),
      },
      recent: [...array(snapshot?.recent)],
      rules: array(this.cached("/api/recommendations/rules")).slice(),
      history: array(
        this.cached("/api/history?page=1&pageSize=50")?.items,
      ).slice(),
    };
    for (const track of tracks) {
      if (snapshot) break;
      if (track.albumId && !catalog.albums.has(track.albumId)) {
        catalog.albums.set(track.albumId, {
          id: track.albumId,
          title: track.albumTitle ?? track.title,
          artistId: track.artistId,
          artistName: track.artistName,
          hasCover: false,
          year: track.year,
          createdAt: track.createdAt,
          trackCount: 0,
          durationSeconds: 0,
        });
      }
      const album = catalog.albums.get(track.albumId);
      if (album) {
        if (track.hasCover && !track.coverRevision) album.hasCover = true;
        album.trackCount++;
        album.durationSeconds += track.durationSeconds ?? 0;
      }
      for (const artist of track.artists?.length
        ? track.artists
        : [{ id: track.artistId, name: track.artistName }]) {
        if (!artist.id) continue;
        const known = catalog.artists.get(artist.id) ?? {
          ...artist,
          trackCount: 0,
          albumCount: 0,
          hasImage: true,
        };
        known.trackCount++;
        catalog.artists.set(artist.id, known);
      }
    }
    const albumCounts = new Map();
    if (!snapshot)
      for (const album of catalog.albums.values()) {
        albumCounts.set(
          album.artistId,
          1 + (albumCounts.get(album.artistId) ?? 0),
        );
      }
    for (const [id, count] of albumCounts) {
      const artist = catalog.artists.get(id);
      if (artist) artist.albumCount = count;
    }
    for (const change of this.outbox()) this.apply(catalog, change);
    for (const [id, members] of catalog.members) {
      const playlist = catalog.playlists.get(id);
      if (!playlist) continue;
      const coverTracks = [];
      const seen = new Set();
      for (const trackId of members) {
        const track = catalog.tracks.get(trackId);
        if (!track?.hasCover) continue;
        const { id, title, albumId, albumTitle, hasCover, coverRevision } = track;
        const key = coverRevision ?? albumId ?? id;
        if (seen.has(key)) continue;
        seen.add(key);
        coverTracks.push({ id, title, albumId, albumTitle, hasCover, coverRevision });
        if (coverTracks.length === 4) break;
      }
      catalog.playlists.set(id, { ...playlist, coverTracks });
      const key = "playlist:" + id;
      const saved = catalog.library.get(key);
      if (saved) catalog.library.set(key, { ...saved, coverTracks });
    }
    return catalog;
  }

  apply(catalog, { kind, entityId: id, payload, occurredAt }) {
    const {
      tracks,
      library,
      playlists,
      members,
      folders,
      order,
      rules,
      recent,
      history,
    } = catalog;
    switch (kind) {
      case "history":
        if (
          tracks.has(payload.trackId) &&
          payload.listenedSeconds >=
            Math.min(
              30,
              Math.max(1, tracks.get(payload.trackId).durationSeconds - 1),
            )
        ) {
          const index = recent.indexOf(payload.trackId);
          if (index >= 0) recent.splice(index, 1);
          recent.unshift(payload.trackId);
          history.unshift({
            id: id ?? payload.trackId,
            track: tracks.get(payload.trackId),
            playedAt: occurredAt,
            playbackPosition: payload.playbackPosition,
          });
        }
        break;
      case "favorite":
        if (tracks.has(id))
          tracks.set(id, { ...tracks.get(id), isFavorite: payload.value });
        break;
      case "library": {
        const key = payload.kind + ":" + id;
        const item = catalog[entities[payload.kind]]?.get(id);
        if (!payload.value) library.delete(key);
        else if (item && !library.has(key))
          library.set(key, {
            kind: payload.kind,
            id,
            savedAt: occurredAt,
            folderId: null,
            title: item.title ?? item.name,
            subtitle: item.artistName ?? item.ownerName ?? "",
            hasImage: item.hasCover ?? item.hasImage ?? false,
            coverTrackId: item.coverTrackId ?? null,
            trackCount: item.trackCount,
            albumCount: item.albumCount,
            year: item.year,
            durationSeconds: item.durationSeconds,
          });
        break;
      }
      case "libraryOrganize":
        this.organize(catalog, folders, order, id, payload, occurredAt);
        break;
      case "playlistCreate":
        playlists.set(id, {
          ...payload,
          id,
          ownerId: this.user.id,
          ownerName: this.user.username,
          trackCount: 0,
          durationSeconds: 0,
          hasCover: false,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        });
        members.set(id, []);
        this.apply(catalog, {
          kind: "library",
          entityId: id,
          payload: { kind: "playlist", value: true },
          occurredAt,
        });
        break;
      case "playlistUpdate":
        if (playlists.has(id))
          playlists.set(id, {
            ...playlists.get(id),
            ...payload,
            updatedAt: occurredAt,
          });
        break;
      case "playlistDelete":
        playlists.delete(id);
        members.delete(id);
        library.delete("playlist:" + id);
        break;
      case "playlistAdd":
      case "playlistRemove":
      case "playlistOrder": {
        const existing = members.get(id) ?? [];
        const wanted = array(payload.trackIds);
        if (kind === "playlistAdd")
          members.set(id, [
            ...new Set([
              ...existing,
              ...wanted.filter((track) => tracks.has(track)),
            ]),
          ]);
        if (kind === "playlistRemove")
          members.set(
            id,
            existing.filter((track) => !wanted.includes(track)),
          );
        if (kind === "playlistOrder")
          members.set(id, [
            ...new Set([
              ...wanted.filter((track) => existing.includes(track)),
              ...existing,
            ]),
          ]);
        break;
      }
      case "tasteRule": {
        const target = catalog[
          entities[payload.targetType] ?? payload.targetType + "s"
        ]?.get(payload.targetId);
        if (!target) break;
        const index = rules.findIndex(
          (rule) =>
            rule.targetId === payload.targetId &&
            rule.targetType === payload.targetType,
        );
        if (index >= 0) rules.splice(index, 1);
        rules.unshift({
          ...payload,
          id,
          name: target.name ?? target.title,
          artistName: target.artistName,
          createdAt: occurredAt,
          until:
            payload.action === "cooldown"
              ? new Date(
                  Date.parse(occurredAt) + (payload.days ?? 30) * 86400000,
                ).toISOString()
              : null,
        });
        break;
      }
    }
  }

  organize({ library }, folders, order, id, payload, occurredAt) {
    const folder = folders.get(id);
    switch (payload.operation) {
      case "create":
        folders.set(id, {
          id,
          name: payload.name,
          parentId: payload.folderId ?? null,
          createdAt: occurredAt,
        });
        break;
      case "rename":
        if (folder) folders.set(id, { ...folder, name: payload.name });
        break;
      case "moveFolder":
        if (folder)
          folders.set(id, { ...folder, parentId: payload.folderId ?? null });
        break;
      case "delete":
        if (!folder) break;
        for (const [key, child] of folders)
          if (child.parentId === id) {
            folders.set(key, { ...child, parentId: folder.parentId });
          }
        for (const [key, item] of library)
          if (item.folderId === id) {
            library.set(key, { ...item, folderId: folder.parentId });
          }
        folders.delete(id);
        break;
      case "moveItem": {
        const key = payload.kind + ":" + id;
        if (library.has(key))
          library.set(key, {
            ...library.get(key),
            folderId: payload.folderId ?? null,
          });
        break;
      }
      case "reorder":
        order[payload.folderId ?? "root"] = payload.order;
        break;
    }
  }

  mutation(method, path, body) {
    if (!this.snapshot) return null;
    const catalog = this.view();
    let match;
    let change;
    if (
      method === "POST" &&
      path === "/api/playback/signals" &&
      Array.isArray(body?.events)
    ) {
      this.enqueue(
        body.events.map((event) =>
          action(
            "signal",
            event.trackId,
            event,
            event.occurredAt,
            signalId(event),
          ),
        ),
      );
      return empty();
    }
    if (
      method === "POST" &&
      path === "/api/history" &&
      uuid.test(body?.trackId ?? "")
    ) {
      change = action("history", body.trackId, body);
    } else if (
      ["POST", "DELETE"].includes(method) &&
      (match = /^\/api\/tracks\/([^/]+)\/favorite$/.exec(path))
    ) {
      change = action("favorite", match[1], { value: method === "POST" });
    } else if (
      ["PUT", "DELETE"].includes(method) &&
      (match = /^\/api\/me\/library\/(album|artist|playlist)\/([^/]+)$/.exec(
        path,
      ))
    ) {
      change = action("library", match[2], {
        kind: match[1],
        value: method === "PUT",
      });
    } else if (
      method === "POST" &&
      path === "/api/me/library/organize" &&
      body?.operation
    ) {
      change = action("libraryOrganize", body.id ?? null, body);
    } else if (
      method === "POST" &&
      path === "/api/recommendations/rules" &&
      body?.targetId
    ) {
      change = action("tasteRule", randomUUID(), body);
    } else if (
      method === "POST" &&
      path === "/api/playlists" &&
      typeof body?.name === "string"
    ) {
      if (!body.name.trim() || body.name.trim().length > 200) {
        return Response.json(
          { detail: "Invalid playlist name." },
          { status: 422 },
        );
      }
      change = action("playlistCreate", randomUUID(), {
        ...body,
        name: body.name.trim(),
      });
    } else if (
      (match = /^\/api\/playlists\/([^/]+)(?:\/(tracks)(?:\/([^/]+))?)?$/.exec(
        path,
      ))
    ) {
      const [, id, resource, item] = match;
      const playlist = catalog.playlists.get(id);
      if (!playlist || playlist.ownerId !== this.user.id) return null;
      if (method === "DELETE" && !resource)
        change = action("playlistDelete", id, {});
      if (
        method === "PUT" &&
        !resource &&
        body &&
        typeof body.name === "string"
      ) {
        const patch = Object.fromEntries(
          Object.entries(body).filter(
            ([key, value]) =>
              ["name", "description", "isPublic"].includes(key) &&
              (playlist[key] ?? null) !== value,
          ),
        );
        change = action("playlistUpdate", id, patch);
      }
      if (method === "POST" && resource && !item)
        change = action("playlistAdd", id, { trackIds: array(body?.trackIds) });
      if (method === "PUT" && resource && item === "order")
        change = action("playlistOrder", id, {
          trackIds: array(body?.trackIds),
        });
      if (method === "DELETE" && resource && uuid.test(item ?? ""))
        change = action("playlistRemove", id, { trackIds: [item] });
    }
    if (!change || (change.entityId && !uuid.test(change.entityId)))
      return null;
    this.enqueue([change]);
    if (["playlistCreate", "playlistUpdate"].includes(change.kind)) {
      return Response.json(this.playlist(this.view(), change.entityId));
    }
    if (change.kind === "tasteRule")
      return Response.json(
        this.view().rules.find((rule) => rule.id === change.entityId) ?? null,
      );
    return empty();
  }

  playlist(view, id) {
    const playlist = view.playlists.get(id);
    if (!playlist) return null;
    if (!view.members.has(id)) return playlist;
    const items = view.members
      .get(id)
      .map((track) => view.tracks.get(track))
      .filter(Boolean);
    return {
      ...playlist,
      trackCount: items.length,
      tracks: items,
      coverTrackId: items[0]?.id ?? null,
      durationSeconds: items.reduce(
        (total, track) => total + track.durationSeconds,
        0,
      ),
    };
  }

  localTracks(sources) {
    const view = this.view();
    return Object.keys(sources)
      .map(
        (id) => view.tracks.get(id) ?? this.db.get(this.scope + "track:" + id),
      )
      .filter(Boolean);
  }

  localRadio(sources) {
    const ranked = array(this.snapshot?.radio?.tracks).filter(({ track }) =>
      Object.hasOwn(sources, track.id),
    );
    const seen = new Set(ranked.map(({ track }) => track.id));
    const rest = this.localTracks(sources).filter(
      (track) => !seen.has(track.id),
    );
    for (let end = rest.length - 1; end > 0; end--) {
      const index = Math.floor(Math.random() * (end + 1));
      [rest[end], rest[index]] = [rest[index], rest[end]];
    }
    return {
      tracks: [
        ...ranked,
        ...rest.map((track) => ({
          track,
          reason: { kind: "localCollection" },
        })),
      ],
    };
  }

  offlineHome(sources) {
    const view = this.view();
    const ready = (id) => Object.hasOwn(sources, id);
    const tracks = this.localTracks(sources);
    const albums = new Set(tracks.map((track) => track.albumId));
    const artists = new Set(
      tracks.flatMap((track) => [
        track.artistId,
        ...array(track.artists).map((credit) => credit.id),
      ]),
    );
    const feed = this.snapshot?.feed ?? this.cached("/api/home/feed");
    const blocks = array(feed?.blocks).flatMap((block) => {
      let songs = array(block.tracks).filter((track) => ready(track.id));
      if (!songs.length && block.baseKey === "favorites")
        songs = tracks.filter((track) => track.isFavorite);
      if (block.baseKey === "dailyMix")
        songs = array(this.homeMix("daily")?.tracks).filter((track) =>
          ready(track.id),
        );
      const visible = {
        ...block,
        tracks: songs,
        albums: array(block.albums).filter((album) => albums.has(album.id)),
        artists: array(block.artists).filter((artist) =>
          artists.has(artist.id),
        ),
        playlists: array(block.playlists)
          .filter(({ id }) => {
            const members = view.members.get(id);
            return members
              ? members.some(ready)
              : array(this.cached("/api/playlists/" + id)?.tracks).some((track) =>
                  ready(track.id),
                );
          })
          .map((playlist) => {
            const coverTracks = view.playlists.get(playlist.id)?.coverTracks;
            return coverTracks ? { ...playlist, coverTracks } : playlist;
          }),
      };
      return [songs, visible.albums, visible.artists, visible.playlists].some(
        (items) => items.length,
      )
        ? [visible]
        : [];
    });
    return {
      blocks,
      downloads: blocks.length ? [] : tracks,
      radio: tracks.slice(0, 3),
    };
  }

  homeMix(kind) {
    const full =
      own(this.snapshot?.mixes, kind) ?? this.cached("/api/home/mixes/" + kind);
    if (full) return full;
    const key = { daily: "dailyMix", new: "newArrivals", top: "topTracks" }[
      kind
    ];
    const feed = this.snapshot?.feed ?? this.cached("/api/home/feed");
    return {
      tracks:
        array(feed?.blocks).find((block) => block.baseKey === key)?.tracks ??
        [],
    };
  }

  read(path, params, method, body, ready) {
    const view = this.view();
    const q = lower(params.get("q"));
    const exact = this.cached(path + (params.size ? "?" + params : ""));
    const [, , resource, id, detail] = path.split("/");
    if (method === "POST" && resource === "tracks" && id === "lookup") {
      return array(body?.ids)
        .map((key) => view.tracks.get(key))
        .filter(Boolean);
    }
    if (method === "POST" && path === "/api/recommendations/radio") {
      if (body?.seedTrackId || body?.exclude?.length) return { tracks: [] };
      return {
        ...this.snapshot?.radio,
        tracks: array(this.snapshot?.radio?.tracks).filter((item) =>
          ready(item.track.id),
        ),
      };
    }
    if (method !== "GET" && method !== "HEAD") return undefined;
    if (!this.snapshot && exact !== null && exact !== undefined) return exact;
    const {
      tracks: byId,
      albums: byAlbum,
      artists: byArtist,
      genres: byGenre,
      playlists,
    } = view;
    const tracks = [...byId.values()];
    const albums = [...byAlbum.values()];
    const artists = [...byArtist.values()];
    const genres = [...byGenre.values()];
    const recent = view.recent.map((track) => byId.get(track)).filter(Boolean);
    if (resource === "tracks" && uuid.test(id ?? "")) {
      const details = this.detail(this.snapshot?.detailsRevision, detail, id);
      if (detail === "lyrics") return details ?? this.cached(path) ?? null;
      if (detail === "waveform")
        return details ?? this.cached(path) ?? { peaks: [] };
    }
    if (path === "/api/me/settings") return this.snapshot?.settings ?? exact;
    if (path === "/api/config")
      return (
        exact ?? {
          recommendationsEnabled:
            this.snapshot?.recommendationsEnabled ?? false,
          accessTokenMinutes: 0,
        }
      );
    if (path === "/api/me/library") return [...view.library.values()];
    if (path === "/api/me/library/order") return view.order;
    if (path === "/api/me/library/folders") return [...view.folders.values()];
    if (path === "/api/favorites")
      return page(
        tracks.filter((track) => track.isFavorite).sort(latest),
        params,
      );
    if (path === "/api/history/recent") return page(recent, params);
    if (path === "/api/history") return page(view.history, params);
    if (path === "/api/search/popular") return exact ?? popularSearch(view);
    if (path === "/api/recommendations/rules") return view.rules;
    if (path === "/api/tracks")
      return page(
        trackSort(
          tracks.filter((track) => trackMatch(track, q)),
          params,
        ),
        params,
      );
    if (path === "/api/tracks/shuffle") {
      const limit = Math.max(
        1,
        Math.min(500, Number(params.get("limit")) || 100),
      );
      const available = trackSort(
        tracks.filter((track) => ready(track.id) && trackMatch(track, q)),
        params,
      );
      for (let end = available.length - 1; end > 0; end--) {
        const index = Math.floor(Math.random() * (end + 1));
        [available[index], available[end]] = [available[end], available[index]];
      }
      return available.slice(0, limit);
    }
    if (path === "/api/albums") {
      const albumArtist = params.get("artistId");
      return page(
        albums
          .filter(
            (album) =>
              (!albumArtist || album.artistId === albumArtist) &&
              includes(q, album.title, album.artistName),
          )
          .sort(
            params.get("recentFirst") === "true" ? latest : byName("title"),
          ),
        params,
      );
    }
    if (resource === "albums" && byAlbum.has(id)) {
      return {
        ...byAlbum.get(id),
        tracks: tracks
          .filter((track) => track.albumId === id)
          .sort(byTrackNumber),
      };
    }
    if (path === "/api/artists")
      return page(
        artists
          .filter((artist) => includes(q, artist.name))
          .sort(byName("name")),
        params,
      );
    if (resource === "artists" && byArtist.has(id)) {
      const credit = (track) =>
        track.artistId === id ||
        track.artists?.some((artist) => artist.id === id);
      const artistTracks = tracks.filter(credit);
      if (detail === "top-tracks") return artistTracks.slice(0, 10);
      const artistAlbums = new Set(artistTracks.map((track) => track.albumId));
      return {
        ...byArtist.get(id),
        albums: albums.filter(
          (album) => album.artistId === id || artistAlbums.has(album.id),
        ),
        tracks: page(artistTracks.sort(byTrackNumber), params),
      };
    }
    if (path === "/api/genres") return genres;
    if (resource === "genres" && detail === "tracks" && byGenre.has(id)) {
      return page(
        tracks.filter((track) => track.genreName === byGenre.get(id).name),
        params,
      );
    }
    if (path === "/api/playlists")
      return [...playlists.values()]
        .filter((item) => item.ownerId === this.user.id)
        .map((playlist) => this.playlist(view, playlist.id));
    if (path === "/api/playlists/public")
      return [...playlists.values()]
        .filter((item) => item.isPublic)
        .map((playlist) => this.playlist(view, playlist.id));
    if (resource === "playlists" && playlists.has(id)) {
      const playlist = this.playlist(view, id);
      return playlist.tracks
        ? playlist
        : (exact ?? { ...playlist, tracks: [] });
    }
    if (resource === "search") {
      const results = {
        tracks: tracks
          .filter((track) => trackMatch(track, q))
          .sort(byName("title")),
        artists: artists
          .filter((artist) => includes(q, artist.name))
          .sort(byName("name")),
        albums: albums
          .filter((album) => includes(q, album.title, album.artistName))
          .sort(byName("title")),
        genres: genres
          .filter((genre) => includes(q, genre.name))
          .sort(byName("name")),
      };
      if (own(results, id)) return page(results[id], params);
      const limit = Math.min(
        100,
        Math.max(1, Number(params.get("limit")) || 12),
      );
      return Object.fromEntries(
        Object.entries(results).map(([kind, items]) => [
          kind,
          items.slice(0, limit),
        ]),
      );
    }
    if (path === "/api/home/feed")
      return (
        this.snapshot?.feed ??
        exact ?? { blocks: [], stats: this.stats(tracks, albums) }
      );
    if (path.startsWith("/api/home/mixes/")) return this.homeMix(detail);
    if (path === "/api/library/overview")
      return {
        stats: this.stats(tracks, albums),
        recentTracks: tracks.slice().sort(latest).slice(0, 12),
        recentAlbums: albums.slice().sort(latest).slice(0, 12),
        recentArtists: artists.slice(0, 12),
        topGenres: genres.slice(0, 12),
      };
    return exact ?? undefined;
  }

  stats(tracks, albums) {
    return {
      trackCount: tracks.length,
      albumCount: albums.length,
      totalDurationSeconds: tracks.reduce(
        (total, track) => total + (track.durationSeconds ?? 0),
        0,
      ),
      totalBytes: array(this.snapshot?.files).reduce(
        (total, file) => total + file.size,
        0,
      ),
      freeBytes: 0,
      favoriteCount: tracks.filter((track) => track.isFavorite).length,
    };
  }
}

export { browse };
