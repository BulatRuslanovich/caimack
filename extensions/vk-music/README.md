# Caimack VK Music

Search VK Music and add a track to the Caimack library from Chromium, including Brave and Edge.
The extension uses the signed-in VK Music tab in the same browser profile. Caimack receives search
metadata and the selected audio file. The VK login, access tokens, and audio URLs stay on the VK side.

1. Open the browser's extensions page (`brave://extensions`, `chrome://extensions` or
   `edge://extensions`), enable developer mode and use **Load unpacked** to select this
   `extensions/vk-music` directory.
2. Sign in to VK in that browser profile and leave the [VK Music tab](https://vk.ru/audio) open.
3. Open an updated Caimack instance as an administrator. Enable **Import from VK Music** in
   **Settings → Experimental**, then go to **Search → VK Music** and search for a track or artist.
4. Select **Add to library** for a track. The music goes through Caimack's normal library upload.
   The import keeps the album name and artwork when VK provides them. Artwork goes into the file
   tags and, when there is an album, into the Caimack album cover.

To copy a whole playlist, use **Import playlist** in the VK Music search tab and paste its VK link.
Caimack creates a private playlist, reuses matches from the library, and downloads the remaining
available tracks in source order. The result shows tracks it could not add.

The unpacked extension accepts requests from `https://music.caimack.ru` and local development
addresses. For another self-hosted instance, add its exact origin with the `/*` suffix in
`externally_connectable.matches` in `manifest.json`, then reload the extension.

This version imports direct MP3 and FLAC files and clear HLS VOD with separate segment files up to
24 MiB. The server converts supported streamed audio to MP3. Search uses VK's web music interface,
whose response format can change.

```sh
node --test scripts/vk-music.test.mjs
```
