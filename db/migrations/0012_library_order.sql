CREATE TABLE library_order (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope text NOT NULL,
    item_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    PRIMARY KEY (user_id, scope),
    CHECK (jsonb_typeof(item_keys) = 'array')
);
