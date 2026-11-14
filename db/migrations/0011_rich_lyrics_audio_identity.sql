-- Preserve rich lyrics through metadata-only file exports while still invalidating
-- provider matches and retry schedules when the recording identity changes.
CREATE OR REPLACE FUNCTION enqueue_track_enrichment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.title, NEW.artist_id, NEW.album_id, NEW.duration_seconds,
            COALESCE(NEW.media_cache_hash, NEW.content_hash))
            IS NOT DISTINCT FROM
           (OLD.title, OLD.artist_id, OLD.album_id, OLD.duration_seconds,
            COALESCE(OLD.media_cache_hash, OLD.content_hash)) THEN
            RETURN NEW;
        END IF;
    END IF;
    INSERT INTO enrichment_jobs(kind, entity_id, track_id, priority)
        VALUES ('cover', NEW.id, NEW.id, 0), ('lyrics', NEW.id, NEW.id, 0)
    ON CONFLICT (kind, entity_id) DO UPDATE SET next_attempt_at = now(), priority = 0,
        attempts = 0, locked_until = NULL, lease = NULL, last_error = NULL,
        last_outcome = NULL, updated_at = now();
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION invalidate_provider_lyrics() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.title, OLD.artist_id, OLD.album_id, OLD.duration_seconds,
        COALESCE(OLD.media_cache_hash, OLD.content_hash))
        IS DISTINCT FROM
       (NEW.title, NEW.artist_id, NEW.album_id, NEW.duration_seconds,
        COALESCE(NEW.media_cache_hash, NEW.content_hash)) THEN
        DELETE FROM track_lyrics WHERE track_id = NEW.id AND source = 2;
    END IF;
    RETURN NEW;
END $$;
