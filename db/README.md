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

Run migrations before starting the corresponding backend version. Regenerate SQLx metadata with `make sqlx` when changing compile-time checked queries. New enrichment queries are checked by PostgreSQL integration tests:

```bash
cd backend
SQLX_OFFLINE=true DATABASE_URL=postgres://music:password@localhost:5432/postgres cargo test -p app integrations::enrichment_jobs::tests -- --include-ignored
```

Use a disposable local PostgreSQL server and a role allowed to create databases. SQLx creates isolated test databases. Do not run these tests against production.
