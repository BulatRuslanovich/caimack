# Recommendation evaluation

Caimack can compare the original radio ranking (`legacyV3`) with calibrated
ranking (`calibratedV4`) on existing MERT vectors. No model download, GPU inference
or audio reanalysis is required. Calibrated ranking is used by the radio; the
home shelves and library map retain their existing algorithms.

## What changed

The candidate's raw cosine is preserved in `features.similarity`. Radio now uses
`features.similarity_rank`, an empirical rank among eligible candidates, when
combining sound similarity with taste, behavior and current-session evidence.
This makes the sound signal's influence less dependent on the model's cosine
range. These ranks are relative evidence, not probabilities of liking a track.
Blocked/rejected tracks, queue items and seed copies do not define the scale.
Ties share a midpoint rank; numerically indistinguishable scores are neutral.

The same seed-proximity filter now applies to discovery and familiar pools.
As before, a depleted pool may fall back to wider candidates to fill the queue.
Artist limits, duplicate filtering, recent-play penalties, session adaptation,
tempo/key/loudness transitions and discovery allocation remain in place.
Impression feature version is now 4; earlier records are left intact.

## Generate a paired report

On the Linux server, with the candidate backend image available and the database running:

```bash
docker compose run --rm -T --no-deps backend recommendations-evaluate YOUR_USERNAME > report.json
```

Use the same Compose files/project directory that normally start your server.
This runs a one-off evaluation process; it does not replace the running backend
or start MERT. If the candidate backend is already running, use
`docker compose exec -T backend caimack recommendations-evaluate YOUR_USERNAME`
instead.
For a source checkout with `DATABASE_URL` configured:

```bash
cd backend
cargo run --release --locked -- recommendations-evaluate YOUR_USERNAME > report.json
```

The command opens read-only database connections. It does not migrate, enqueue
analysis, record impressions or generate playback/feedback events. Current MERT
vectors must already exist. Fingerprint groups are reconstructed from existing
analysis to apply duplicate exclusions consistently with the running service.

By default, up to 20 seeds are chosen from allowed tracks: a preferred track first,
then tracks that cover different parts of the sound space. This deliberate
coverage sample is not representative of listening frequency. To fix your own
set of up to 30 seeds, append their track UUIDs:

```bash
docker compose run --rm -T --no-deps backend recommendations-evaluate YOUR_USERNAME \
  SEED_TRACK_UUID_1 SEED_TRACK_UUID_2 > report.json
```

Each seed receives up to 10 results from each algorithm. Both variants share the
same immutable embedding snapshot, history, rules, clock, random seed, empty
queue and fresh session. The report captures its timestamp, model strategy,
candidate cosine distributions, track labels, ordered results and score features.
This evaluates seeded radio in a fresh session, not home shelves or session
adaptation. Preserve the report: judgments are bound to its SHA-256 identifier.

## Blind judgments

Copy `report.json` to a machine with this repository and Python 3. From its root:

```bash
python backend/scripts/evaluate_recommendations.py prepare report.json ratings.csv
```

Open `ratings.csv` in a spreadsheet or editor. It contains shuffled, deduplicated
seed/candidate pairs and hides algorithm names and positions. For each pair,
listen to the two tracks in Caimack and grade whether the candidate belongs in
radio started from this seed, considering your taste:

| Rating | Meaning |
| --- | --- |
| `0` | Poor fit |
| `1` | Acceptable |
| `2` | Good fit |
| blank | Not evaluated |

Use `notes` for observations; preserve the ID columns. A shared candidate needs
only one grade per seed. `prepare` refuses to overwrite an existing ratings file.

```bash
python backend/scripts/evaluate_recommendations.py score report.json ratings.csv > comparison.json
```

The comparison reports judged-pair coverage and **paired** Precision@10 and
nDCG@10. Only seeds whose entire pooled candidate set has been judged contribute
to either algorithm's relevance metrics. Blank/missing judgments never count as
dislikes. Precision treats grades 1–2 as relevant; fewer than 10 results leave
empty slots. nDCG uses gains `2^rating - 1`, discounts by rank, and an ideal list
drawn from the pooled candidates. An all-zero pool scores zero.

Mean seed cosine, pairwise cosine and artist counts are structural diagnostics,
not evidence that listeners prefer an algorithm. Positive relevance deltas on
a small hand-picked set are preliminary; keep some seeds untouched while tuning
and repeat on a separate set before drawing conclusions. More graded listening
and real started-track completion/early-skip outcomes are needed before training
personalized ranking weights. Unplayed recommendations are not negative labels.
