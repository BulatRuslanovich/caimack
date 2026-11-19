# Caimack Desktop

Caimack Desktop runs the same library, search, player and settings screens as
the web client. Enter the origin of your Caimack server and sign in with your
existing account. For an HTTP server on your own network, enable **Allow HTTP
on the local network** on the connection screen.

## Downloads

Open a track's menu and choose **Download**. Albums, playlists and artists have
a download button next to the playback controls. Go to **Library → Downloads**
to play local copies, see progress, cancel, retry or remove downloads. The
application keeps metadata, artwork, lyrics and waveforms in the current profile
so downloaded audio remains playable after a restart without the server.
Automatic downloading can retain the daily mix and recent favourites.

## Library synchronization

In **Downloads → Library synchronization**, choose a folder and turn on
synchronization. Use **Sync now / resume** to start or **Pause** to stop
transfers. The client uses the Android synchronization protocol, including
original audio, tag-only updates, a validated catalog, relative M3U8 playlists,
lyrics, cover images and vector exports. The connection must resolve to a
private or link-local address. A server on the same machine can also use
loopback.

Each server and account gets its own managed subfolder in the selected folder.
Disabling synchronization keeps the exported files on disk. The client retains
offline actions until the server confirms them and the next catalog is accepted.
Rejected changes appear in the synchronization settings. Pressing **Pause**
leaves pending changes available for the next run.

Synchronization and downloads run with the window minimized. Enable **Keep
Caimack running in the tray** to continue after closing the window. Use the tray
menu or launch Caimack again to show the window, or choose **Quit** to exit.

## Build and test

Run these commands from the repository root with Node.js 24 or later and npm.

```sh
npm ci --prefix frontend
npm ci --prefix desktop
npm run build --prefix desktop
npm start --prefix desktop
npm test --prefix desktop
npm run test:smoke --prefix desktop
```

Use `npm run dist:appimage --prefix desktop` on Linux to build only the x86-64
AppImage in `desktop/release`. An AppImage can use
`--appimage-extract-and-run` if FUSE is unavailable.

Use `npm run dist:linux --prefix desktop` to build all Linux packages. The
generated Arch recipe is in `desktop/release/arch` with its checksummed source
bundle, icon and desktop entry. In that directory, use `makepkg -si` on Arch.

Use `npm run dist:windows --prefix desktop` on Windows for the x64 NSIS
installer and portable executable. The portable executable keeps its profile
and individual downloads in `Caimack Data` beside the executable. A music
folder selected for synchronization remains a separate location. Windows may
require a fresh sign-in after moving the portable profile to another machine.

The [desktop CI workflow](../.github/workflows/desktop-ci.yml) tests the
installer, portable executable, AppImage, Debian and Arch packages. It uploads
the builds and Arch recipe as workflow artifacts. Local Windows builds are
unsigned unless code-signing credentials are configured.
