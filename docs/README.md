# Caimack documentation

Choose a guide based on what you want to do. New to Caimack? Start with the
[README](../README.md#quick-start) to deploy the server and sign in.
See the [Caimack website](https://bulatruslanovich.github.io/caimack/) for a tour
of the app.

## Listen on your devices

| Guide | What you'll find |
| --- | --- |
| [Android downloads](android-downloads.md) | Download specific tracks, albums, or playlists and browse them offline. |
| [Android library synchronization](android-library-sync.md) | Get your entire music library onto your phone over your home network. |
| [Local HTTP on Android](android-local-http.md) | Connect to a configured HTTP endpoint on your local network. |
| [Windows and Linux desktop apps](desktop.md) | Connect, download music, synchronize a folder, and keep playback running in the tray. |
| [Listening stats](listening-stats.md) | Read weekly rankings, listening time, and recommendation metrics. |

## Run a server

| Guide | What you'll find |
| --- | --- |
| [Server manager](server-manager.md) | Installation, upgrades, backup locations, and owner password recovery. |
| [Optional recommendations module](mert.md) | Enable MERT on NVIDIA or AMD and diagnose the worker. |
| [Backend logging](backend-logging.md) | Follow logs, configure severity filters, and trace requests by ID. |
| [LAN monitoring](../deploy/monitoring/README.md) | Monitor the Linux server from a Windows PC using Grafana. |
| [Database migrations](../db/README.md) | Apply the schema, upgrade older deployments, and run database tests. |

## Music library

| Guide | What you'll find |
| --- | --- |
| [Audiobooks](audiobooks.md) | Add books, choose artwork, and sync listening progress. |
| [Lyrics lookup and synchronization](lyrics.md) | Understand lyric matching, karaoke timing, and provider settings. |
| [Music file naming](file-names.md) | Rename registered files from accepted catalog metadata. |
| [Artwork and lyric export](metadata-export.md) | Embed covers and save lyric files beside your music. |
| [Library map](library-map.md) | Explore sound similarity and understand why points appear or move. |

### Import from music services

Use **Settings → Music sources** to set up providers and independently enable
external search and import from links on this device. Use **Sources** in Search
to change the selection for the current search. Save a token to connect Yandex Music.
For VK, follow the [browser extension setup](../extensions/vk-music/README.md)
and keep a signed-in VK Music tab open.

Administrators can search for a song or paste a VK Music, Yandex Music or
public Spotify playlist link into the same search field. A song result groups
available versions by recording. For a link, select **Read playlist** to see
the preview, then **Add to library**. Caimack reuses matching library tracks
and creates a private playlist in source order. For Spotify it obtains audio
from the selected sources. Expand the status beside the track or playlist
link to retry missing tracks or choose a match manually.

The backend Docker image includes FFmpeg, the standalone yt-dlp executable
for YouTube and SoundCloud, and headless Chromium for long Spotify playlists.
A local backend looks for yt-dlp on PATH and next to the server executable.
Use `MUSIC_EXTRACTOR` or `MUSIC_CHROMIUM` to set a custom executable path.
SoundCloud search is available without yt-dlp. Its audio downloads need it.

See [adding a music provider](development.md#music-integration-modules) for
the source layout and registration contract.

## Develop and release

| Guide | What you'll find |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | What to include in a pull request and how contributions are licensed. |
| [Development](development.md) | Run the app locally, find the relevant source directory, and run checks. |
| [Releases](releases.md) | Bump versions, create a tag, and publish Docker images and app packages. |
| [Android release automation](android-release.md) | Configure signing and update checks, publish the APK, and retry a release. |
