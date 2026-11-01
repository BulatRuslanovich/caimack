-- Durable, deduplicated enrichment. A channel is only a wake-up hint.
CREATE TABLE enrichment_jobs (
    kind text NOT NULL CHECK (kind IN ('cover', 'artist', 'lyrics')),
    entity_id uuid NOT NULL,
    track_id uuid REFERENCES tracks(id) ON DELETE CASCADE,
    artist_id uuid REFERENCES artists(id) ON DELETE CASCADE,
    priority smallint NOT NULL DEFAULT 10,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    lease uuid,
    last_outcome text,
    last_error text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, entity_id),
    CHECK ((kind = 'artist' AND artist_id IS NOT NULL AND artist_id = entity_id AND track_id IS NULL)
        OR (kind IN ('cover', 'lyrics') AND track_id IS NOT NULL AND track_id = entity_id AND artist_id IS NULL))
);
CREATE INDEX ix_enrichment_jobs_due ON enrichment_jobs(kind, next_attempt_at, priority, entity_id);
CREATE INDEX ix_enrichment_jobs_track ON enrichment_jobs(track_id) WHERE track_id IS NOT NULL;
CREATE INDEX ix_enrichment_jobs_artist ON enrichment_jobs(artist_id) WHERE artist_id IS NOT NULL;

CREATE FUNCTION enqueue_track_enrichment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO enrichment_jobs(kind, entity_id, track_id, priority)
        VALUES ('cover', NEW.id, NEW.id, 0), ('lyrics', NEW.id, NEW.id, 0)
    ON CONFLICT (kind, entity_id) DO UPDATE SET next_attempt_at = now(), priority = 0,
        attempts = 0, locked_until = NULL, lease = NULL, last_error = NULL, last_outcome = NULL, updated_at = now();
    RETURN NEW;
END $$;
CREATE TRIGGER tracks_enqueue_enrichment AFTER INSERT OR UPDATE OF title, artist_id, content_hash ON tracks
    FOR EACH ROW EXECUTE FUNCTION enqueue_track_enrichment();

CREATE FUNCTION enqueue_artist_enrichment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO enrichment_jobs(kind, entity_id, artist_id, priority)
        VALUES ('artist', NEW.id, NEW.id, 0)
    ON CONFLICT (kind, entity_id) DO UPDATE SET next_attempt_at = now(), priority = 0,
        attempts = 0, locked_until = NULL, lease = NULL, last_error = NULL, last_outcome = NULL, updated_at = now();
    RETURN NEW;
END $$;
CREATE TRIGGER artists_enqueue_enrichment AFTER INSERT OR UPDATE OF name ON artists
    FOR EACH ROW EXECUTE FUNCTION enqueue_artist_enrichment();

-- A sequence avoids a shared row lock on every catalog-writing transaction.
CREATE SEQUENCE catalog_revision START 1;
CREATE FUNCTION mark_catalog_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM nextval('catalog_revision');
    RETURN NULL;
END $$;
CREATE TRIGGER tracks_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON tracks
    FOR EACH STATEMENT EXECUTE FUNCTION mark_catalog_changed();
CREATE TRIGGER artists_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON artists
    FOR EACH STATEMENT EXECUTE FUNCTION mark_catalog_changed();
