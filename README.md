<p align="center">
  <img src="frontend/public/logo.svg" alt="Caimack vinyl C logo" width="96" height="96">
</p>

<h1 align="center">Caimack</h1>

<p align="center"><strong>Your music. Your server. Your next favourite.</strong></p>

<p align="center">
  A personal streaming service for your music collection,<br>
  with recommendations that run on your own hardware.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/Self--hosted-Docker_Compose-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Self-hosted with Docker Compose"></a>
  <a href="#on-the-phone"><img src="https://img.shields.io/badge/Listen-Web_%2B_Android-3DDC84?style=flat-square&logo=android&logoColor=white" alt="Web and native Android"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-555555?style=flat-square" alt="AGPL-3.0 license"></a>
</p>

<p align="center">
  <a href="#why-caimack">Why Caimack</a> ·
  <a href="#a-look-around">Screenshots</a> ·
  <a href="#quick-start">Get started</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="docs/screenshots/home-oled.webp" alt="Caimack home in OLED Black: personal radio, daily mix and new albums" width="100%">
</p>

Caimack gives your MP3 and FLAC collection a home of its own. Connect your music folder or upload
albums, invite the people you trust, and press play. Your server takes care of the library, the
listening history and the recommendations.

## Why Caimack

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>A radio that pays attention</h3>
      <p>Radio learns from your listening history and adapts to your current session.
      Local audio analysis connects tracks by their sound, powering recommendations and
      an explorable map of your collection.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Your collection stays yours</h3>
      <p>Keep the original files and connect your existing music folder read-only.
      Your listening history lives in your own database; audio analysis and recommendation
      ranking run on your hardware.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>A player with character</h3>
      <p>Cover colours, a spinning record and synchronized lyrics give the music a place on screen.
      Albums flow without gaps, and carefully timed transitions keep the queue
      moving naturally.</p>
    </td>
    <td width="50%" valign="top">
      <h3>At home and on the move</h3>
      <p>Listen in a browser or the native Android app. Take albums offline on your phone,
      then pick up a session on another device with your place in the track intact.</p>
    </td>
  </tr>
</table>

One Docker Compose setup brings up the app, database and HTTPS. No external account is required.

### Your library, your way

Save albums, artists and playlists to your personal library in the web and Android clients.
Organize them in nested folders, reorder items and switch between list and grid views.
Favourites and recently played music stay close at hand, alongside the full server catalog.

Lyrics follow the playback clock, with word or syllable highlighting when the source provides
that timing. Automatic lookup checks multiple providers and verifies the recording before
accepting a match; plain lyrics remain available when synchronized text cannot be found.
See [lyrics lookup and synchronization](docs/lyrics.md).

### Audiobooks

Open **Audiobooks** in the web sidebar or use the **All**, **Music**, and **Audiobooks** filters on
Android Home. Add books to your personal library and resume each book where you left off. Listening
positions sync when your devices reconnect to the same account. Download each book from its own
menu to listen offline. Full music library synchronization leaves audiobook downloads to that menu.

In Compose, place audiobooks in the project’s `audiobooks/` directory or set `AUDIOBOOKS_PATH`.
For a native backend, use `<STORAGE_ROOT>/audiobooks/`.
Each top-level folder is one book, with audio files and nested disc folders played in natural
filename order. Individual audio files in the root are also books. Supported containers include
MP3, FLAC, M4A, M4B, Ogg, Opus, and WAV. An M4B file plays as one continuous file.
A folder named `Author - Title [Narrator]` supplies display metadata. Books can use embedded
artwork or a JPEG, PNG, or WebP in the book directory. Name it `cover` or `folder` to select it
when there are several images.
Standalone audio files can use an image with the same basename. Audiobooks are scanned at startup,
on the library scan interval, and when a server administrator starts a scan from the Upload page.

## A look around

A few screens from the current web client using a live demo library, in **OLED Black** and **Coffee**.
The home screen above brings together personal radio, a daily mix and new additions to the library.

<p align="center">
  <img src="docs/screenshots/player-coffee.webp" alt="Full-screen player in Coffee with vinyl artwork, a waveform and FLAC quality information" width="100%">
</p>

<p align="center"><sub>Coffee · The full-screen player takes its colours from the cover art.</sub></p>

