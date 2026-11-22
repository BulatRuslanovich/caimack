# Caimack documentation

Choose a guide based on what you want to do. New to Caimack? Start with the
[README](../README.md#quick-start) to deploy the server and sign in.

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

An administrator can enable a provider in **Settings → Experimental** and open
its tab in **Search**. For Yandex Music, save your token in the provider settings
before searching or importing a playlist. For VK Music, follow the
[browser extension setup](../extensions/vk-music/README.md).

The provider must be present in both the web and API builds. See
[integration build options](development.md#music-integration-modules).

## Develop and release

| Guide | What you'll find |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | What to include in a pull request and how contributions are licensed. |
| [Development](development.md) | Run the app locally, find the relevant source directory, and run checks. |
| [Releases](releases.md) | Bump versions, create a tag, and publish Docker images and app packages. |
| [Android release automation](android-release.md) | Configure signing and update checks, publish the APK, and retry a release. |
