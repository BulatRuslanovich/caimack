[Documentation](README.md#music-library)

# Automatic music file names

Use automatic naming to turn an eligible file such as `track01.mp3` into
`Imagine Dragons - Amsterdam.mp3` using its catalog artist and title. The option
is off by default and changes filenames in the underlying music folder.

## Enable naming

In a Docker installation, set both values in the root `.env`:

```dotenv
RENAME_MUSIC_FILES=true
MUSIC_LIBRARY_ACCESS=rw
```

Then recreate the API with `./caimack.sh start` or your usual `docker compose up -d`.
For a native dev API, set `RENAME_MUSIC_FILES=true` in `backend/.env` and restart it.
Apply migrations first (`caimack migrate`); migration 0004 adds the rename journal.
The API user needs write access to the parent directories, including the external
music directory. Symlinking the library root is supported; audio symlinks or
subdirectory links escaping that root are not renamed.

## How Caimack chooses a name

Imported files qualify when their tags supply a title and artist. For names
inferred from the original filename, edit the title or artist in the catalog to
make the file eligible. The first scan checks existing files for embedded tags.
Online artwork and lyric lookups do not affect eligibility.

Files remain in their existing directories, including upload subdirectories.
Names use the primary credited artist,
preserve Unicode and the audio extension, remove control characters and characters
invalid on Windows, and limit the name length. Existing audio or companion files
are never overwritten: conflicts produce `Artist - Title (2).ext`, `(3)`, etc.
These suffixes are stable across rescans. An empty or unknown artist/title is skipped.

The first scan renames eligible existing files. A background pass every
30 seconds picks up uploads and catalog edits independently of the library scan
schedule. The Upload page reports rename counts and errors.

## Companion files and recovery

Same-stem `.lrc`, `.txt`, `.srt`, `.jpg`, `.jpeg` and `.png` companions move with
the audio. Language suffixes such as `Song.en.lrc` are retained. Shared `cover.jpg`
and `Folder.jpg` are not changed. If multiple audio formats share the same stem
and companion files, that rename is skipped because ownership is ambiguous.
Enable [metadata export](metadata-export.md) separately to embed catalog artwork
and create lyric companions from downloaded texts.

Renaming does not change audio bytes or tags. The content hash, track ID, MERT
embeddings, cue points, HLS cache, favorites, playlists and listening history stay
valid. The catalog paths and scan registry are updated.

The `file_renames` table records the old/new paths and companion moves before any
filesystem changes. Every destination is reserved using a non-overwriting hard
link, the database paths are committed, and only then are old directory entries
removed. Pending operations resume before the next library scan; completed rows
remain as an audit trail. The source stays accessible until the catalog commit.
This requires a filesystem with hard-link support (for example ext4 or NTFS).
Unsupported or read-only filesystems produce an error and leave the original in
place. Changing the setting back to false stops new renames; already journaled
operations are still recovered before a library scan.
