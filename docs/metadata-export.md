# Artwork and lyrics beside music

Set `EXPORT_MUSIC_METADATA=true` to export the catalog's downloaded or manually
selected artwork and lyrics to registered music files. This option is independent
of `RENAME_MUSIC_FILES` and is off by default. For Docker, set these in the root
`.env` and recreate the API:

```dotenv
EXPORT_MUSIC_METADATA=true
MUSIC_LIBRARY_ACCESS=rw
```

For native development, set `EXPORT_MUSIC_METADATA=true` in `backend/.env` and
restart the API. Apply migration 0005 before starting the new backend. The API
needs write access to the source directory, even when the library root is a
symbolic link.

Artwork is embedded as a JPEG front cover using the audio format's native tags
(ID3 APIC for MP3, PICTURE for FLAC). Other tags and encoded audio are retained.
Synchronized lyrics are written as UTF-8 `Artist - Title.lrc` with timestamps;
plain lyrics without timestamps use `Artist - Title.txt`. Companions always share
the audio file's current basename. If several audio files share that basename
(for example MP3 and FLAC), export is skipped with an error to avoid overwriting
a shared lyric file. No album-wide `cover.jpg` is written, because
a directory may contain tracks from several albums. Lyrics are not embedded.

The first scan exports existing metadata. A background pass every 30 seconds
exports new uploads and newly fetched or changed covers and lyrics, including
when periodic library scanning is disabled. The Upload page reports the exported
count and write errors. Matching exports are left untouched.

Embedding artwork changes the whole-file SHA-256, but does not re-encode audio.
The database and scan registry adopt the new hash. Existing MERT vectors, analysis
timestamps, cue points, HLS audio cache, track IDs and listening history are kept.
An external audio replacement still invalidates audio analysis and cache normally.

Files are prepared beside their destinations and installed with atomic renames.
Originals of replaced audio or lyric files are retained in
`MUSIC_STORAGE_PATH/.metadata-backups/<operation UUID>/`. The
`file_metadata_exports` database journal records the paths and hashes needed to
identify those backups and recover an interrupted operation before scanning.
Backups are retained until the administrator removes them. They can be sizable.
An obsolete LRC/TXT is removed only when it still matches a previous export;
externally edited obsolete companions are preserved. An existing companion at the
new export path is backed up before replacement.

Disabling the option stops new exports. Already journaled operations are still
recovered. Players that cache artwork may need to reload the file or refresh
their library after an export.
