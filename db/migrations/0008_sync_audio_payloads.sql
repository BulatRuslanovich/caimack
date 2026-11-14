-- Encoded audio identity independent of ID3/FLAC metadata, including edits
-- made outside Caimack. Populated lazily on the first offline sync.
CREATE TABLE sync_audio_payloads (
    track_id uuid PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    source_hash text NOT NULL,
    audio_hash text NOT NULL
);
