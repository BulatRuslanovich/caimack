# Android library synchronization

In **Settings → Downloads → Library synchronization**, choose a folder with
Android's system folder picker and enable **Synchronize this library**. The
feature is off by default. **Sync now / resume** starts a foreground transfer;
**Pause** stops automatic transfers until resumed. Disabling synchronization
leaves exported files in place and returns the client to its normal online mode.

The server must be reachable at a local address over Wi-Fi or Ethernet. The
sync client binds its connections and DNS resolution to that network, rejects
public, loopback and multicast addresses, and never falls back to cellular or a
VPN connection. A VPN configured to prevent local access must allow the server
or be disconnected. Android 17 additionally requires local-network permission.

Automatic jobs are persisted across reboot and scheduled every 15 minutes, with
an additional attempt after joining a local network or recording an action.
Charging is not required. Android can defer background jobs in Doze or under
manufacturer battery restrictions; the interval is not a deadline. A manual
foreground sync shows a notification with progress and a pause action.

## Files and playback

The selected folder contains a separate `Caimack-<server>-<account>` subfolder:

```text
Caimack-…/
  Artist/Album/Title [identifier].mp3 (or .flac)
  Artist/Album/Title [identifier].lrc (or .txt)
  Artist/Album/Title [identifier].jpg
  Playlist [identifier].m3u8
  Caimack daily.m3u8
  Caimack new.m3u8
  Caimack top.m3u8
  Caimack Radio.m3u8
  .caimack/library.json
  .caimack/vectors.json
```

Audio retains the original encoded quality and the server file's embedded tags
and artwork. Timed lyrics use UTF-8 LRC; plain lyrics use UTF-8 TXT. These files
and relative M3U8 playlists are usable by other players. Caimack also keeps a
private catalog, image cache, file ownership index and action journal so browsing,
searching, lyrics and playback work without a server after restarting the app.
Vectors are exported as data; the Android client does not run MERT or recommendation
algorithms.

While synchronization is active for the signed-in account, manual download
buttons and per-track download badges are hidden, and new manual/background
download requests are ignored. Transfer progress remains available in sync
settings. Outside library synchronization, completed individual downloads have
an offline badge. Downloads lists each track once when it exists in both stores;
existing individual downloads are kept intact.

Only new/replaced audio is downloaded. The server identifies encoded audio
separately from its ID3/FLAC metadata, including external tag edits. Metadata
envelopes let the phone rebuild updated tags from its existing audio bytes. Both
downloads and rebuilt files are verified against the complete server SHA-256
before replacing a previous complete copy. Interrupted downloads use HTTP Range.
Running out of space or losing folder permission pauses synchronization; it does
not evict unrelated music. A creation journal recovers interrupted file writes.
Untracked companions that conflict with an expected name are preserved as hidden
`.recovered-…` files, rather than overwritten.

Server deletions remove only document URIs recorded as owned by this sync.
Replacing an audio file downloads the new version before removing its previous
copy. A complete validated catalog is required before applying deletions; failed
requests and partial pagination cannot be interpreted as an empty library.
Account and server identity are checked before reading the offline catalog or
uploading changes. Switching folders/accounts never claims an older folder's files;
pending actions must be synchronized before changing their binding.

## Recommendations and changes made offline

The server prepares the daily, new and top mixes and a general radio station of
up to 100 distinct eligible tracks. The latest daily mix replaces the previous
one. With synchronization enabled, general radio uses this saved station. Its
queue stops at the end and does not generate more recommendations on the phone.
Track-seeded radio and the library map are not part of this offline feature.
Existing online device selection and playback transfer remain unchanged;
joining Wi-Fi does not initiate a transfer.

Listening, skips, likes, dislikes/taste rules and ordinary playlist edits are
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

For the physical-device test, connect an Android 13+ phone through adb, join
Wi-Fi and grant a music folder through the app. The test uses a separate random
server/account namespace and generated two-second audio fixtures:

```sh
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e class app.caimack.sync.LibrarySyncDeviceTest \
  app.caimack.test/androidx.test.runner.AndroidJUnitRunner
```

The device test exercises actual SAF files, byte-range resume, unchanged-file
reuse, tag-only updates, LRC/M3U8 extensions, MP3-to-FLAC replacement, durable
actions/index restoration, a real Media3 decoder with the server shut down, and
deletion without removing unrelated files. It skips if no writable SAF grant or
Wi-Fi connection has been configured.

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
