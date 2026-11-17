# Individual Android downloads

For one track, open its **⋮ → Download** menu. The same menu offers **Cancel
download** while a transfer is queued or running, **Retry download** after a
failure, and **Remove download** once it is complete. Progress and downloaded
tracks are available in **Library → Downloads**. These actions manage the app's
offline copy, not the original server file.

Download an album or playlist with the download button next to playback. Existing automatic
download preferences continue to work. Browsing the catalog does not download
its audio, and downloading audio does not add albums, artists or playlists to
the personal library.

## Browsing without the server

The app retains metadata from pages opened while connected. Saved albums,
artists, playlists and personal folders keep their structure after an app
restart. Metadata is stored separately for each server and account.

Tracks without completed local audio remain visible in cached lists but are
dimmed and cannot be played. Starting a collection while the server is
unavailable queues only its completed downloads, preserving their order.
Downloaded audio from another server is excluded from the active server's list.
**Library → Downloads** always provides access to individual transfers and their
removal. The storage total at the top includes both individual downloads and
full-library synchronized audio, including embedded tags and artwork. It is
available for existing synchronized files without downloading them again.

Previously unseen pages require a connection. Open an older playlist online
once to retain its membership and ordering. A download's own metadata is enough
to browse its album and credited artists, including collaborators.

Catalog and folder editing require the server. Changes are never queued for
later synchronization in individual-download mode. With full library sync
enabled, supported offline edits use its durable action queue instead. A successful connection check restores normal requests
and playback availability.

## Artwork and startup

Album covers and images of all credited artists are retained alongside download
metadata in private app storage, separately from the evictable image cache.
Missing images are retried on startup, resume and reconnection. They also remain
available to the system media controls. Image failures do not block audio
downloads. Retained images are periodically revalidated while online. Images
from the fork's older flat cache are imported automatically on first access,
including when the server is unavailable.
Editing artwork requests immediate revalidation and keeps the previous image
available if the server cannot be reached.

Lyrics are fetched automatically for individual downloads, without opening the
lyrics panel first, and retained in private storage for the current server and
account. Plain text, line/word timestamps and provider credits survive app restarts.
Plain text and line-only timing are provisional while the server looks for word
timing. Downloads retry incomplete lyrics every 15 seconds, up to five checks
per refresh, and retain word intervals for the same progressive karaoke fill
used online. Existing line-only downloads are upgraded on startup, resume or
reconnection without downloading their audio again. Manual lyrics are preserved.
When no word-timed source exists, line highlighting remains the fallback;
the app does not invent word timings.
Previously downloaded tracks receive missing lyrics when the app next starts,
resumes or reconnects to the server; their audio does not need to be downloaded
again. Failed requests keep the last saved text. Lyrics must be available on the
server at least once before they can be displayed offline.

With a saved account, the interface opens immediately while the server validates
the session. An unreachable server keeps access to individual downloads; a
rejected session still requires sign-in. A late validation response cannot
restore a session after logout or expiry.

This feature uses ordinary catalog requests and the existing individual download
manager. It does not synchronize the full library, export audio or companions to
a selected folder, rename music files, or modify tags, artwork or lyrics inside
those files.
