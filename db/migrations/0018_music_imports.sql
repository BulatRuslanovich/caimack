CREATE TABLE music_imports (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request jsonb NOT NULL,
    state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'waiting', 'finished', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    runnable_at timestamptz NOT NULL DEFAULT now(),
    lease uuid,
    locked_until timestamptz,
    title text,
    error text,
    partial boolean NOT NULL DEFAULT false,
    omitted integer NOT NULL DEFAULT 0 CHECK (omitted >= 0),
    playlist_id uuid REFERENCES playlists(id) ON DELETE SET NULL
);

CREATE INDEX music_imports_user_history ON music_imports (user_id, created_at DESC);
CREATE INDEX music_imports_runnable ON music_imports (runnable_at, created_at)
    WHERE state IN ('queued', 'running', 'waiting');

CREATE TABLE music_import_items (
    job_id uuid NOT NULL REFERENCES music_imports(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    recording jsonb NOT NULL,
    state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'added', 'reused', 'failed', 'review')),
    track_id uuid REFERENCES tracks(id) ON DELETE SET NULL,
    error text,
    attempts jsonb NOT NULL DEFAULT '[]',
    upgrade jsonb,
    upgrade_hash text,
    selection jsonb,
    PRIMARY KEY (job_id, position)
);
