-- Catalog edits follow the scanner's book ID and survive rescans.
CREATE TABLE audiobook_edits (
    book_id uuid PRIMARY KEY,
    title text NOT NULL,
    author text,
    narrator text,
    year integer CHECK (year BETWEEN 1500 AND 2999),
    cover_edited boolean NOT NULL DEFAULT false,
    cover_webp bytea,
    cover_etag text,
    CHECK ((cover_webp IS NULL) = (cover_etag IS NULL)),
    CHECK (cover_edited OR cover_webp IS NULL)
);
