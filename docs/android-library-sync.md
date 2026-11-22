[Documentation](README.md#listen-on-your-devices)

# Android library synchronization

Full library sync copies your music collection to private Android app storage
over your home network. For a few tracks or albums, use
[individual downloads](android-downloads.md).

## Start or pause synchronization

1. Connect the phone and the server to the same local network.
2. Open **Settings → Downloads** and turn on **Full library synchronization**.
   The app starts a foreground transfer and shows its progress in a notification.
3. Use **Pause** in the notification to stop the transfer. Turn the switch off
   and on again to resume. Completed music stays in **Library → Downloads**.

Automatic jobs persist across reboot and run on a 15-minute schedule, with
additional attempts after joining a local network or recording an action.
Charging is optional. Android may defer jobs in Doze or under manufacturer
battery restrictions.

## Connect to the local server

The server must be reachable at a local address over Wi-Fi or Ethernet. The
sync client binds its connections and DNS resolution to that network, rejects
public, loopback and multicast addresses, and never falls back to cellular or a
VPN connection. A VPN configured to prevent local access must allow the server
or be disconnected. Android 17 additionally requires local-network permission.

### A public domain on the home Wi-Fi

Joining the same Wi-Fi does not change where a domain points. If the domain
still resolves to a public IP, synchronization rejects it, even if the router
routes that connection back to the home server.

For a home PC/NAS, add a local DNS override on the router or home DNS server:
the existing Caimack hostname should resolve to that machine's LAN IP. The phone
must use that DNS server. The local HTTPS endpoint must serve that hostname with
a trusted certificate. The app can then keep its existing server address and
account binding. All returned A/AAAA addresses must be local; a remaining public
IPv6 answer also prevents synchronization.

Alternatively, sign in using the local IP and the actual listening port. For an
HTTP endpoint, follow [local HTTP setup](android-local-http.md). A different
server URL creates its own offline binding. Sync uses the same server address
as regular playback.

The default Docker/Caddy deployment serves the configured hostname over HTTPS.
Full sync does not follow redirects. Use the final server address with a trusted
certificate and local DNS, or explicitly configure a separate local HTTP
endpoint and enter its full address.

## Files and playback

Full sync downloads the original audio into the same private Media3 cache used by
individual downloads. The app retains covers, artist images, playlist artwork,
lyrics, waveforms, metadata, vectors and server-prepared mixes in private storage.
Gallery apps cannot index these files. The catalog retains the lyrics API's
word intervals and provider attribution, as well as the playlist membership and
ordering needed for offline playback.

The Android client stores vectors as opaque data in an atomic file using a
fixed-size buffer. Catalog JSON is read and written through streams. Lyrics and
waveforms are decoded per track when needed.

While synchronization is active, **Library → Downloads** lists each downloaded
track once and shows progress. Track and collection download
controls are available in individual-download mode.

Media3 resumes interrupted audio transfers and skips already cached versions.
A replacement becomes the playback source after its SHA-256 checksum is verified.
The versioned audio endpoint checks the requested file version before serving bytes.
Server deletions remove copies managed by sync after the app accepts a complete
manifest. Account and server checks bind offline data and pending edits to their
owner.

After an update from a version that exported to a selected folder, Caimack
plays those copies while the next sync downloads them into private storage.
The old exports stay in the folder originally selected.

## Browsing individual downloads

The main **Library** keeps your saved albums, artists, playlists, and folders.
**Library → Downloads** lists available offline audio. The
[individual downloads guide](android-downloads.md#browse-and-play-offline)
describes how cached pages and offline playback work.

Downloaded playlist/artist metadata and artwork are isolated by server and account.
Legacy server-only metadata is not reused across accounts. On launch/resume,
artwork older than one hour is conditionally revalidated with its ETag when one
is available. Changed images receive a new local URI so image loaders see the
replacement; failed requests keep the last complete offline copy.

Snapshots retain the same cleaned lyrics, word intervals, provider attribution
and synchronization type as the online lyrics API.

## Recommendations and changes made offline

### Radio and mixes

With recommendations enabled, the server prepares daily, new, and top mixes
and a general radio station of up to 100 distinct eligible tracks. The latest
daily mix replaces the previous one. Offline general radio uses this saved
station and stops when its queue ends.
Track-seeded radio and the library map are not part of this offline feature.
Existing online device selection and playback transfer remain unchanged;
joining Wi-Fi does not initiate a transfer.

### Activity and playlist edits

The app records listening, skips, likes, taste rules, library changes, and
ordinary playlist edits before confirming them in the interface. On reconnect,
it sends them to the same server and account. The server commits each change
with its receipt so a retry does not duplicate history or recreate a playlist.
The original timestamps are preserved.

Playlist changes are merged as operations: adds/removals affect only those tracks;
reordering retains concurrent additions and does not resurrect removed tracks;
metadata updates contain only locally edited fields. For simultaneous edits to
the same field or favorite state, the last action accepted by the server wins.
The server rejects edits to deleted playlists. The client retains them in its
local rejection journal and continues syncing valid actions.
Confirmed actions remain visible locally until a subsequent server snapshot
includes them, including across a crash between acknowledgement and refresh.

### Saved library and folders

The personal Library contains saved albums, artists and playlists. Its membership
is included in `savedLibrary` in each snapshot. Album/artist saves are independent
of track favourites and do not automatically download audio. Offline `library`
actions carry the entity ID and `{kind: "album" | "artist" | "playlist", value: boolean}`;
they use the same durable journal and receipts as playlist edits. New playlists
are saved automatically. Removing a saved playlist only removes its shortcut,
not the playlist or its tracks.

Personal library folders can contain saved albums, artists, playlists and nested
folders. `libraryFolders` in the snapshot stores `{id,name,parentId,createdAt}`;
each saved item has a nullable `folderId`. Creating, renaming, moving and deleting
folders works offline through `libraryOrganize` actions. Their payload matches
`POST /api/me/library/organize`: `operation` is `create`, `rename`, `moveFolder`,
`delete` or `moveItem`, with `id`, and the relevant `name`, nullable `folderId`,
and item `kind`. Clients generate folder UUIDs so subsequent offline actions can
refer to them before uploading. The server serializes changes per account and
rejects cross-account destinations and cycles. Deleting a folder moves its direct
contents to its parent; it never deletes saved music or playlists. Rejected
changes use the existing rejection journal. `GET /api/me/library/folders` lists
the signed-in account's folders.

## Protocol and verification

Apply [database migrations](../db/README.md) before starting the updated
backend. All sync routes require authentication.

| Route | Purpose |
| --- | --- |
| `GET /api/sync/snapshot` | MVCC catalog, file and asset manifests, lyrics, waveforms, server-prepared mixes/radio |
| `GET /api/sync/identity` | Server and account identity for syncing individual-download activity without a full snapshot |
| `GET /api/sync/vectors` | Embeddings and their model/strategy/source metadata |
| `POST /api/sync/actions` | Up to 100 actions with stable UUIDs, account/server identity and per-action receipts |
| `GET /api/sync/tracks/{id}/tags?version=…` | Version-checked ID3/FLAC metadata envelope |
| `GET /api/sync/tracks/{id}/audio?version=…` | Original bytes with Range support; a changed version returns 412 |

The first snapshot computes encoded-audio hashes for uncached sources. Later
snapshots reuse them; the metadata exporter advances cache source hashes without
rehashing unchanged audio. Recommendation preparation does not count as a radio
impression. Uploaded events invalidate the server's cached listener profile.
An imported file whose extension does not match a supported MP3/FLAC container
is copied as opaque original bytes; changes to such a file require a complete
download because its metadata cannot safely be separated from the audio.

Server integration tests cover concurrent retries, timestamps, account/server
binding, rejected actions, merged playlist changes and separate audio/tag
versions. Android unit tests cover offline catalog contracts and network address
restrictions.

### Fixture-based device checks

`SnapshotJsonDeviceTest` generates a catalog of 2,500 tracks with 400,000 timed
lyric lines and 600,000 waveform peaks. It checks retained heap usage below
96 MiB, unchanged JSON export, offline detail reads and restoration from the
private snapshot. `SyncStreamingDeviceTest` verifies atomic private storage of
vectors larger than 100 MiB and retries interrupted transfers.
`LibrarySyncDeviceTest` exercises Media3 range requests, unchanged versions,
replacements and deletion, metadata restoration, and playback after the test
server shuts down. Run the tests on Android 13 or later with a local Wi-Fi or
Ethernet connection. Gradle installs an isolated test app.

```sh
cd android
./gradlew :app:connectedDebugAndroidTest -PcaimackIsolatedUiTests=true \
  '-Pandroid.testInstrumentationRunnerArguments.class=app.caimack.sync.SnapshotJsonDeviceTest,app.caimack.sync.SyncStreamingDeviceTest,app.caimack.sync.LibrarySyncDeviceTest'
```

### Check against a real server

`OfflineAccountDeviceTest` requires a signed-in account in the isolated test
app, active sync, and at least two synchronized tracks with offline radio.
Install the isolated app from `android/` with
`./gradlew :app:installDebug -PcaimackIsolatedUiTests=true`, then sign in and
prepare the library before running the test.

The test turns off Wi-Fi and simulates battery power, browses the catalog,
plays offline radio, and creates, reorders, then deletes a temporary playlist.
After reconnecting, it verifies that queued edits reached the server. It
restores Wi-Fi, battery reporting, and player settings. Playback appears as
ordinary listening activity in the account, so use a test account.

```sh
./gradlew :app:connectedDebugAndroidTest -PcaimackIsolatedUiTests=true \
  '-Pandroid.testInstrumentationRunnerArguments.class=app.caimack.sync.OfflineAccountDeviceTest'
```
