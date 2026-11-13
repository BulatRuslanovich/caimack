# Lyrics lookup and synchronization

The Rust enrichment worker searches LRCLIB, Unison, Better Lyrics TTML, Better
Lyrics QQ, NetEase, QQ Music, Genius, Megalobiz, Kugou, and lyrics.ovh concurrently.
SimpMusic is queried using a video ID obtained from an identity-checked Unison
record; local filenames are never treated as YouTube IDs. No Python process,
audio transcription, or invented word timing is involved.

Each source has a 12-second lookup budget, HTTP requests time out after five
seconds, response bodies are capped at 2 MiB, and shared host schedules respect
rate limits and `Retry-After`. Endpoints returning HTTP 410 are treated as retired
until process restart, rather
than failing every subsequent lookup. LRCLIB retains its shared request spacing
and exponential backoff. A failed source does not discard another source's hit.
If no hit exists and a source failed, the durable job retries rather than treating
the failure as a definitive absence of lyrics.

## Matching and choosing a result

Title, leading artist, recording version and duration are checked before accepting
a result. Matching tolerates deterministic Cyrillic transliteration and common
presentation/remaster decorations. Live/acoustic/cover editions cannot inherit
the original recording's lyrics. Sped/slowed/remix base-title fallbacks can supply
plain text, with all timing removed. Unknown or incompatible durations also
remove synchronization.

Exact recording matches take precedence, then synchronization coverage, then
duration proximity. Real word/syllable intervals outrank line timing; line timing
outranks plain text. To avoid replacing a whole song with one timed verse, a
candidate must contain at least 70% of the longest verified text in the lookup.
The same completeness guard applies when upgrading a saved result.

`track_lyrics.synced` remains a JSON array with backwards-compatible `at` and
`text` fields. A rich line additionally has `end`, `words: [{at, end, text}]`, and
optionally `background`. Times are integer milliseconds. Translation and
romanization spans are excluded from the original vocal text. TTML clock and
relative offset expressions, frame/tick rates, enhanced LRC offsets, QRC, and YRC
are parsed and validated. Plain LRC never acquires synthetic word intervals.

Provider credit rows (such as `作词`, `作曲`, `Lyrics by`, and `Composed by`) and
matching title/artist headers are removed from displayed lyrics. Credit envelopes
are filtered before format detection because an LRC response can begin with YRC
credits. LRC metadata stays available during parsing so offsets remain correct.
Existing cached responses receive the same display cleanup without changing vocal
intervals; original provider payloads remain available for provenance.

Migration `0003_rich_lyrics.sql` adds provenance, original source text, match
metadata, and a generated quality column. Network work finishes before the short
database transaction. The transaction rechecks recording identity, and a
conditional upsert atomically rejects manual replacements, poorer matches,
downgrades and incomplete text. Metadata edits invalidate provider results while
preserving manual text. Existing catalog entries are scheduled for improvement.

Complete word/syllable hits are revisited after 30 days, other successful hits
after one day, misses after seven days, and failures use exponential backoff.
Opening a due lyric gives that track priority without bypassing backoff. Web and
Android views refresh incomplete results while open and stop polling once rich
or manual lyrics arrive. Both paint from the player clock, so pause, buffering,
playback speed and backward seeks do not drift. Reduced motion avoids frame
animation. The editor keeps the original rich source text when available.

## Provider configuration and attribution

`LRCLIB_BASE_URL` continues to configure LRCLIB. Optional
`BETTER_LYRICS_API_KEY` supplies the Better Lyrics `X-API-Key` header.
Docker Compose forwards the same setting from the root `.env` file. The public
TTML endpoint may only serve cached requests without a key. Better Lyrics TTML
must contain explicit song/artist identity metadata; an ambiguous response is
discarded even if the API returns HTTP 200.

Unison uses `https://unison.betterlyrics.org`; its lyric page and submitter credits
are persisted and displayed in both clients. Useful provider references:

- [Better Lyrics endpoint and authentication](https://docs.betterlyrics.org/reference/get-lyrics)
- [Unison response format and attribution](https://lyrics-api-docs.boidu.dev/unison)

Apply the database migration before deploying the new API. The existing migration
runner handles this normally. No reimport of audio files is required.

## Verification

Rust unit/HTTP fixture tests cover parsers, identity checks, partial results,
provider adapters, shared cooldowns and truncation guards. A PostgreSQL integration
test exercises upgrades, API decoding, manual preservation and stale recording
rejection (`integration-tests` feature). Frontend and Android tests cover old
responses, word progress, overlapping vocals and backwards seeks. The ignored
`live_lookup_smoke` test queries external providers explicitly; ordinary tests
remain independent of their availability.
