# Database

Caimack's schema is the ordered set of files in `db/migrations/`. Migrations are compiled into the `caimack` binary.

Only `caimack migrate` changes the schema. The server never does: at startup it compares the
migration recorded in the database with the one it was built with and refuses to start when they
differ, saying what to do.

## Docker Compose

The one-shot `migrate` service runs before `backend` on every `docker compose up`. When it has
nothing to apply it exits at once.

## Without Docker

```bash
DATABASE_URL=postgres://music:password@localhost:5432/music caimack migrate
```

In development `make migrate` (also part of `make backend`) applies the same file with sqlx-cli,
so it works even when the backend's queries don't compile against the current database yet.

## Changing the schema

Add a new numbered migration for each change. Never modify an already deployed migration or rewrite its checksum. Migration 0002 adds durable enrichment jobs and catalog invalidation without changing the baseline.

Migration 0003 preserves the upstream rich-lyrics schema. Fork features follow it
with unique migration numbers; databases already using upstream migration 0003
can upgrade without replacing that migration or its checksum.

Migration 0004 adds filename metadata provenance and the durable `file_renames`
journal for optional automatic music filenames. New queries use runtime SQL and
are covered by `cargo test -p app --features integration-tests file_names` with
the same local `DATABASE_URL` and `SQLX_OFFLINE=true` configuration below.

Migration 0005 adds the metadata export journal, export state and a stable HLS
cache hash for tag-only audio changes. Its recovery, audio preservation and lyric
companion behavior are covered by `cargo test -p app --features integration-tests
metadata_export`.

Run migrations before starting the corresponding backend version. Regenerate SQLx metadata with `make sqlx` when changing compile-time checked queries. New enrichment queries are checked by PostgreSQL integration tests:

```bash
cd backend
SQLX_OFFLINE=true DATABASE_URL=postgres://music:password@localhost:5432/postgres cargo test -p app integrations::enrichment_jobs::tests -- --include-ignored
```

Use a disposable local PostgreSQL server and a role allowed to create databases. SQLx creates isolated test databases. Do not run these tests against production.

Migration 0006 keeps provider lookup progress across tag-only exports while
restarting lookup after a real audio replacement or a title/artist edit.

Migration 0009 adds account-scoped saved albums, artists and playlists with
foreign-key cleanup. It backfills existing owned playlists; an insert trigger
also saves playlists created by imports and offline synchronization. Saving an
album or artist does not change track favourites. Run the updated backend's
`caimack migrate` before starting it. Verify with
`SQLX_OFFLINE=true cargo test -p app --features integration-tests --test saved_library`.

Authenticated collection routes: `GET /api/me/library` and
`PUT` / `DELETE /api/me/library/{kind}/{id}`, where kind is `album`, `artist` or
`playlist`. Writes are idempotent; saving again preserves the original save time.
Private playlists are visible and saveable only by their owner. Unsave never
deletes catalog content. The returned list is sorted by save time, newest first.

Migration 0010 adds `library_folders` and nullable `library_items.folder_id`.
Composite foreign keys restrict destinations to the same user. The folder API
serializes tree edits per account to prevent cycles, including concurrent moves.
Deleting a folder lifts its contents to its parent without unsaving or deleting
music. Verify with `cargo test -p app --features integration-tests --test library_folders`.

Migration 0011 reconciles rich-lyrics invalidation with the stable audio identity
used by metadata export. Tag-only exports retain lyrics and provider backoff;
changes to the recording, title, artist, album or duration invalidate matches and
restart enrichment. Existing upstream migrations remain unchanged.

Migration 0013 stores each account’s saved audiobooks and one progress checkpoint
per book. Newer checkpoints win, including when a device uploads after listening
offline. Checkpoints survive a temporary loss of the audiobook folder. Book and
chapter identifiers derive from paths relative to that folder.

The local fork previously shipped collections/folders as migrations 0008/0009.
Use `caimack migrate` for its first upgrade: it recognizes the exact original
checksums and atomically aligns those two ledger entries to 0009/0010 before
applying upstream migrations. Saved items, folders, timestamps and checksums
are preserved; unknown or edited histories are rejected. Fresh databases and
databases already using upstream numbering follow the normal migration path.
Do not use `cargo sqlx migrate run` directly for this legacy upgrade, or run the
old binary against a database after upgrading it.

Migration 0017 adds `library_map_cache`, a shared projection cache keyed by layout
version, audio model and window strategy. Run `caimack migrate` before starting
the updated backend. Existing fork databases keep their audiobook migration
numbers. On an upstream database with the matching library map migration at
0013, `caimack migrate` moves that record to 0017 and applies the audiobook
migrations without rebuilding the map cache. Coordinates and vector fingerprints survive restarts;
metadata and listening statistics do not invalidate the projection. Builders
serialize through a transaction advisory lock and publish the saved map atomically.
Verify with `SQLX_OFFLINE=true cargo test -p app --lib --features integration-tests
recommendations::map` against the disposable local PostgreSQL server described above.
