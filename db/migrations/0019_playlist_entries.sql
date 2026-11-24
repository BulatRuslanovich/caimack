-- Existing entries have no reliable addition timestamp.
ALTER TABLE playlist_tracks ADD COLUMN added_at timestamptz;
ALTER TABLE playlist_tracks ALTER COLUMN added_at SET DEFAULT now();

-- Keep the receipt if the playlist is deleted so a retry cannot recreate it.
CREATE TABLE playlist_creation_requests (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    PRIMARY KEY (user_id, request_id)
);
