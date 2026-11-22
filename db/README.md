[Documentation](../docs/README.md#run-a-server)

# Database migrations

Caimack's PostgreSQL schema lives in [numbered migrations](migrations/).
The `caimack` binary embeds those files. Run `caimack migrate` before starting
the corresponding API version. On startup, the API checks that the database
schema matches its build and reports a mismatch without changing the schema.

## Apply migrations

The bundled Docker Compose configuration runs the one-shot `migrate` service
before starting the backend. It exits once the database is up to date. Use
the [server manager](../docs/server-manager.md) to update an existing
deployment.

For a native deployment, point `DATABASE_URL` at the target database and run
the migration command with the new binary.

```bash
DATABASE_URL=postgres://music:password@127.0.0.1:5432/music caimack migrate
```

For local development, `make migrate` runs the same migration files with
`sqlx-cli` so the schema can be prepared before changed backend queries
compile. `make backend` includes this step.

## Upgrade an older fork database

Use `caimack migrate` for these upgrades. The migrator recognizes the exact
historical checksums, adjusts the migration ledger atomically, then applies
the migrations that are still missing. Existing data stays in place. An
unknown or edited migration history is rejected.

| Database history | What the migrator does |
| --- | --- |
| Local fork with saved collections and folders at `0008` and `0009` | Aligns those entries to `0009` and `0010`, preserving saved items, folders, and timestamps. |
| Upstream library map cache at `0013` | Moves the matching map entry to `0017` and applies the audiobook migrations. Saved coordinates and vector fingerprints are retained. |
| Fresh database or matching migration history | Applies missing migrations in order. |

For a legacy upgrade, use the application's migrator instead of running
`cargo sqlx migrate run` directly. Use the matching API version after the
upgrade.

## Develop and test schema changes

Add a new numbered migration for each schema change. Keep deployed migration
files and their checksums intact. When a change affects a compile-time checked
query, run `make sqlx` and include the updated metadata.

```bash
make test-db
```

To run focused tests, use disposable local PostgreSQL and a role that can
create test databases. From the repository root, `make db` starts the local
instance used below.

```bash
cd backend
export SQLX_OFFLINE=true
export DATABASE_URL=postgres://music:dev@127.0.0.1:55433/postgres
cargo test -p app --features integration-tests --test fork_upgrade
cargo test -p app --features integration-tests --test saved_library --test library_folders
cargo test -p app --lib --features integration-tests recommendations::map
```

Other targeted filters include `file_names` and `metadata_export`. Add
`-- --include-ignored` to the filter `integrations::enrichment_jobs::tests`
to exercise enrichment jobs against PostgreSQL. See the
[development guide](../docs/development.md#run-checks) for the full checks.

## Schema landmarks

| Migration | What it adds |
| --- | --- |
| `0002–0003` | Durable enrichment jobs and the upstream rich-lyrics schema. |
| `0004–0006` | Filename provenance, journals for renames and metadata exports, and stable audio identity for tag-only changes. |
| `0009–0010` | Saved albums, artists, and playlists, plus account-scoped folders. |
| `0011` | Keeps rich lyrics and provider backoff across tag-only exports. Recording or metadata changes still invalidate matches. |
| `0013` | Saved audiobooks and the latest listening checkpoint per account and book. |
| `0017` | Shared [library map](../docs/library-map.md) cache keyed by layout version, audio model, and window strategy. |

Saved library writes use `PUT` or `DELETE /api/me/library/{kind}/{id}` and
are idempotent. Saving again preserves the original save time. Private
playlists remain visible to their owner. `GET /api/me/library` lists items
newest first. Folder edits are serialized per account and checked for cycles.
Deleting a folder moves its contents to its parent.
