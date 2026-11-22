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
3. Open your Caimack server as an administrator and enable **VK Music** in
   **Settings → Experimental**. The web client and API must both include the
   [VK integration](../../docs/development.md#music-integration-modules).

## Import tracks or playlists

Go to **Search → VK Music** and look up a track or artist. Search shows cover
thumbnails when VK provides them. Use **Add to library** on a track. Caimack
uses its normal upload flow to save the track, its album name, and available
artwork. Artwork goes into the file tags and the album cover when applicable.

To copy a whole playlist, use **Import playlist** in the VK Music search tab and paste its VK link.
Caimack creates a private playlist, reuses matches from the library, and downloads the remaining
available tracks in source order. The result shows tracks it could not add.

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
