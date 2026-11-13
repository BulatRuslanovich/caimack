-- Personal collections are independent of track favourites and catalog ownership.
CREATE TABLE library_items (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    album_id uuid REFERENCES albums(id) ON DELETE CASCADE,
    artist_id uuid REFERENCES artists(id) ON DELETE CASCADE,
    playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE,
    saved_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(album_id, artist_id, playlist_id) = 1),
    UNIQUE (user_id, album_id),
    UNIQUE (user_id, artist_id),
    UNIQUE (user_id, playlist_id)
);
CREATE INDEX library_items_user_saved ON library_items(user_id, saved_at DESC);
INSERT INTO library_items(user_id, playlist_id, saved_at)
SELECT user_id, id, created_at FROM playlists;
-- Includes playlists created by imports and offline synchronization.
CREATE FUNCTION save_created_playlist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO library_items(user_id, playlist_id, saved_at) VALUES (NEW.user_id, NEW.id, NEW.created_at);
    RETURN NEW;
END;
$$;
CREATE TRIGGER playlist_library AFTER INSERT ON playlists
FOR EACH ROW EXECUTE FUNCTION save_created_playlist();
