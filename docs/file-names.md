# Automatic music file names

Set `RENAME_MUSIC_FILES=true` to name registered audio files from their catalog
artist and title, for example `Imagine Dragons - Amsterdam.mp3`. The option is off
by default. Imported files with a non-empty title and artist in their tags are
eligible. Names inferred only from the incoming filename are left untouched until
the artist or title is explicitly edited in the catalog. Existing libraries are
checked against embedded tags when the option is first enabled. This is metadata
provenance, not an online verification of a recording's identity.

In a Docker installation, set both values in the root `.env`:

```dotenv
RENAME_MUSIC_FILES=true
MUSIC_LIBRARY_ACCESS=rw
```

Then recreate the API with `./caimack.sh start` or your usual `docker compose up -d`.
For a native dev API, set `RENAME_MUSIC_FILES=true` in `backend/.env` and restart it.
Apply migrations first (`caimack migrate`); migration 0003 adds the rename journal.
The API user needs write access to the parent directories, including the external
music directory. Symlinking the library root is supported; audio symlinks or
subdirectory links escaping that root are not renamed.

Files remain in their existing directories, including the internal upload shards.
No album-folder reorganization happens. Names use the primary credited artist,
preserve Unicode and the audio extension, remove control characters and characters
invalid on Windows, and limit the name length. Existing audio or companion files
are never overwritten: conflicts produce `Artist - Title (2).ext`, `(3)`, etc.
These suffixes are stable across rescans. An empty or unknown artist/title is skipped.

The first scan renames eligible existing/imported files. A background check every
30 seconds also picks up new uploads and catalog edits, independently of the normal
library scan interval. Completion of online cover/lyrics lookups is not required:
those lookups do not establish a track title or artist. Manual catalog corrections
will be reflected in the next naming pass.

Same-stem `.lrc`, `.txt`, `.srt`, `.jpg`, `.jpeg` and `.png` companions move with
the audio. Language suffixes such as `Song.en.lrc` are retained. Shared `cover.jpg`
and `Folder.jpg` are not changed. If multiple audio formats share the same stem
and companion files, that rename is skipped because ownership is ambiguous.
Enable [metadata export](metadata-export.md) separately to embed catalog artwork
and create lyric companions from downloaded texts.

Renaming does not change audio bytes or tags. The content hash, track ID, MERT
embeddings, cue points, HLS cache, favorites, playlists and listening history stay
valid. Both catalog paths and the library scan registry are updated. The Upload
page shows a renamed count and any errors from the naming pass.

The `file_renames` table records the old/new paths and companion moves before any
filesystem changes. Every destination is reserved using a non-overwriting hard
link, the database paths are committed, and only then are old directory entries
removed. Pending operations resume before the next library scan; completed rows
remain as an audit trail. The source stays accessible until the catalog commit.
This requires a filesystem with hard-link support (for example ext4 or NTFS).
Unsupported or read-only filesystems produce an error and leave the original in
place. Changing the setting back to false stops new renames; already journaled
operations are still recovered before a library scan.
