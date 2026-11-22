[Documentation](README.md#listen-on-your-devices)

# Listening stats

Open **Settings → Listening stats** in the web or Android client to see what
you played in Caimack. The weekly overview is available with recommendations
disabled.

## Read the weekly overview

The overview shows listening minutes, your most-played songs and artists,
distinct counts, and leading artist and decade cards. Open a tile for its
ranking or daily chart. Rankings compare with the previous full calendar week
and show how many available weeks an item spent in the top five. Refresh the
current week from its main overview.

Weeks run Monday through Sunday in your account's time zone.
`GET /api/me/listening-stats` returns the current week and 24 preceding weeks
from retained playback events, in newest-first order. Playback events are
retained for 180 days. The app omits weeks with no activity from the past-weeks
list.

## How time and rankings are counted

Listening time is derived from the increases in each playback attempt's cumulative
`listenedSeconds`, including progress checkpoints. Heartbeats, completion events,
pause checkpoints and retried reports are not summed independently. Playback
starts delimit repeat attempts on the same device/session. Separate devices have
separate counters. Seeking and pauses add no listening time; completed and skipped
attempts both retain the time actually heard. The play threshold is the lower
of 30 seconds and the track duration minus one second, with a minimum of one
second. Time is assigned to the day of the progress report, so the reporting
interval can shift a small amount of time around midnight. Offline activity
appears after sync.

Songs rank by counted plays, with listening time breaking ties. Artists rank by
listening time, with plays breaking ties. A credited artist receives the track's
listening time; therefore different artists' times must not be added to obtain
the user's total. Decade cards use catalog years and the share of total listening
time, including music whose year is unknown in the denominator. Cards are omitted
when the required metadata or ranking is unavailable.

These statistics are private to the account.

## Recommendation metrics

When [recommendations are enabled](mert.md), open **Settings → Recommendations**
in the web app and select a period. This view measures listening outcomes for
radio and personalised recommendations. Expand **How to read these numbers** for
definitions and the number of excluded attempts.

| Outcome | Listening evidence |
| --- | --- |
| Early skip | Explicit skip before 20% of the song and before 30 seconds. |
| Partial listen | At least 50% and less than 80% of the track heard. |
| Near-complete listen | At least 80% heard, even if the outro was skipped. |
| Unrated | No clear outcome, including unfinished attempts, missing duration, and ambiguous fractions. |

Percentages use rated attempts. Suggestions that never start receive no rating.
Seeking adds no listening time, and technical failures do not count as skips.
The next track on the same device starts a new attempt, and retries of a final
event count once.

Radio compares close matches with discoveries, including pending or unreached
suggestions. Expand the source table for metrics ranked by listening time.
Metrics refresh every 30 minutes or on demand. They reflect listening context
and changes to your library as well as recommendation quality.