<p align="center">
  <img src="docs/screenshots/album-coffee.webp" alt="AM by Arctic Monkeys in Coffee: album details, track list and more from the artist" width="100%">
</p>

<p align="center"><sub>Coffee · Albums, track lists and more from the same artist.</sub></p>

### On the phone

The web app is a PWA with its own mobile layout. There is also a native Android client with
background playback, offline downloads and Android Auto.

[Individual downloads](docs/android-downloads.md) retain catalog metadata and
artwork for offline browsing. Android also supports opt-in
[HTTP connections to a local server](docs/android-local-http.md).

Android also supports opt-in [full library synchronization](docs/android-library-sync.md)
in private app storage. Original music, lyrics, artwork, vectors and server-prepared
mixes and radio remain available away from your local network. Offline listening and
playlist edits are merged back when the phone returns.

The normal player can also control another signed-in web or Android device.
Choose an output from the player's device button; playback controls, the queue
and progress follow that device. Sign in to the same account on both devices and keep
the receiving client open and connected. Choose **This device** to bring playback back.

<p align="center">
  <img src="docs/screenshots/mobile-oled.webp" alt="Mobile web player in OLED Black with album artwork, waveform and playback controls" width="320">
</p>

<p align="center"><sub>OLED Black · The same player, made for a smaller screen.</sub></p>

## Quick start

You'll need Docker with Compose v2 and a domain pointing at your server.

```bash
git clone https://github.com/BulatRuslanovich/caimack.git
cd caimack
./caimack.sh
```

On its first run the manager asks for your domain, music folder and admin username,
generates secrets and starts the prebuilt images from `ghcr.io`. Later runs open
an interactive server console with arrow-key navigation and direct shortcuts.
The entire manager is in English; no extra TUI packages are required.

```bash
./caimack.sh update                  # pull images and apply updates
./caimack.sh recommendations on      # opt in to MERT; auto-detect NVIDIA / AMD
./caimack.sh recommendations off     # return to the CPU-only deployment
./caimack.sh reset once              # recover the owner password
./caimack.sh status
```

Configuration changes are backed up in `.caimack/backups/`. Existing database and
JWT secrets are preserved. `setup.sh` remains a compatibility entry point.
See the [server manager guide](docs/server-manager.md) for standalone installation,
all commands and password reset behaviour.
See [backend logging](docs/backend-logging.md) for log levels, request IDs and diagnostic filters.

Open `https://<PUBLIC_DOMAIN>` and sign in as the owner: the music folder is scanned on its
own, and more music can be dropped onto the Upload page. Invite people from the Users page: each
invitation is a one-time link that lets them pick a username and a password.

<details>
<summary>Music folders & first-run analysis</summary>

The music folder is rescanned every hour (`LIBRARY_SCAN_INTERVAL_MINUTES`, `0` for manual only)
and from the Upload page. A file that disappears stays in the library for 30 days, so a drive that
is briefly disconnected costs no likes or history; a moved file keeps its track.

Recommendations are optional and disabled by default: no GPU, MERT image or weights
are required for a normal deployment. Add `-f docker-compose.recommendations.yml`
after your usual Compose files to enable the module. The API advertises this
capability; clients hide recommendation controls when it is disabled.

When enabled, track similarity uses **MERT-Large v1 (330M)** on an NVIDIA (CUDA) or supported AMD (ROCm) GPU. The `mert` container
downloads the pinned, ready-to-use weights (about 1.26 GB) from Hugging Face on the first embedding request
and keeps them in `storage/models/mert`. No training or model export runs on the server.
The library and playback are available while the model loads. Existing CLAP vectors
are automatically replaced in the background; recommendations and the map use only
compatible MERT vectors. The GPU worker starts on demand and releases its model
and GPU context after five idle minutes (`MERT_IDLE_TIMEOUT_SECONDS`, default `300`).

See [optional module deployment and cache reuse](docs/mert.md).

File names are left unchanged by default. Optional catalog-based renaming uses
`Artist - Title.ext`, keeps track IDs, history, favorites and existing MERT vectors,
and moves same-name lyric/image companion files together. See
[automatic file names](docs/file-names.md) for write access, collision handling and recovery.

Optional [metadata export](docs/metadata-export.md) embeds catalog artwork into
audio files and saves synchronized lyrics as adjacent `.lrc` files (or `.txt`
for plain lyrics). Enable `EXPORT_MUSIC_METADATA=true` with folder write access.

