# Recommendation quality

Recommendation quality is measured automatically from listening behavior.
Open **Settings → Recommendations** in the web client and select a period.
The listening summary shows counts for grades 0, 1 and 2, the mean grade out of 2,
and the number of attempts without enough evidence to assign a grade.

| Grade | Evidence |
| --- | --- |
| 0 | Explicit skip before 20% of the track and before 30 seconds |
| 1 | At least 50%, less than 80%, actually heard |
| 2 | At least 80% actually heard, even if the final outro was skipped |
| No grade | Unfinished listening, missing duration, or an ambiguous fraction |

Web and Android track actual played time. Seeking to the end does not create a
positive grade. Pausing, closing the player or abandoning an unplayable file does
not create a negative grade. A nearly completed short track is positive even when
it lasts less than 30 seconds. New clients discard technical failures instead of
reporting them as user skips.

Each listening attempt is bounded by the next track start on the same device.
Repeated terminal events count once. Listening from another device or account
cannot complete that attempt. Recommendations which were never started are not
graded. The summary covers radio and personalized recommendation sources.

The same boundaries inform the recent session and long-term taste profile. Likes,
replays, artist preferences, multiple taste clusters and repeat penalties continue
to contribute. A single quick skip is weak evidence, not a permanent ban.
No extra MERT inference or manual ratings are needed.

Grades are implicit evidence of satisfaction, not an objective accuracy score.
An improving mean over time can also reflect changes in the library or listening
context; comparisons over different periods are not a randomized A/B test.
The ranking weights themselves are not automatically trained from these grades.

## Selection and playback order

Taste fit and sound similarity use the same tie-aware relative ranks. Identical
scores share a midpoint instead of receiving different preferences according to
their catalog position. A flat or singleton pool is neutral.

Radio batches and home track shelves count every credited artist toward the
artist limit. Repeated credits within one song count once. Radio permits one
track per artist in batches of up to six and two in larger batches; home track
shelves permit two. Artist and duplicate limits remain in force during fallback.

Seeded radio exhausts a close neighborhood before expanding it in bounded steps.
The bounds are differences from the best available relative similarity:

| Focus | Initial gap | Second gap | Maximum gap |
| --- | --- | --- | --- |
| Closer | 0.15 | 0.25 | 0.35 |
| Balanced | 0.35 | 0.45 | 0.50 |

Within each neighborhood, the engine can relax its soft preference score before
expanding the sound boundary. It searches beyond the initial candidate pool when
artist limits exhaust the nearest entries. If the constraints cannot fill a
batch, it returns fewer tracks. Wider focus, unseeded personal radio and recovery
after repeated skips can deliberately explore outside these seed boundaries.

The engine first selects the batch using sound, taste, behavior, recency,
discovery allocation and diversity. Only then does it greedily order that fixed
set for tempo, key and loudness transitions. Transition metadata cannot add or
replace a selected song. Equal transition scores preserve relevance order, and a
new anchor chosen to escape a stuck artist remains first. Discoveries keep the
positions assigned during selection, so transition ordering cannot bunch them
together or change the exploration allocation.

Impression feature version 6 records the selection score separately from the
actual transition score in the resulting playback order. Existing embeddings and
listening history remain usable; no model inference is needed for this update.
