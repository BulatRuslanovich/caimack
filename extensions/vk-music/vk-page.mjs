// SPDX-License-Identifier: AGPL-3.0-only

// Chrome serializes this function into the VK page. Keep dependencies inside it.
export async function vkMusicRequest(query, trackId, playlistSource = null) {
  const maxBytes = 24 * 1024 * 1024;
  const maxCoverBytes = 2 * 1024 * 1024;
  const mediaHosts = [
    "vk.ru",
    "vk.com",
    "vkuseraudio.net",
    "vkuseraudio.ru",
    "okcdn.ru",
    "vkcdn.ru",
    "userapi.com",
  ];
  const signal = AbortSignal.timeout(trackId ? 60_000 : 12_000);

  function fail(code) {
    throw new Error(code);
  }

  function text(value) {
    // Legacy audio tuples may contain entities or markup from VK's renderer.
    const raw = typeof value === "string" ? value.slice(0, 1000) : "";
    return raw
      .replace(/<[^>]*>/g, "")
      .replace(
        /&(amp|quot|apos|lt|gt|nbsp|#39);/g,
        (entity) =>
          ({
            "&amp;": "&",
            "&quot;": '"',
            "&apos;": "'",
            "&lt;": "<",
            "&gt;": ">",
            "&nbsp;": " ",
            "&#39;": "'",
          })[entity],
      )
      .trim()
      .slice(0, 200);
  }

  function readMedia(raw) {
    if (!raw || typeof raw !== "object") return null;
    const tuple = Array.isArray(raw);
    const owner = String(tuple ? raw[1] : (raw.owner_id ?? raw.ownerId ?? ""));
    const number = String(tuple ? raw[0] : (raw.id ?? ""));
    if (!/^-?\d{1,20}$/.test(owner) || !/^\d{1,20}$/.test(number)) return null;
    return {
      id: `${owner}_${number}`,
      restricted: Boolean(
        tuple ? raw[21] : (raw.restrictionStatus ?? raw.restriction_status),
      ),
      url: tuple ? raw[2] : raw.url,
    };
  }

  function readTrack(raw) {
    const media = readMedia(raw);
    if (!media) return null;
    const tuple = Array.isArray(raw);
    const title = text(tuple ? raw[3] : raw.title);
    const artist = text(tuple ? raw[4] : (raw.artist ?? raw.performer));
    if (!title || !artist) return null;
    const duration = Number(tuple ? raw[5] : raw.duration);
    const hashes = tuple ? raw[13] : raw.hashes;
    const parts = typeof hashes === "string" ? hashes.split("/") : [];
    return {
      ...media,
      title,
      artist,
      duration:
        Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
      accessKey: tuple ? raw[24] : (raw.access_key ?? raw.accessKey),
      playbackHashes: [parts[2] || raw.actionHash, parts[5] || raw.urlHash],
      ...readMetadata(raw),
    };
  }

  function readMetadata(raw) {
    const tuple = Array.isArray(raw);
    const release = tuple ? raw[19] : raw?.album;
    const album = text(release?.title ?? raw?.album_title);
    const thumb = release?.thumb ?? raw?.thumb;
    const covers = [
      thumb?.photo_1200,
      thumb?.photo_600,
      thumb?.photo_300,
      thumb?.photo_270,
      thumb?.photo_135,
      thumb?.photo_68,
    ];
    if (tuple && typeof raw[14] === "string")
      covers.push(...raw[14].split(/,(?!\d)/));
    else covers.push(raw?.coverUrl_l, raw?.coverUrl_p, raw?.coverUrl_s);
    return {
      album,
      covers: covers.filter(
        (value) => typeof value === "string" && value.trim(),
      ),
    };
  }

  async function postAudio(params) {
    const response = await fetch("/al_audio.php", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      body: new URLSearchParams({ al: "1", ...params }),
      signal,
    });
    if (response.status === 401 || response.status === 403) fail("signInVk");
    if (!response.ok) fail("vkChanged");
    const body = await response.text();
    return JSON.parse(body.replace(/^\s*<!--/, "")).payload?.[1];
  }

  async function search() {
    const owner = String(window.vk?.id ?? "");
    if (!/^[1-9]\d*$/.test(owner)) fail("signInVk");
    const payload = await postAudio({
      act: "section",
      claim: "0",
      is_layer: "0",
      owner_id: owner,
      section: "search",
      q: query,
    });
    const section = payload?.[1];
    if (
      !section ||
      (!Object.hasOwn(section, "playlist") && !Array.isArray(section.playlists))
    ) {
      fail("vkChanged");
    }
    const playlists = section.playlist
      ? [section.playlist]
      : (section.playlists ?? []);
    const found = new Map();
    for (const playlist of playlists) {
      const list = playlist?.list;
      if (!Array.isArray(list)) continue;
      for (const row of list) {
        const track = readTrack(row);
        if (track && !found.has(track.id)) found.set(track.id, track);
        if (found.size >= 30) return found;
      }
    }
    return found;
  }

  async function loadPlaylist(source) {
    const user = String(window.vk?.id ?? "");
    if (!/^[1-9]\d*$/.test(user)) fail("signInVk");
    const identity =
      /^(-?\d{1,20})_(\d{1,20})(?:_([A-Za-z0-9-]{1,128}))?$/.exec(source);
    if (!identity) fail("invalidRequest");
    const cacheKey = Symbol.for("caimack.vk.playlist");
    const cached = window[cacheKey];
    if (
      cached?.source === source &&
      cached.user === user &&
      cached.expires > Date.now()
    )
      return cached;

    const api = window.vkApi;
    if (typeof api?.api !== "function") fail("playlistUnavailable");
    const [, owner, id, key] = identity;
    const call = (method, params) => api.api(method, params, {}, { signal });
    const [details, sourceTracks] = await Promise.all([
      call("audio.getPlaylistById", {
        owner_id: owner,
        playlist_id: id,
        ...(key && { access_key: key }),
      }),
      call("audio.getAudioIdsBySource", {
        source: "playlist",
        entity_id: source,
      }),
    ]);
    const title = text(details?.playlist?.title ?? details?.title);
    if (!title || !Array.isArray(sourceTracks?.audios))
      fail("playlistUnavailable");

    const orderedIds = new Map();
    const audios = sourceTracks.audios;
    let omitted = 0;
    for (const entry of audios) {
      const audioId = typeof entry === "string" ? entry : entry?.audio_id;
      const match =
        typeof audioId === "string" &&
        /^(-?\d{1,20}_\d{1,20})(?:_[\w-]{1,256})?$/.exec(audioId);
      if (!match) {
        omitted += 1;
        continue;
      }
      if (!orderedIds.has(match[1])) orderedIds.set(match[1], audioId);
    }

    const available = new Map();
    const ids = [...orderedIds.values()];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const reply = await call("audio.getById", {
        audios: ids.slice(offset, offset + 100).join(","),
      });
      const rows = Array.isArray(reply) ? reply : reply?.items;
      if (!Array.isArray(rows)) fail("playlistUnavailable");
      for (const row of rows) {
        const track = readTrack(row);
        if (track) available.set(track.id, track);
      }
    }
    const tracks = new Map();
    for (const [id, audioId] of orderedIds) {
      const track = available.get(id);
      if (track) {
        track.accessKey ||= audioId.slice(id.length + 1);
        tracks.set(id, track);
      } else {
        omitted += 1;
      }
    }
    const snapshot = {
      source,
      user,
      title,
      tracks,
      omitted,
      expires: Date.now() + 15 * 60_000,
    };
    window[cacheKey] = snapshot;
    return snapshot;
  }

  let sourceIssue = "mediaMissing";

  function httpsUrl(value, base = location.href) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, base);
      if (url.protocol !== "https:" || url.username || url.password || url.port)
        return null;
      return url;
    } catch {
      return null;
    }
  }

  function onHost(url, hosts) {
    return hosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  }

  function mediaUrl(value, base) {
    const url = httpsUrl(value, base);
    if (!url) return null;
    if (!onHost(url, mediaHosts)) {
      if (sourceIssue === "mediaMissing") sourceIssue = "mediaHost";
      return null;
    }
    if (url.pathname.includes("audio_api_unavailable")) {
      sourceIssue = "mediaPlayerOnly";
      return null;
    }
    return url;
  }

  async function fetchMedia(url) {
    if (!url) fail("unsupported");
    const response = await fetch(url, {
      credentials: "omit",
      redirect: "error",
      signal,
    }).catch(() => fail("mediaNetwork"));
    if (response.status === 401 || response.status === 403) fail("mediaDenied");
    if (response.status === 404 || response.status === 410)
      fail("mediaExpired");
    if (!response.ok) fail("mediaNetwork");
    return response;
  }

  async function readBytes(response, limit) {
    if (Number(response.headers.get("content-length")) > limit)
      fail("tooLarge");
    const reader = response.body?.getReader();
    if (!reader) fail("unavailable");
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { chunks, size };
        size += value.byteLength;
        if (size > limit) fail("tooLarge");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async function readPlaylist(url, response, depth = 0) {
    const manifest = await readBytes(response, 256 * 1024);
    const lines = (await new Blob(manifest.chunks).text())
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim());
    if (lines[0] !== "#EXTM3U") fail("unsupported");
    if (lines.some((line) => line.startsWith("#EXT-X-SESSION-KEY:")))
      fail("unsupported");
    if (lines.some((line) => line.startsWith("#EXT-X-STREAM-INF:"))) {
      if (depth >= 2) fail("unsupported");
      const variant = lines.findIndex((line) =>
        line.startsWith("#EXT-X-STREAM-INF:"),
      );
      const next = mediaUrl(lines[variant + 1], url);
      return readPlaylist(next, await fetchMedia(next), depth + 1);
    }
    if (
      !lines.includes("#EXT-X-ENDLIST") ||
      lines.some(
        (line) =>
          line.startsWith("#EXT-X-BYTERANGE:") ||
          (line.startsWith("#EXT-X-KEY:") &&
            !/^#EXT-X-KEY:METHOD=NONE(?:,|$)/.test(line)),
      )
    )
      fail("unsupported");

    const parts = [];
    for (const line of lines) {
      if (line.startsWith("#EXT-X-MAP:")) {
        const init = /^#EXT-X-MAP:URI="([^"]+)"$/.exec(line)?.[1];
        if (!init) fail("unsupported");
        parts.push(init);
      } else if (line && !line.startsWith("#")) {
        parts.push(line);
      }
    }
    if (parts.length === 0 || parts.length > 500) fail("unsupported");

    const chunks = [];
    let size = 0;
    for (const part of parts) {
      const result = await readBytes(
        await fetchMedia(mediaUrl(part, url)),
        maxBytes - size,
      );
      chunks.push(...result.chunks);
      size += result.size;
    }
    return { chunks, size };
  }

  function lookupAudio(items, id) {
    if (!Array.isArray(items)) return null;
    const raw = items.find((candidate) => readMedia(candidate)?.id === id);
    const media = readMedia(raw);
    return media ? { ...media, ...readMetadata(raw) } : null;
  }

  async function getAudioById(track, requestSignal) {
    const api = window.vkApi;
    if (typeof api?.api !== "function") return null;
    const key =
      typeof track.accessKey === "string" && /^[\w-]+$/.test(track.accessKey)
        ? track.accessKey
        : "";
    const result = await api.api(
      "audio.getById",
      { audios: key ? `${track.id}_${key}` : track.id, v: "5.204" },
      {},
      { signal: requestSignal },
    );
    return lookupAudio(
      Array.isArray(result) ? result : result?.items,
      track.id,
    );
  }

  async function resolveMedia(track, existing) {
    const hashes = track.playbackHashes;
    if (
      hashes.every(
        (hash) => typeof hash === "string" && /^[\w-]{1,256}$/.test(hash),
      )
    ) {
      const payload = await postAudio({
        act: "reload_audio",
        ids: [track.id, ...hashes].join("_"),
      }).catch((error) => {
        if (error?.message === "signInVk") throw error;
        return null;
      });
      const details = lookupAudio(payload?.[0], track.id);
      if (details?.restricted) fail("unavailable");
      const url = mediaUrl(details?.url);
      if (url && url.href !== existing?.href) return { url, details };
    }

    const details = await getAudioById(track, signal).catch(() => null);
    if (details?.restricted) fail("unavailable");
    return { url: mediaUrl(details?.url), details, checkedById: true };
  }

  async function openMedia(track) {
    const existing = mediaUrl(track.url);
    let downloadError;
    if (existing) {
      try {
        return { url: existing, response: await fetchMedia(existing) };
      } catch (error) {
        if (
          error?.message !== "mediaExpired" &&
          error?.message !== "mediaNetwork"
        )
          throw error;
        if (signal.aborted) throw error;
        downloadError = error;
      }
    }
    const media = await resolveMedia(track, existing);
    if (!media.url || media.url.href === existing?.href) {
      if (downloadError) throw downloadError;
      fail(sourceIssue);
    }
    return { ...media, response: await fetchMedia(media.url) };
  }

  async function importMetadata(track, media) {
    const metadataSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
    let album = media.details?.album || track.album;
    let covers = [...(media.details?.covers ?? []), ...track.covers];
    if (
      (!album || covers.length === 0) &&
      !media.checkedById &&
      !metadataSignal.aborted
    ) {
      const deadline = new Promise((resolve) => {
        metadataSignal.addEventListener("abort", () => resolve(null), {
          once: true,
        });
      });
      const details = await Promise.race([
        getAudioById(track, metadataSignal),
        deadline,
      ]).catch(() => null);
      if (details && !details.restricted) {
        album ||= details.album;
        if (covers.length === 0) covers = details.covers;
      }
    }
    const artworkHosts = [...mediaHosts, "vkuserphoto.ru"];
    for (const candidate of new Set(covers.slice(0, 6))) {
      if (metadataSignal.aborted) break;
      const url = httpsUrl(candidate);
      if (!url || !onHost(url, artworkHosts)) continue;
      try {
        const response = await fetch(url, {
          credentials: "omit",
          redirect: "error",
          signal: metadataSignal,
        });
        if (
          !response.ok ||
          !/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        )
          continue;
        const { chunks, size } = await readBytes(response, maxCoverBytes);
        if (size > 0)
          return { ...(album && { album }), cover: encode(chunks, size) };
      } catch {
        // Artwork is optional. Continue with the audio and any album name.
      }
    }
    return album ? { album } : {};
  }

  function encode(chunks, size) {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (typeof bytes.toBase64 === "function") return bytes.toBase64();
    const parts = [];
    for (let start = 0; start < size; start += 8192) {
      parts.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
    }
    return btoa(parts.join(""));
  }

  try {
    if (!["vk.ru", "vk.com"].includes(location.hostname)) fail("openVk");
    const playlist = playlistSource ? await loadPlaylist(playlistSource) : null;
    const tracks = playlist?.tracks ?? (await search());
    if (!trackId) {
      return {
        ...(playlist && { name: playlist.title, omitted: playlist.omitted }),
        tracks: Array.from(
          tracks.values(),
          ({ id, title, artist, duration, restricted }) => ({
            id,
            title,
            artist,
            duration,
            restricted,
          }),
        ),
      };
    }
    const track = tracks.get(trackId);
    if (!track || track.restricted) fail("unavailable");
    const media = await openMedia(track);
    const { url, response } = media;
    const mime = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .toLowerCase();
    const ext = url.pathname.toLowerCase();
    const isHls = ext.endsWith(".m3u8") || mime?.includes("mpegurl");
    const format = isHls
      ? "stream"
      : mime === "audio/flac" || ext.endsWith(".flac")
        ? "flac"
        : mime === "audio/mpeg" || ext.endsWith(".mp3")
          ? "mp3"
          : "stream";
    const { chunks, size } = isHls
      ? await readPlaylist(url, response)
      : await readBytes(response, maxBytes);
    if (size === 0) fail("unavailable");
    return {
      format,
      audio: encode(chunks, size),
      title: track.title,
      artist: track.artist,
      ...(await importMetadata(track, media)),
    };
  } catch (error) {
    const known = [
      "openVk",
      "signInVk",
      "invalidRequest",
      "playlistUnavailable",
      "vkChanged",
      "unavailable",
      "mediaMissing",
      "mediaHost",
      "mediaPlayerOnly",
      "mediaDenied",
      "mediaExpired",
      "mediaNetwork",
      "unsupported",
      "tooLarge",
    ];
    return {
      error: known.includes(error?.message)
        ? error.message
        : playlistSource
          ? "playlistUnavailable"
          : trackId
            ? "unavailable"
            : "vkChanged",
    };
  }
}
