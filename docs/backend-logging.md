# Backend logging

Logs go to **stderr**. The default text format includes the date, milliseconds,
timezone, severity, module and named fields. Colours are enabled only in an
interactive terminal; `NO_COLOR` disables them.

## Levels

| Level | Meaning |
| --- | --- |
| `ERROR` | HTTP 5xx, failed background operations, task crashes and fatal startup/runtime failures. |
| `WARN` | Missing or unreadable audio, unavailable MERT, retries, HTTP 403/429 and slow responses. |
| `INFO` | Startup/readiness/shutdown, database connection, account events, uploads, job progress and summaries, index rebuilds. |
| `DEBUG` | Routine HTTP responses (including 401/404), individual analysis/enrichment/transcode results, renames and exports. |

Symphonia, SQL and HTTP dependency chatter is filtered at `WARN` by default.
MP3 bitrate estimates and Xing header messages are hidden; decoder warnings and
errors remain visible.

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
taking at least two seconds emit a warning, except healthy `/health` responses.
HTTP failures retain their severity even when slow. Successful playback, polling
and health checks stay at `DEBUG`.

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

For Docker, pass variables into the **backend container**; a Compose `.env` entry
alone does not automatically enter the container environment. Follow logs with
`./caimack.sh logs backend -f` or `docker compose logs -f backend`.
