-- Tag-only exports retain the same audio and must not restart provider lookups.
CREATE OR REPLACE FUNCTION enqueue_track_enrichment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.title IS NOT DISTINCT FROM OLD.title
           AND NEW.artist_id IS NOT DISTINCT FROM OLD.artist_id
           AND COALESCE(NEW.media_cache_hash, NEW.content_hash)
               IS NOT DISTINCT FROM COALESCE(OLD.media_cache_hash, OLD.content_hash) THEN
            RETURN NEW;
        END IF;
    END IF;
    INSERT INTO enrichment_jobs(kind, entity_id, track_id, priority)
        VALUES ('cover', NEW.id, NEW.id, 0), ('lyrics', NEW.id, NEW.id, 0)
    ON CONFLICT (kind, entity_id) DO UPDATE SET next_attempt_at = now(), priority = 0,
        attempts = 0, locked_until = NULL, lease = NULL, last_error = NULL, last_outcome = NULL, updated_at = now();
    RETURN NEW;
END $$;

DROP TRIGGER tracks_enqueue_enrichment ON tracks;
CREATE TRIGGER tracks_enqueue_enrichment AFTER INSERT OR UPDATE OF title, artist_id, content_hash, media_cache_hash ON tracks
    FOR EACH ROW EXECUTE FUNCTION enqueue_track_enrichment();
