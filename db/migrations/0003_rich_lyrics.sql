-- Preserve the existing JSON line format and extend it with genuine word intervals.
CREATE FUNCTION lyric_quality(lines jsonb) RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN jsonb_array_length(lines) = 0 THEN 0 ELSE
        100 + 100 * count(*) FILTER (WHERE jsonb_array_length(coalesce(line->'words','[]'::jsonb)) > 0)
            / greatest(count(*) FILTER (WHERE btrim(coalesce(line->>'text','')) <> ''), 1)
    END::smallint FROM jsonb_array_elements(lines) AS line
$$;

ALTER TABLE track_lyrics
    ADD COLUMN provider text,
    ADD COLUMN source_format text,
    ADD COLUMN original_lyrics text,
    ADD COLUMN match_exact boolean NOT NULL DEFAULT true,
    ADD COLUMN match_distance_ms integer NOT NULL DEFAULT 2147483647 CHECK (match_distance_ms >= 0),
    ADD COLUMN attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN quality smallint GENERATED ALWAYS AS (lyric_quality(synced)) STORED;

-- Revisit earlier plain/line hits without reimporting the audio library.
UPDATE enrichment_jobs SET next_attempt_at=now(), priority=0
WHERE kind='lyrics' AND (locked_until IS NULL OR locked_until<now());

CREATE TRIGGER lyrics_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON track_lyrics
    FOR EACH STATEMENT EXECUTE FUNCTION mark_catalog_changed();

-- A provider response is bound to a recording. An edited identity needs a new lookup.
CREATE FUNCTION invalidate_provider_lyrics() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.title,OLD.artist_id,OLD.album_id,OLD.duration_seconds,OLD.content_hash)
        IS DISTINCT FROM (NEW.title,NEW.artist_id,NEW.album_id,NEW.duration_seconds,NEW.content_hash) THEN
        DELETE FROM track_lyrics WHERE track_id=NEW.id AND source=2;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tracks_invalidate_provider_lyrics
    AFTER UPDATE OF title,artist_id,album_id,duration_seconds,content_hash ON tracks
    FOR EACH ROW EXECUTE FUNCTION invalidate_provider_lyrics();

CREATE TRIGGER tracks_enqueue_lyrics_identity
    AFTER UPDATE OF album_id,duration_seconds ON tracks
    FOR EACH ROW EXECUTE FUNCTION enqueue_track_enrichment();
