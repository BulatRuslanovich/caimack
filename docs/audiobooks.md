[Documentation](README.md#music-library)

# Audiobooks

Audiobooks have their own catalog and keep a listening position for each book.
An administrator can enable **Audiobooks** in **Settings → Experimental** on the
web.

## Listen and download

1. Open **Audiobooks** in the web sidebar or choose **Audiobooks** on Android
   Home. Use **All** or **Music** to switch the Home filter back.
2. Save a book to your personal library. Sign in with the same account to resume
   it on another connected device. Offline checkpoints sync when you reconnect.
3. On Android or desktop, use the book's own menu to download it for offline
   playback. Audiobook downloads are separate from full music library sync.

## Add books to the server

### Add files on disk

| Deployment | Audiobook directory |
| --- | --- |
| Docker Compose | `./audiobooks`, or the host directory set by `AUDIOBOOKS_PATH` in the deployment `.env` |
| Native backend | `<STORAGE_ROOT>/audiobooks/` |

A top-level folder is one book. Put chapters directly inside it or in nested
disc folders. Files are played in natural filename order, so `Chapter 2.mp3`
comes before `Chapter 10.mp3`. An audio file directly in the audiobook root is
also treated as one book. An M4B is played as one continuous file.

```text
audiobooks/
├── Author - Title [Narrator]/
│   ├── cover.jpg
│   ├── Disc 1/
│   │   ├── Chapter 01.mp3
│   │   └── Chapter 02.mp3
│   └── Disc 2/
│       └── Chapter 03.mp3
└── Another Author - Another Title.m4b
```

Supported audio formats include MP3, FLAC, M4A, M4B, Ogg, Opus, and WAV. A name
such as `Author - Title [Narrator]` supplies display metadata. The scanner uses
embedded artwork or an image in the book directory (JPEG, PNG, or WebP). Name
the image `cover` or `folder`, plus the extension, to give it priority. For a
standalone audio file, put artwork with the same basename beside it.

With the experiment enabled, Caimack scans the directory on startup and on the
library scan interval. An administrator can also start a scan from **Upload**.
For books added on disk, the book and chapter IDs are based on their relative
paths. Web uploads retain the ID assigned at upload.

### Upload from the web

In the web audiobook catalog, select **Upload audiobook**. Choose one audio file
or a set of chapters for the same book. The limit is 2 GiB per upload. The book
appears after the server reads the chapters. Uploads use the same audiobook
directory, which must be writable by the backend user.

## Delete a book

An administrator can delete a book from its detail page. This removes the source
audio file or the entire book folder from the server and removes the book from
everyone's catalog.
