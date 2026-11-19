// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { Client } from "../app/client.mjs";
import { origin, serverOrigin } from "../app/server.mjs";
import { Storage } from "../app/storage.mjs";
import { safeName } from "../app/sync.mjs";
import { fixture, track, user } from "../test-support/server.mjs";

async function waitFor(read) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await read();
    if (result) return result;
    await setTimeout(30);
  }
  throw new Error("Timed out waiting for desktop state");
}

async function context(t) {
  const dir = await mkdtemp(join(tmpdir(), "caimack-desktop-"));
  const folder = join(dir, "music");
  await mkdir(folder);
  const database = new Storage(join(dir, "data"));
  const service = await fixture();
  const jar = new Map();
  const cookies = {
    set: async (value) => jar.set(value.name, value),
    remove: async (_url, name) => jar.delete(name),
    get: async () => [...jar.values()],
    flushStore: async () => {},
  };
  const options = {
    chooseFolder: async () => folder,
    resetBrowser: async () => {},
    coverToJpeg: async () => null,
  };
  let client = new Client(database, cookies, options);
  const request = (path, body, method = "POST", headers) => {
    const url = new URL(path, origin);
    return client.handle(
      new Request(
        url,
        body === undefined
          ? { headers }
          : {
              method,
              headers: { "content-type": "application/json", ...headers },
              body: JSON.stringify(body),
            },
      ),
      url,
    );
  };
  t.after(async () => {
    await client.account?.close();
    await service.close();
    database.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(
    (
      await request("/desktop/connection", {
        server: service.origin,
        allowHttp: true,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    await (
      await request("/api/auth/login", {
        username: "tester",
        password: "test-password",
      })
    ).json(),
    user,
  );
  return {
    ...service,
    folder,
    database,
    request,
    client: () => client,
    restart: async () => {
      await client.account?.close();
      client = new Client(database, cookies, options);
    },
  };
}

test("individual download resumes by range and plays after a restart without the server", async (t) => {
  const { state, request, client, restart } = await context(t);
  state.interrupted = true;
  await request("/desktop/downloads", { tracks: [track] });
  await waitFor(() => client().status().downloads[0]?.status === "failed");
  await request("/desktop/downloads", { tracks: [track] });
  await waitFor(() => client().status().downloads[0]?.status === "complete");
  assert.deepEqual(state.streamRequests, [null, "bytes=4096-"]);
  await waitFor(() =>
    client().account.catalog.cached("/api/tracks/" + track.id + "/lyrics"),
  );
  state.online = false;
  await restart();
  const path = "/api/tracks/" + track.id;
  assert.deepEqual(await (await request("/api/auth/me")).json(), user);
  assert.equal(
    (await (await request("/api/tracks")).json()).items[0].id,
    track.id,
  );
  assert.equal((await (await request(path + "/lyrics")).json()).plain, "hello");
  const audio = await request(path + "/stream", undefined, undefined, {
    range: "bytes=0-11",
  });
  assert.equal(audio.status, 206);
  assert.deepEqual(
    Buffer.from(await audio.arrayBuffer()),
    state.wave.subarray(0, 12),
  );
  assert.equal(
    (
      await request(path + "/stream", undefined, undefined, {
        range: "bytes=999999-",
      })
    ).status,
    416,
  );
  assert.equal(
    (await request("/desktop/downloads/" + track.id, {})).status,
    200,
  );
  assert.equal(client().status().downloads.length, 0);
});

test("individual downloads preserve a selected HLS rendition", async (t) => {
  const { state, request, client } = await context(t);
  state.quality = "Normal";
  await request("/desktop/downloads", { tracks: [track] });
  await waitFor(() => client().status().downloads[0]?.status === "complete");
  assert.equal(client().status().localTracks[track.id], "hls");
  state.online = false;
  const base = "/api/tracks/" + track.id + "/hls/";
  const master = await request(base + "master.m3u8?maxQuality=Low");
  assert.match(await master.text(), /normal\/index\.m3u8/);
  const segment = await request(
    base + "normal/media.m4s",
    undefined,
    undefined,
    { range: "bytes=44-50" },
  );
  assert.equal(segment.status, 206);
  assert.deepEqual(
    Buffer.from(await segment.arrayBuffer()),
    state.wave.subarray(44, 51),
  );
});

test("sync exports a verified mirror, patches tags and replays durable changes once", async (t) => {
  const { state, request, client, folder, restart } = await context(t);
  await request("/desktop/sync/folder", {});
  await request("/desktop/sync/config", { enabled: true });
  const run = async () => {
    await request("/desktop/sync/run", {});
    await waitFor(() => !client().status().sync.running);
    return client().status().sync;
  };
  assert.equal((await run()).error, null);
  assert.equal(client().status().localTracks[track.id], "original");
  const mirrorRoot = join(folder, (await readdir(folder))[0]);
  const album = join(mirrorRoot, "Test Artist", "Singles");
  const name = "Offline Track [ccccccc3]";
  const media = join(album, name + ".mp3");
  assert.match(await readFile(media, "utf8"), /^first/);
  assert.match(
    await readFile(join(album, name + ".lrc"), "utf8"),
    /\[00:00\.10\]hello/,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(mirrorRoot, ".caimack", "vectors.json"), "utf8"),
    ).items.length,
    0,
  );
  await writeFile(join(album, "independent.txt"), "keep me");
  state.tag = "new tags";
  assert.equal((await run()).error, null);
  assert.match(await readFile(media, "utf8"), /^new tags/);
  assert.deepEqual(state.audioRequests, [null]);

  state.online = false;
  assert.equal(
    (await request("/api/tracks/" + track.id + "/favorite", {})).status,
    204,
  );
  assert.equal(client().status().sync.pending, 1);
  await restart();
  assert.equal(
    (await (await request("/api/favorites")).json()).items[0].id,
    track.id,
  );
  state.online = true;
  state.loseReceipt = true;
  assert.ok((await run()).error);
  assert.equal(client().status().sync.pending, 1);
  assert.equal(state.actions.size, 1);
  assert.equal((await run()).error, null);
  assert.equal(client().status().sync.pending, 0);
  assert.equal(state.actions.size, 1);
  assert.equal(state.favorite, true);

  state.malformed = true;
  assert.match((await run()).error, /manifest/);
  assert.match(await readFile(media, "utf8"), /new tags/);
  state.present = false;
  state.malformed = false;
  assert.equal((await run()).error, null);
  await assert.rejects(readFile(media), { code: "ENOENT" });
  assert.equal(
    await readFile(join(album, "independent.txt"), "utf8"),
    "keep me",
  );
});

test("cross-platform file names and server origins are constrained", () => {
  assert.equal(safeName("CON.txt"), "_CON.txt");
  assert.equal(safeName("../Some:*Title"), "_Some__Title");
  assert.throws(() => serverOrigin("http://example.com", false));
  assert.throws(() => serverOrigin("https://user@example.com", false));
  assert.throws(() => serverOrigin("https://example.com/nested", false));
  assert.equal(
    serverOrigin("https://example.com", false),
    "https://example.com",
  );
});
