CREATE TABLE library_folders (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id uuid,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, parent_id) REFERENCES library_folders(user_id, id)
        ON DELETE SET NULL (parent_id),
    CHECK (id IS DISTINCT FROM parent_id)
);
CREATE INDEX library_folders_parent ON library_folders(user_id, parent_id);
ALTER TABLE library_items ADD COLUMN folder_id uuid;
ALTER TABLE library_items ADD FOREIGN KEY (user_id, folder_id)
    REFERENCES library_folders(user_id, id) ON DELETE SET NULL (folder_id);
CREATE INDEX library_items_folder ON library_items(user_id, folder_id);
