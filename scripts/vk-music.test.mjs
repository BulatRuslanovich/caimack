// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { vkMusicRequest } from "../extensions/vk-music/vk-page.mjs";

const query = "Kingdom of Predators";
const trackId = "-42_17";
const host = "https://audio.vkuseraudio.net";
const song = {
  id: 17,
  owner_id: -42,
  title: "Kingdom of Predators",
  artist: "Hirano Yoshihisa",
  duration: 179,
  url: `${host}/audio.mp3`,
  access_key: "test-access-key",
};

function vkFixture(t, tracks, media = new Map(), userId = 123, reloaded) {
  globalThis.window = { vk: { id: userId } };
  globalThis.location = new URL("https://vk.ru/audio");
  t.after(() => {
    delete globalThis.window;
    delete globalThis.location;
  });
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === "/al_audio.php") {
      assert.equal(options.credentials, "same-origin");
      if (options.body.get("act") === "reload_audio") {
        assert.equal(options.body.get("ids"), `${trackId}_action_url`);
        return new Response(
          `<!--${JSON.stringify({ payload: [0, [[reloaded]]] })}`,
        );
      }
      assert.equal(options.body.get("q"), query);
      return new Response(
        `<!--${JSON.stringify({ payload: [0, [0, { playlist: { list: tracks } }]] })}`,
      );
    }

    assert.equal(options.credentials, "omit");
    const response = media.get(String(url));
    if (!response) assert.fail(`Unexpected URL: ${url}`);
    return response;
  });
  return fetch;
}

test("the Caimack web client and unpacked extension use the same ID", async () => {
  const manifestUrl = new URL(
    "../extensions/vk-music/manifest.json",
    import.meta.url,
  );
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const frontend = await readFile(
    new URL("../frontend/src/lib/vkMusic.ts", import.meta.url),
    "utf8",
  );
  const hash = createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest("hex");
  const id = hash
    .slice(0, 32)
    .replace(/./g, (digit) => "abcdefghijklmnop"[parseInt(digit, 16)]);
  assert.ok(frontend.includes(`"${id}"`));
});

