[Documentation](README.md#listen-on-your-devices)

# Caimack Desktop

Caimack Desktop brings the web app's library, search, and player to Windows
and Linux, with offline downloads and tray playback.

When you start a new queue from a playlist or album, the full player links back
to that collection. The link follows the queue when you switch playback devices
in current versions of Caimack.
Pin the playback queue to keep it beside the catalog. In narrower windows the
navigation switches to icons while the queue is open.

## Install and connect

Download a package for your platform from
[GitHub Releases](https://github.com/BulatRuslanovich/caimack/releases).
Enter the server address, including its scheme and port when needed, and sign
in with your existing account. For an HTTP endpoint on your own network, turn
on **Allow HTTP on the local network** on the connection screen.

The portable Windows executable keeps its profile and individual downloads in
`Caimack Data` beside the executable. Synchronized libraries stay in their
selected folder. Windows may require you to sign in after you move the portable
profile to another machine.

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

## Keep playback and downloads running

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

`make desktop` installs the project dependencies and builds packages for the
host. On Windows, `make desktop-windows` builds the x64 NSIS installer and
portable executable. On Linux, `make desktop-linux` builds the x86-64 AppImage,
Debian package and tarball. The output directory is `desktop/release`.

On Arch Linux, `make desktop-arch` also builds the native `.pkg.tar.zst` with
`makepkg`. Find it under `desktop/release/arch` and install it with
`sudo pacman -U ./caimack-desktop-VERSION-1-x86_64.pkg.tar.zst` from that directory.
The AppImage supports `--appimage-extract-and-run` if FUSE is unavailable.

## Releases

Pushing a version tag such as `v1.2.3` starts the
[release workflow](../.github/workflows/android-release.yml). It calls the
[desktop build](../.github/workflows/desktop-release.yml), checks both npm
package versions against the tag, and stages the Windows and Linux packages
before publishing the same GitHub Release as the APK. The desktop packages are
also available as workflow artifacts. For a manual rebuild, select **Also build
the desktop packages for this tag** when starting the Android release workflow.
Windows release executables are unsigned.
