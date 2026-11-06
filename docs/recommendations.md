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
