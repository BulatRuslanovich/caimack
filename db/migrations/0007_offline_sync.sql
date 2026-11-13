-- A library identity survives address changes and prevents one server's manifest
-- from deleting another server's files. Action receipts must outlive event retention.
CREATE TABLE sync_identity (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    id uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO sync_identity (singleton) VALUES (true);

CREATE TABLE sync_receipts (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_id uuid NOT NULL,
    request_hash text NOT NULL,
    result jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, action_id)
);
