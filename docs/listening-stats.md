# Listening stats

Open **Settings → Listening stats** in the web or Android client. This section is
available with recommendations disabled and does not require MERT or a Spotify
account. It measures music played in Caimack.

The weekly overview contains listening minutes, top songs and artists, the number
of distinct songs and artists, and cards about the leading artist and decade.
Open a tile for the full ranking or a daily listening chart. Rankings show changes
from the previous calendar week and the number of available weeks spent in the
top five. Past weeks open the same overview. The refresh button is available
only on the current week's main overview.

Weeks run Monday through Sunday in the account's time zone. The API endpoint
`GET /api/me/listening-stats` returns the current week and 24 preceding weeks,
newest first, using retained playback events. The existing 180-day retention
still applies; this is not a permanent archive. Weeks with no activity remain
available in the response but are omitted from the past-weeks list. Current-week
comparisons use the previous full calendar week.

Listening time is derived from the increases in each playback attempt's cumulative
`listenedSeconds`, including progress checkpoints. Heartbeats, completion events,
pause checkpoints and retried reports are not summed independently. Playback
starts delimit repeat attempts on the same device/session. Separate devices have
separate counters. Seeking and pauses add no listening time; completed and skipped
attempts both retain the time actually heard. An attempt counts as a play once
it reaches 30 seconds, or all but the final second of a shorter track. Time is
assigned to the day of its progress report; the reporting interval can shift a
small amount of time around midnight. Offline activity appears after sync.

Songs rank by counted plays, with listening time breaking ties. Artists rank by
listening time, with plays breaking ties. A credited artist receives the track's
listening time; therefore different artists' times must not be added to obtain
the user's total. Decade cards use catalog years and the share of total listening
time, including music whose year is unknown in the denominator. Cards are omitted
when the required metadata or ranking is unavailable.

This section does not expose other users' statistics. Friend comparisons and
country/global percentiles require data and permissions outside this feature.
