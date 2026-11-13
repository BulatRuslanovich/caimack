# MX-Goliath feature integration

This branch integrates `MX-Goliath/caimack:master-local` at
`2a1d06d0ba3449437f4c2658e044fca375f2c45f` into upstream master at
`344db1a165bb71652c72457b51773a6329923aac` with a merge commit, retaining
the fork's history and contribution attribution.

## Included features

- Personal saved albums, artists and playlists, nested folders, web and Android
  library interfaces, and animated save controls.
- Optional full Android library synchronization over LAN, SAF audio/sidecar
  exports, resumable verified transfers, offline browsing and durable action replay.
- Early Android session restoration and persistent metadata/artwork for downloads.
- Optional music-file renaming and metadata export, plus improved LRCLIB matching.

Upstream rich lyrics/providers, artwork visualization, MERT GPU lifecycle and
Android release tooling are retained. Shuffle, SSE, mini-player and backdrop
fixes previously merged upstream are not reverted.

## Integration corrections

Upstream migrations 0001–0003 are unchanged. The fork's migrations follow as
0004–0010; migration 0011 reconciles rich-lyrics triggers with tag-only exports.
Exporting artwork preserves provider lyrics and retry progress. Editing the
recording identity still invalidates matches and restarts enrichment.

Sync snapshots use the same lyrics projection as the online API, including word
intervals, cleanup, provenance and attribution. LRCLIB retains upstream duration
validation and bounded HTTP response reads.

Downloaded metadata and images are partitioned by server/account. Artwork is
conditionally revalidated after one hour, and changed content gets a new local
URI. Unreachable servers leave the last complete image available.

## Trying the branch

Use a disposable database and a copy of the music folder for the first trial.
Apply migrations with `caimack migrate`; do not downgrade that database back to
an older binary after applying the new migrations.

Library synchronization remains disabled until explicitly configured on Android.
`RENAME_MUSIC_FILES` and `EXPORT_MUSIC_METADATA` remain false by default. Keep
them disabled until testing file operations on the copied library.

The regression suites cover upstream database upgrade/checksum preservation,
rich lyrics through sync and metadata export, retry invalidation, account
switches, and artwork revalidation. Real-device SAF, interrupted transfers and
offline playback should additionally be verified with the device procedures in
[android-library-sync.md](android-library-sync.md).
