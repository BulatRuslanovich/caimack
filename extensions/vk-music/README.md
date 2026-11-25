[Documentation](../../docs/README.md#music-library)

# Caimack VK Music

Search VK Music and import tracks or playlists into Caimack from a Chromium
browser such as Chrome, Brave, or Edge. The extension uses your signed-in VK
Music tab in the same browser profile. Caimack receives the search metadata
and selected audio. The VK login, access tokens, and audio URLs stay on the
VK side.

## Install and enable

1. Open the browser's extensions page (`brave://extensions`, `chrome://extensions` or
   `edge://extensions`), enable developer mode and use **Load unpacked** to select this
   `extensions/vk-music` directory.
2. Sign in to VK in that browser profile and leave the [VK Music tab](https://vk.ru/audio) open.
3. Open Caimack as an administrator. Check the connection in
   **Settings → Music sources**. Reload the extension after updating its files.

## Import tracks or playlists

Use the main **Search** field to look up a song or artist with VK Music
selected under **Sources**. Choose **Add to library** to import a matching
recording, or expand its available versions to pick the VK copy.

To import a playlist, paste its VK link into the same field and read the
preview. Caimack creates a private playlist in source order, reusing library
matches and reporting unavailable tracks.

## Use another server address

The unpacked extension accepts requests from `https://music.caimack.ru` and
local development addresses. For another instance, add its exact origin with
the `/*` suffix to `externally_connectable.matches` in [`manifest.json`](manifest.json).
Reload the extension after changing that file or updating the extension.

## Supported audio and tests

This version imports direct MP3 and FLAC files and clear HLS VOD with separate segment files up to
24 MiB. The server converts supported streamed audio to MP3. Search uses VK's web music interface,
whose response format can change.

From the repository root:

```sh
node --test scripts/vk-music.test.mjs
```