test("search deduplicates results and keeps the VK URL and access key in the VK tab", async (t) => {
  const legacy = [
    17,
    -42,
    song.url,
    "<b>Kingdom</b> of Predators",
    "Hirano Yoshihisa",
    179,
  ];
  const fetch = vkFixture(t, [legacy, song]);
  assert.deepEqual(await vkMusicRequest(query, null), {
    tracks: [
      {
        id: trackId,
        title: song.title,
        artist: song.artist,
        duration: 179,
        restricted: false,
      },
    ],
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("an empty VK response is a successful search", async (t) => {
  vkFixture(t, []);
  assert.deepEqual(await vkMusicRequest(query, null), { tracks: [] });
});

test("reads a VK playlist in its source order even when metadata arrives reordered", async (t) => {
  const source = "123_2_access";
  const fetch = vkFixture(
    t,
    [],
    new Map([[song.url, new Response(Uint8Array.of(1, 2, 3))]]),
  );
  const api = t.mock.fn(async (method, params) => {
    if (method === "audio.getPlaylistById") {
      assert.deepEqual(params, {
        owner_id: "123",
        playlist_id: "2",
        access_key: "access",
      });
      return { playlist: { title: "My VK playlist" } };
    }
    if (method === "audio.getAudioIdsBySource") {
      assert.deepEqual(params, { source: "playlist", entity_id: source });
      return {
        audios: [
          { audio_id: "-42_18" },
          { audio_id: "-42_17_songkey" },
          { audio_id: "-42_20" },
        ],
      };
    }
    if (method === "audio.getById") {
      return [song, { ...song, id: 18, title: "First" }];
    }
    assert.fail(method);
  });
  window.vkApi = { api };
  const playlist = await vkMusicRequest("", null, source);
  assert.equal(playlist.name, "My VK playlist");
  assert.deepEqual(
    playlist.tracks?.map(({ id }) => id),
    ["-42_18", "-42_17"],
  );
  assert.equal(playlist.omitted, 1);
  assert.equal(fetch.mock.callCount(), 0);
  assert.ok(!JSON.stringify(playlist).includes("songkey"));
  assert.ok((await vkMusicRequest("", trackId, source)).audio);
  assert.equal(
    api.mock.calls.filter(
      ({ arguments: [method] }) => method === "audio.getAudioIdsBySource",
    ).length,
    1,
  );
});

test("a signed-out VK tab does not send the search request", async (t) => {
  const fetch = vkFixture(t, [song], new Map(), 0);
  assert.deepEqual(await vkMusicRequest(query, null), { error: "signInVk" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("an MP3 is returned with its original bytes and selected metadata", async (t) => {
  const body = Uint8Array.of(0x49, 0x44, 0x33, 3, 0);
  vkFixture(
    t,
    [song],
    new Map([
      [
        song.url,
        new Response(body, {
          headers: { "content-type": "audio/mpeg" },
        }),
      ],
    ]),
  );
  assert.deepEqual(await vkMusicRequest(query, trackId), {
    format: "mp3",
    audio: Buffer.from(body).toString("base64"),
    title: song.title,
    artist: song.artist,
  });
});

test("adds the VK album name and its preferred cover to the import", async (t) => {
  const image = "https://sun9-12.vkuserphoto.ru/cover.jpg";
  const smallImage = "https://sun9-12.vkuserphoto.ru/small.jpg";
  const track = {
    ...song,
    album: {
      title: "Hunter &amp; Hunter OST",
      thumb: { photo_600: image, photo_300: smallImage },
    },
  };
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
  const fetch = vkFixture(
    t,
    [track],
    new Map([
      [song.url, new Response(Uint8Array.of(1, 2, 3))],
      [
        image,
        new Response(jpeg, { headers: { "content-type": "image/jpeg" } }),
      ],
    ]),
  );
  const result = await vkMusicRequest(query, trackId);
  assert.equal(result.album, "Hunter & Hunter OST");
  assert.equal(result.cover, Buffer.from(jpeg).toString("base64"));
  assert.equal(fetch.mock.callCount(), 3);
  assert.ok(!JSON.stringify(result).includes(image));
});

test("keeps the album when a legacy track cover fails", async (t) => {
  const image = "https://sun9-12.userapi.com/cover.jpg";
  const legacy = [17, -42, song.url, song.title, song.artist, song.duration];
  legacy[14] = image;
  legacy[19] = { title: "Hunter x Hunter OST" };
  vkFixture(
    t,
    [legacy],
    new Map([
      [song.url, new Response(Uint8Array.of(1, 2, 3))],
      [image, new Response(null, { status: 404 })],
    ]),
  );
  const result = await vkMusicRequest(query, trackId);
  assert.equal(result.album, legacy[19].title);
  assert.equal(result.cover, undefined);
  assert.ok(result.audio);
});

test("uses the current VK audio details to fill a missing album", async (t) => {
  vkFixture(
    t,
    [song],
    new Map([[song.url, new Response(Uint8Array.of(1, 2, 3))]]),
  );
  window.vkApi = {
    api: t.mock.fn(async () => [
      { ...song, album: { title: "Hunter x Hunter OST" } },
    ]),
  };
  const result = await vkMusicRequest(query, trackId);
  assert.equal(result.album, "Hunter x Hunter OST");
  assert.equal(window.vkApi.api.mock.callCount(), 1);
});

test("the VK tab resolves a selected result without a media URL", async (t) => {
  const body = Uint8Array.of(0x49, 0x44, 0x33, 3, 0);
  vkFixture(
    t,
    [{ ...song, url: "" }],
    new Map([[song.url, new Response(body)]]),
  );
  window.vkApi = {
    api: t.mock.fn(async () => [
      [17, -42, song.url, song.title, song.artist, song.duration],
    ]),
  };
  const result = await vkMusicRequest(query, trackId);
  assert.equal(result.audio, Buffer.from(body).toString("base64"));
  assert.equal(window.vkApi.api.mock.calls[0].arguments[0], "audio.getById");
});

test("refreshes an expired search URL through the signed-in VK player", async (t) => {
  const fresh = `${host}/fresh.mp3`;
  const body = Uint8Array.of(0x49, 0x44, 0x33, 3, 0);
  vkFixture(
    t,
    [{ ...song, hashes: "//action///url" }],
    new Map([
      [song.url, new Response(null, { status: 404 })],
      [fresh, new Response(body)],
    ]),
    123,
    { id: song.id, owner_id: song.owner_id, url: fresh },
  );
  const result = await vkMusicRequest(query, trackId);
  assert.equal(result.audio, Buffer.from(body).toString("base64"));
});

test("reports a missing direct URL when the player supplies no URL", async (t) => {
  const fetch = vkFixture(t, [{ ...song, url: "" }]);
  assert.deepEqual(await vkMusicRequest(query, trackId), {
    error: "mediaMissing",
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("reports a player-only source without requesting the playback placeholder", async (t) => {
  const url = "https://vk.ru/mp3/audio_api_unavailable.mp3?extra=test";
  const fetch = vkFixture(t, [{ ...song, url }]);
  assert.deepEqual(await vkMusicRequest(query, trackId), {
    error: "mediaPlayerOnly",
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("imports a direct audio URL from the OK CDN used by VK", async (t) => {
  const url = "https://vd546.okcdn.ru/music/track.mp3";
  const body = Uint8Array.of(0x49, 0x44, 0x33, 3, 0);
  vkFixture(t, [{ ...song, url }], new Map([[url, new Response(body)]]));
  const result = await vkMusicRequest(query, trackId);
  assert.equal(result.audio, Buffer.from(body).toString("base64"));
});

test("reports a CDN refusal without retrying as a different source", async (t) => {
  const fetch = vkFixture(
    t,
    [song],
    new Map([[song.url, new Response(null, { status: 403 })]]),
  );
  assert.deepEqual(await vkMusicRequest(query, trackId), {
    error: "mediaDenied",
  });
  assert.equal(fetch.mock.callCount(), 2);
});

test("a clear VOD HLS stream is assembled in playlist order", async (t) => {
  const url = `${host}/album/track.m3u8`;
  vkFixture(
    t,
    [{ ...song, url }],
    new Map([
      [
        url,
        new Response(
          '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\none.m4s\n#EXTINF:3,\ntwo.m4s\n#EXT-X-ENDLIST',
        ),
      ],
      [`${host}/album/init.mp4`, new Response(Uint8Array.of(1, 2))],
      [`${host}/album/one.m4s`, new Response(Uint8Array.of(3, 4))],
      [`${host}/album/two.m4s`, new Response(Uint8Array.of(5, 6))],
    ]),
  );
  const result = await vkMusicRequest(query, trackId);
  assert.equal(result.format, "stream");
  assert.deepEqual(
    Array.from(Buffer.from(result.audio, "base64")),
    [1, 2, 3, 4, 5, 6],
  );
});

test("encrypted playlists stop before a key or segment is requested", async (t) => {
  const url = `${host}/track.m3u8`;
  const fetch = vkFixture(
    t,
    [{ ...song, url }],
    new Map([
      [
        url,
        new Response(
          '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:4,\none.ts\n#EXT-X-ENDLIST',
        ),
      ],
    ]),
  );
  assert.deepEqual(await vkMusicRequest(query, trackId), {
    error: "unsupported",
  });
  assert.equal(fetch.mock.callCount(), 2);
});

test("restricted tracks and URLs outside the VK media hosts are not downloaded", async (t) => {
  const fetch = vkFixture(t, [
    { ...song, restrictionStatus: "blocked" },
    {
      ...song,
      id: 18,
      url: "https://vkuseraudio.net.example.com/song.mp3",
    },
  ]);
  assert.deepEqual(await vkMusicRequest(query, trackId), {
    error: "unavailable",
  });
  assert.deepEqual(await vkMusicRequest(query, "-42_18"), {
    error: "mediaHost",
  });
  assert.equal(fetch.mock.callCount(), 2);
});
