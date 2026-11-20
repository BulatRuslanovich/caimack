-- A shared, versioned layout survives API restarts and is replaced atomically.
CREATE TABLE library_map_cache (
    cache_key text PRIMARY KEY,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now()
);
