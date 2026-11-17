// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { createServer } from "node:http";

export const serverId = "aaaaaaa1-0000-4000-8000-000000000001";
export const user = {
  id: "bbbbbbb2-0000-4000-8000-000000000002",
  username: "tester",
  isAdmin: false,
};
export const track = {
  id: "ccccccc3-0000-4000-8000-000000000003",
  title: "Offline Track",
  artistId: "ddddddd4-0000-4000-8000-000000000004",
  artistName: "Test Artist",
  originalFileName: "fixture.wav",
  durationSeconds: 4,
  hasCover: false,
  hasLyrics: true,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wave = () => {
  const length = 8000 * 4 * 2;
  const buffer = Buffer.alloc(44 + length);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(length, 40);
  return buffer;
};

export async function fixture() {
  const state = {
    online: true,
    tag: "first",
    present: true,
    favorite: false,
    malformed: false,
    quality: "Original",
    audioRequests: [],
    streamRequests: [],
    actions: new Map(),
    interrupted: false,
    loseReceipt: false,
    wave: wave(),
  };
  const payload = Buffer.from("stable encoded music data");
  const data = () => Buffer.concat([Buffer.from(state.tag), payload]);
  const file = () => ({
    id: track.id,
    audioVersion: sha(payload),
    fileHash: sha(data()),
    size: data().length,
    extension: "mp3",
  });
  const currentTrack = () => ({ ...track, isFavorite: state.favorite });
  const text = {
    trackId: track.id,
    plain: "hello",
    source: "Manual",
    lines: [{ at: 100, text: "hello" }],
  };
  const pagina = (items) => ({
    items,
    page: 1,
    pageSize: 100,
    total: items.length,
    totalPages: 1,
  });
  const cookies = [
    "ms_access=fixture-token; Path=/; HttpOnly; Expires=Fri, 01 Jan 2038 00:00:00 GMT",
    "ms_refresh=fixture-refresh; Path=/; HttpOnly; Expires=Fri, 01 Jan 2038 00:00:00 GMT",
  ];
  const service = createServer(async (request, response) => {
    if (!state.online) return request.destroy();
    const url = new URL(request.url, "http://127.0.0.1");
    const path = url.pathname;
    const json = (value, status = 200, extra) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        ...extra,
      });
      response.end(JSON.stringify(value));
    };
    const bytes = (buffer, list, type) => {
      const etag = '"' + sha(buffer) + '"';
      const start = /^bytes=(\d+)-$/.exec(request.headers.range ?? "")?.[1];
      list.push(request.headers.range ?? null);
      if (start && Number(start) < buffer.length) {
        response.writeHead(206, {
          ETag: etag,
          "Content-Type": type,
          "Content-Length": buffer.length - Number(start),
          "Content-Range": `bytes ${start}-${buffer.length - 1}/${buffer.length}`,
        });
        response.end(buffer.subarray(Number(start)));
      } else {
        response.writeHead(200, {
          ETag: etag,
          "Content-Type": type,
          "Content-Length": buffer.length,
        });
        if (state.interrupted && list === state.streamRequests) {
          state.interrupted = false;
          response.write(buffer.subarray(0, 4096));
          setTimeout(() => response.destroy(), 100);
        } else response.end(buffer);
      }
    };
    if (path === "/api/auth/login") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const parsed = JSON.parse(Buffer.concat(chunks));
      return parsed.username === "tester" && parsed.password === "test-password"
        ? json(user, 200, { "Set-Cookie": cookies })
        : json({ detail: "Incorrect credentials" }, 401);
    }
    if (path === "/api/auth/refresh") {
      return request.headers.cookie?.includes("ms_refresh=fixture-refresh")
        ? json(user, 200, { "Set-Cookie": cookies })
        : json({ detail: "Signed out" }, 401);
    }
    if (
      path === "/api/auth/me" &&
      !request.headers.cookie?.includes("ms_access=fixture-token")
    )
      return response.writeHead(401).end();
    if (!request.headers.cookie?.includes("ms_access=fixture-token"))
      return json({ detail: "Signed out" }, 401);
    if (path === "/api/auth/me") return json(user);
    if (path === "/api/auth/logout") return response.writeHead(204).end();
    if (path === "/api/config")
      return json({ recommendationsEnabled: false, accessTokenMinutes: 15 });
    if (path === "/api/me/settings")
      return json({ quality: state.quality, timeZone: "UTC" });
    if (path === "/api/home/feed")
      return json({
        blocks: [],
        stats: {
          trackCount: 1,
          albumCount: 0,
          totalDurationSeconds: 4,
          totalBytes: state.wave.length,
          freeBytes: 0,
          favoriteCount: Number(state.favorite),
        },
      });
    if (path === "/api/tracks")
      return json(pagina(state.present ? [currentTrack()] : []));
    if (path === "/api/favorites")
      return json(pagina(state.favorite ? [currentTrack()] : []));
    if (path === "/api/sync/snapshot")
      return json({
        protocol: 1,
        serverId,
        user,
        tracks: state.present ? [currentTrack()] : [],
        files: state.present && !state.malformed ? [file()] : [],
        albums: [],
        artists: [],
        playlists: [],
        genres: [],
        savedLibrary: [],
        libraryFolders: [],
        libraryOrder: {},
        playlistTracks: {},
        generatedAt: "2026-01-01T00:00:00Z",
        assets: [],
        vectorVersion: sha("empty vectors"),
        lyrics: state.present ? { [track.id]: text } : {},
        waveforms: state.present ? { [track.id]: { peaks: [1, 2] } } : {},
        radio: { tracks: [] },
        mixes: {},
      });
    if (path === "/api/sync/vectors") return json({ protocol: 1, items: [] });
    if (path === "/api/sync/actions") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const batch = JSON.parse(Buffer.concat(chunks));
      if (batch.serverId !== serverId || batch.userId !== user.id)
        return json({ detail: "Wrong binding" }, 409);
      const results = batch.actions.map((action) => {
        if (!state.actions.has(action.id)) {
          state.actions.set(action.id, action);
          if (action.kind === "favorite") state.favorite = action.payload.value;
        }
        return { id: action.id, status: "applied" };
      });
      if (state.loseReceipt) {
        state.loseReceipt = false;
        return response.destroy();
      }
      return json({ results });
    }
    if (path === "/api/sync/tracks/" + track.id + "/audio") {
      if (url.searchParams.get("version") !== file().fileHash)
        return response.writeHead(412).end();
      return bytes(data(), state.audioRequests, "audio/mpeg");
    }
    if (path === "/api/sync/tracks/" + track.id + "/tags")
      return json({
        fileHash: file().fileHash,
        audioVersion: file().audioVersion,
        prefix: Buffer.from(state.tag).toString("base64"),
        suffix: "",
        payloadSize: payload.length,
      });
    if (path === "/api/tracks/" + track.id + "/stream")
      return bytes(state.wave, state.streamRequests, "audio/wav");
    if (path === "/api/tracks/" + track.id + "/lyrics") return json(text);
    if (path === "/api/tracks/" + track.id + "/waveform")
      return json({ peaks: [1, 2] });
    if (path.endsWith("/hls/master.m3u8")) {
      return response
        .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
        .end(
          "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nnormal/index.m3u8\n",
        );
    }
    if (path.endsWith("/hls/normal/index.m3u8")) {
      return response
        .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
        .end(
          '#EXTM3U\n#EXT-X-MAP:URI="media.m4s",BYTERANGE="8@0"\n#EXTINF:4,\nmedia.m4s\n#EXT-X-ENDLIST\n',
        );
    }
    if (path.endsWith("/hls/normal/media.m4s"))
      return bytes(state.wave, state.streamRequests, "audio/mp4");
    if (path === "/api/playback/signals") return response.writeHead(204).end();
    return json({ detail: "Fixture route not found " + path }, 404);
  });
  await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
  return {
    state,
    origin: "http://127.0.0.1:" + service.address().port,
    close: () =>
      new Promise((resolve) => {
        service.close(resolve);
        service.closeAllConnections();
      }),
  };
}
