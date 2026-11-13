-- NULL identifies tracks imported before metadata provenance was recorded.
ALTER TABLE tracks ADD COLUMN file_name_verified boolean;

-- Persist intent before touching files. Completed rows provide an audit trail.
CREATE TABLE file_renames (
    id uuid PRIMARY KEY,
    track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    source_path text NOT NULL,
    target_path text NOT NULL,
    moves jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);
CREATE UNIQUE INDEX ux_file_renames_pending ON file_renames(track_id) WHERE completed_at IS NULL;
