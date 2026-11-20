-- Audiobook identifiers derive from paths in the separately scanned audiobook folder.
-- Keep user state even when that folder is temporarily unavailable.
CREATE TABLE audiobook_state (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    book_id uuid NOT NULL,
    saved boolean NOT NULL DEFAULT false,
    chapter_id uuid,
    position_ms bigint,
    updated_at_ms bigint,
    completed boolean,
    PRIMARY KEY (user_id, book_id),
    CHECK (num_nonnulls(chapter_id, position_ms, updated_at_ms, completed) IN (0, 4)),
    CHECK (position_ms >= 0),
    CHECK (updated_at_ms > 0)
);