Listening behavior automatically scores recommendations; see [recommendation quality](docs/recommendations.md).

</details>

<details>
<summary>Manual setup & updates</summary>

To set it up by hand, copy `.env.example` to `.env` and fill in:

```env
POSTGRES_PASSWORD=   # openssl rand -hex 32 (it goes into a URL, so no special characters)
JWT_SIGNING_KEY=     # openssl rand -base64 48
OWNER_PASSWORD=      # password for the first admin account
PUBLIC_DOMAIN=       # domain for the automatic HTTPS certificate
MUSIC_LIBRARY_PATH=  # optional: a folder with your music, mounted read-only (default ./library)
AUDIOBOOKS_PATH=      # optional: audiobooks folder, mounted read-only (default ./audiobooks)
COMPOSE_FILE=docker-compose.yml:docker-compose.images.yml   # use the prebuilt images; leave out to build
```

Create the `audiobooks/` directory if you want to use it for books, then run `docker compose up -d`.
To update, run `docker compose pull && docker compose up -d`. Set `CAIMACK_VERSION` to pin a release.

Use `./caimack.sh install --build` for a source-based installation, or
`./caimack.sh --help` for the non-interactive options.

</details>

## Under the hood

<details>
<summary>Architecture, stack & source layout</summary>

```mermaid
flowchart LR
    web["Web app<br/>Next.js 16 · React 19"]
    android["Android app<br/>Compose · Media3"]
    caddy["Caddy<br/>automatic HTTPS"]
    api["API<br/>Rust · axum"]
    workers["Background workers<br/>ffmpeg HLS · MERT GPU embeddings · cue points<br/>recommendations · enrichment"]
    db[("PostgreSQL 17")]
    disk[("storage/<br/>music · covers · hls · models")]

    web --> caddy
    android --> caddy
    caddy --> api
    caddy --> web
    api --> db
    api --> disk
    workers --> db
    workers --> disk
```

| Part        | What it does                                                                                                                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/`  | Rust API (axum, sqlx). Workers transcode uploads to HLS, analyse cue points and tempo, send audio fragments to the optional local MERT GPU service, and look up lyrics across multiple providers and artist photos via Deezer. Recommendations and the library map use an in-memory embedding snapshot; sound duplicate detection uses Chromaprint. |
| `frontend/` | Next.js app with TanStack Query and hls.js. A service worker caches the shell, artwork and stream segments.                                                                                                                                                                                                             |
| `android/`  | Kotlin client using Jetpack Compose and Media3: background playback, downloads, Android Auto and a quick-settings radio tile.                                                                                                                                                                                           |
| `desktop/`  | Electron client for Windows and Linux with the web interface and Android-compatible offline downloads and library synchronization. See the [desktop guide](docs/desktop.md). |
| `db/`       | The database schema as numbered SQL migrations, applied by `caimack migrate` (the `migrate` service in Compose); the server only checks that the schema is current. See [db/README.md](db/README.md).                                                                                                                   |
| `deploy/`   | Caddyfile for the reverse proxy.                                                                                                                                                                                                                                                                                        |

</details>

## Development

You'll need Rust 1.94+, ffmpeg on `PATH`, Node.js 20.9+ with npm, Docker and, for the Android client, the Android SDK.

```bash
cp backend/.env.example backend/.env   # then set JWT_SIGNING_KEY and OWNER_PASSWORD
make backend
make frontend
```

`make help` lists everything. Before a push, run `make check` for formatting, lint and the Rust/web
tests, and `make test-db` for the PostgreSQL integration checks used by CI. SQL in the backend is checked against the database at
compile time; after changing a query, run `make sqlx` so builds without a database (CI,
Docker) see it.

To enable recommendations with the local backend, set these values in `backend/.env`
and restart the backend:

```env
RECOMMENDATIONS_ENABLED=true
MERT_URL=http://127.0.0.1:8090
```

Run `make mert` to start the local MERT worker on port 8090 using Docker with NVIDIA
GPU support. The image is built on first use; model weights are cached in
`storage/models/mert`. The GPU worker sleeps after five idle minutes. Rebuild its
dependencies when needed with `docker compose -f docker-compose.dev.yml build mert`.
In Git Bash on Windows, use `make SHELL=sh mert` and `make SHELL=sh backend`.
The web client reads the feature flag from the backend; reload it after restarting.

`make test-db` runs the Rust tests with PostgreSQL, including session revocation, catalog filters,
history validation and background job recovery. CI runs this group automatically using
`cargo test --workspace --all-features --locked`. The two tests that contact the real Deezer and
LRCLIB services remain opt-in. Plain `cargo test --workspace --locked` also works without a database
when compiled with `SQLX_OFFLINE=true`.

Playback clients include accumulated `listenedSeconds` alongside `playbackPosition` in
`POST /api/history`; seeking alone does not count as listening. Deploy matching web and Android
clients with a backend that requires this field so history recording continues to work.

To work on the frontend against another backend, point the dev proxy at it:

```bash
cd frontend
npm ci
BACKEND_INTERNAL_URL=https://music.example.com npm run dev
```

In PowerShell, set the variable before starting the server:

```powershell
cd frontend
npm ci
$env:BACKEND_INTERNAL_URL = "https://music.example.com"
npm run dev
```

Open `http://localhost:3000` and sign in with an account on that server. The development
server proxies `/api/*` to the configured backend; no local database or Rust process is
needed for this workflow. Requests use real server data, so library edits and playback
history are saved to that account. The proxy is only enabled in development.

