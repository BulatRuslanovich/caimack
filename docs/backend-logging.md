[Documentation](README.md#run-a-server)

# Backend logging

Use the server manager or Compose to follow logs for the API.

```bash
./caimack.sh logs backend -f
docker compose logs -f backend
```

The backend writes to stderr. Text logs include the date, milliseconds, time
zone, severity, module, and named fields. Colour is limited to interactive
terminals. Set `NO_COLOR` to turn it off.

## Levels

| Level | Meaning |
| --- | --- |
| `ERROR` | HTTP 5xx, failed background operations, task crashes and fatal startup/runtime failures. |
| `WARN` | Missing or unreadable audio, unavailable MERT, retries, HTTP 403/429 and slow responses. |
| `INFO` | Startup/readiness/shutdown, database connection, account events, uploads, job progress and summaries, index rebuilds, and routine 4xx responses other than 401, 403, 404, and 429. |
| `DEBUG` | Routine HTTP responses (including 401/404), individual analysis/enrichment/transcode results, renames and exports. |

Symphonia, SQL and HTTP dependency chatter is filtered at `WARN` by default.
MP3 bitrate estimates and Xing header messages are hidden; decoder warnings and
errors remain visible.

### Background jobs

Scan, analysis and import progress appears about every 30 seconds **between
items**. Enrichment reports interval counts, including normal not-found and
instrumental results. Idle workers do not emit progress messages. Final summaries
distinguish completion, cancellation and failure/interruption. Analysis `failed`
counts tracks without usable cue analysis, matching the stored success flag.
HLS warmup logs describe scheduling; individual rendition completion is at `DEBUG`.

## Request diagnostics

Each HTTP response has a server-generated **`X-Request-Id`**. Search for that value
to correlate handler events and the HTTP outcome. Request context includes
`request_id`, `method`, `route` and, after authentication, `user_id`.

HTTP outcomes include `status`, `elapsed_ms` and a diagnostic `reason` when
available. Internal error cause chains remain in server logs; clients receive a
generic error. Failed health checks include the database error or timeout reason.

`elapsed_ms` measures preparation of response headers, including queue waits. It
does not measure downloading a file or the lifetime of an SSE stream. Responses
taking at least two seconds emit a warning outside `/health`. Slow 401 and 404
responses also become warnings. Responses with status 5xx remain at `ERROR`.
Routine playback, polling, and successful health checks are logged at `DEBUG`.

The logged route is a template, such as `/api/auth/invitations/{token}`. Unknown
routes use `<unmatched>`. Incoming request IDs, query strings, cookies,
authorization headers and bodies are not copied into request logs. Operational
events may contain account IDs/names, source file paths and sign-in IP addresses.
Context spans remain enabled at `ERROR` so restrictive filters retain their
identifiers; spans do not generate events on their own.

## Configuration

```dotenv
RUST_LOG=info
LOG_FORMAT=text
```

These are also the defaults when the variables are absent. `RUST_LOG` overrides
the defaults; a global level such as `info` or `debug` still leaves dependency
filters in place. Explicit module directives override them:

```dotenv
# All HTTP request starts and responses.
RUST_LOG=info,http=debug

# Individual analysis and HLS results.
RUST_LOG=info,app::analysis=debug,app::transcode=debug

# Metadata lookup outcomes and provider fallbacks.
RUST_LOG=info,app::integrations=debug

# MP3 decoder/probing details.
RUST_LOG=info,symphonia_bundle_mp3=debug
```

Use `LOG_FORMAT=json` for one JSON object per event, including timestamp,
severity, target, event fields and span context. Both formats use the same
filtering rules. Invalid `RUST_LOG` falls back to the default filter; invalid
`LOG_FORMAT` falls back to text. A warning explains the fallback. Restart the
backend after changing settings.

The bundled [Compose file](../docker-compose.yml) passes `RUST_LOG` and
`LOG_FORMAT` from the deployment `.env` to the backend and migration service.
After changing them, apply the configuration with `./caimack.sh start` or
`docker compose up -d` with your usual files. In a custom Compose deployment,
check that both values are passed to the backend container.
