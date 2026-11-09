-- A stable HLS cache identity survives metadata-only edits to the audio file.
ALTER TABLE tracks ADD COLUMN media_cache_hash varchar(64);

CREATE TABLE file_metadata_state (
    track_id uuid PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    source_hash text NOT NULL,
    cover_stamp text,
    lyrics_hash text,
    lyrics_extension text
);

CREATE TABLE file_metadata_exports (
    id uuid PRIMARY KEY,
    track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source_path text NOT NULL,
    old_hash text NOT NULL,
    new_hash text NOT NULL,
    files jsonb NOT NULL,
    cover_stamp text,
    lyrics_hash text,
    lyrics_extension text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);
CREATE UNIQUE INDEX ux_file_metadata_exports_pending ON file_metadata_exports(track_id)
    WHERE completed_at IS NULL;
