# Android library synchronization

In **Settings → Downloads → Library synchronization**, enable **Synchronize
this library**. **Sync now / resume** starts a foreground transfer. **Pause**
stops automatic transfers until resumed. Turning sync off keeps completed
downloads available in **Library → Downloads**, where you can play or remove them.

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

Alternatively, sign in using the local IP and the actual listening port. If that
endpoint uses HTTP, enable **Allow HTTP on the local network** in connection
settings. A different server URL has its own offline binding; the app currently
has no separate LAN address just for synchronization.

The default Docker/Caddy deployment redirects HTTP to HTTPS and serves the
configured public hostname. Opening `http://<LAN-IP>` can therefore redirect to
`https://<LAN-IP>`, which does not match the domain certificate. Allowing local
HTTP does not bypass that redirect or certificate verification. Use the domain
with a local DNS override, or explicitly configure a separate local endpoint.

Automatic jobs are persisted across reboot and scheduled every 15 minutes, with
an additional attempt after joining a local network or recording an action.
Charging is not required. Android can defer background jobs in Doze or under
manufacturer battery restrictions; the interval is not a deadline. A manual
foreground sync shows a notification with progress and a pause action.

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
track once and sync settings show progress. Track and collection download
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

The main **Library** remains usable without the server. Saved catalog metadata
is stored per server/account; known albums, artists, folders and playlists retain
their structure after a restart. Only explicitly saved albums, artists and playlists appear in the main library;
downloading audio never adds library shortcuts. Tracks without local
audio remain visible in cached lists, are dimmed and cannot be tapped to play.
Playing a collection offline queues its downloaded tracks only. A successful
server check restores normal browsing and playback availability.

**Library → Downloads** remains a flat list of individual transfers, with
progress, playback and download removal. Browsing previously unseen server
content requires a connection once so its metadata can be retained. Older
individual downloads already contain album and artist metadata; open an older
playlist online once to save its membership and order.

Manual and automatic downloads retain album covers and images of all track
artists, including collaborators. Missing artwork is retried on launch/resume
and after reconnecting. Images are kept in private app storage independently of
the evictable image cache and appear on open screens as soon as they are saved.
Unavailable artwork does not prevent audio downloads.

Downloaded playlist/artist metadata and artwork are isolated by server and account.
Legacy server-only metadata is not reused across accounts. On launch/resume,
artwork older than one hour is conditionally revalidated with its ETag when one
is available. Changed images receive a new local URI so image loaders see the
replacement; failed requests keep the last complete offline copy.

Snapshots retain the same cleaned lyrics, word intervals, provider attribution
and synchronization type as the online lyrics API.

## Recommendations and changes made offline

The server prepares the daily, new and top mixes and a general radio station of
up to 100 distinct eligible tracks. The latest daily mix replaces the previous
one. With synchronization enabled, general radio uses this saved station. Its
queue stops at the end and does not generate more recommendations on the phone.
Track-seeded radio and the library map are not part of this offline feature.
Existing online device selection and playback transfer remain unchanged;
joining Wi-Fi does not initiate a transfer.

Listening, skips, likes, dislikes/taste rules, personal library saves/removals and ordinary playlist edits are
saved durably before they are acknowledged locally. On return, the phone uploads
them to the authenticated server/account. The server commits each effect and its
receipt in the same transaction. Retrying after a lost response therefore cannot
duplicate listening history or recreate a deleted playlist. Offline timestamps
are preserved rather than replaced with the synchronization time.

Playlist changes are merged as operations: adds/removals affect only those tracks;
reordering retains concurrent additions and does not resurrect removed tracks;
metadata updates contain only locally edited fields. For simultaneous edits to
the same field or favorite state, the last action accepted by the server wins.
An edit to a playlist deleted on the server is rejected, retained in the local
rejection journal, and shown in sync settings. Other valid actions still proceed.
Confirmed actions remain visible locally until a subsequent server snapshot
includes them, including across a crash between acknowledgement and refresh.

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

Apply migrations before starting the updated backend (`caimack migrate`). All
sync routes require normal authentication:

| Route | Purpose |
| --- | --- |
| `GET /api/sync/snapshot` | MVCC catalog, file and asset manifests, lyrics, waveforms, server-prepared mixes/radio |
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

`OfflineAccountDeviceTest` additionally uses the signed-in account and at least
two downloaded radio tracks. It temporarily disables Wi-Fi and simulates battery
power, exercises catalog browsing, public playlists, local radio playback through
the app's playback service and the end of its queue, and creates/reorders/deletes
a temporary playlist. It then reconnects and verifies that queued edits reached
the real server. The test restores Wi-Fi, battery reporting and player settings
in `finally`; its playback signals are ordinary listening events on that account.

```sh
adb shell am instrument -w -e class app.caimack.sync.OfflineAccountDeviceTest \
  app.caimack.test/androidx.test.runner.AndroidJUnitRunner
```