### Releases

From a clean checkout, run from the repository root (Node.js and Git required):

```bash
node scripts/release.mjs 1.0.1 --check  # preview without changing files
node scripts/release.mjs 1.0.1          # update versions, commit, tag v1.0.1
```

The first release is `1.0.0`. The script synchronizes the frontend and desktop
packages and npm lockfiles, and the Rust workspace and Cargo lockfile. Android reads
the frontend package version. Versions use `X.Y.Z`, with each component from 0 to 99.
Android uses an offset for its numeric version code so `1.0.0` updates the earlier `2.4.0` builds.
Existing tags are never overwritten. Commit application changes before running the script.
If the requested version is already set and has no tag, the script tags the current commit.

To publish the commit and tag, run `git push origin HEAD && git push origin v1.0.1`.
Only pushing a `v*` tag triggers the Images workflow; regular branch pushes do not build or
publish Docker images. A stable tag such as `v1.0.1` publishes `1.0.1`, `1.0`, `latest`, and
a commit SHA tag for all three images. Prerelease tags do not update `latest`.
Pin these with `CAIMACK_VERSION=1.0.1`. The script itself does not push anything.

Images are compared with the latest earlier stable release reachable in Git history.
Only changed components are built: backend inputs include `db/migrations`, while
MERT uses `backend/scripts` separately. Changes to Dockerfiles, dependencies and
the Images workflow or its image selection script also trigger builds. Version-only
changes made by the release script are ignored. Unchanged images receive the new release tags directly in the
registry, preserving their digest, build version and source link. A missing previous
image falls back to a build. The first release and changes to the Images workflow
build all three images; the first release after introducing this optimization does too.

Test release tooling with `node --test scripts/image-plan.test.mjs scripts/release.test.mjs`.

### Android

```bash
make apk   # android/app/build/outputs/apk/release/app-release.apk
```

Run connected Android UI tests in their isolated application package:

```bash
cd android
./gradlew connectedDebugAndroidTest -PcaimackIsolatedUiTests=true
```

This installs `app.caimack.uitest` separately from the normal app. Connected
tests without this flag are blocked so test cleanup cannot remove the user's
installed app, sign-in data, or downloads. Build the normal APK without the flag.

<details>
<summary>Release signing for Android</summary>

A release build is signed with your own key, the same one every time: Android installs an update
only over an app signed with the same key. Create one once and keep it safe:

```bash
keytool -genkeypair -v -keystore ~/caimack-release.jks -alias caimack \
  -keyalg RSA -keysize 4096 -validity 10000
```

Then point the build at it in `android/keystore.properties` (ignored by git):

```properties
storeFile=/home/me/caimack-release.jks
storePassword=...
keyAlias=caimack
keyPassword=...
```

</details>

Tagged releases build a signed APK, publish it to GitHub Releases and deliver it
to a fixed Telegram group. The Android app checks for updates and shows release
notes with an APK download button. See [Android release automation](docs/android-release.md)
for signing, update sources and bot secrets.

## License

AGPL-3.0-only — see [LICENSE](LICENSE)
