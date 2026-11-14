# Individual Android downloads

Download tracks or a collection with the download button. Existing automatic
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
removal.

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

With a saved account, the interface opens immediately while the server validates
the session. An unreachable server keeps access to individual downloads; a
rejected session still requires sign-in. A late validation response cannot
restore a session after logout or expiry.

This feature uses ordinary catalog requests and the existing individual download
manager. It does not synchronize the full library, export audio or companions to
a selected folder, rename music files, or modify tags, artwork or lyrics inside
those files.
