// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.progressSemantics
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.audiobooks.Audiobook
import app.caimack.audiobooks.AudiobookCatalog
import app.caimack.audiobooks.AudiobookPlaybackState
import kotlin.math.roundToInt

private const val RECENT = "recent"
private const val DURATION = "duration"
private const val DOWNLOADED = "downloaded"

@Composable
fun AudiobookBrowse(downloadedOnly: Boolean, homeFilters: @Composable () -> Unit) {
    val container = LocalContainer.current
    val catalog by container.audiobookStore.state.collectAsStateWithLifecycle()
    var sort by rememberSaveable { mutableStateOf(RECENT) }
    val filter = if (downloadedOnly) DOWNLOADED else sort
    val saved = catalog.books.filter { it.saved }
    val books = catalog.books
    val sorted = when (filter) {
        DURATION -> books.sortedBy { it.durationMs }
        DOWNLOADED -> books.filter { it.id in catalog.downloaded }
        else -> books.filterNot { it.progress?.completed == false }.sortedByDescending { it.progress?.updatedAtMs ?: 0L }
    }
    val inProgress = books.inProgress()
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = playerContentPadding(top = 12.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        item("home-filters") { homeFilters() }
        if (filter == RECENT) inProgress.firstOrNull()?.let { book ->
            item("continue") {
                BookHeader(R.string.audiobook_continue)
                BookHero(book, catalog)
            }
        }
        if (!downloadedOnly) item("filters") {
            CategoryFilterRow(filter, false, {}) {
                item(RECENT) { CategoryFilter(R.string.audiobook_recent, filter == RECENT) { sort = RECENT } }
                item(DURATION) { CategoryFilter(R.string.audiobook_by_duration, filter == DURATION) { sort = DURATION } }
            }
        }
        if (!catalog.ready && books.isEmpty()) item("loading") { BookLoading() }
        if (!downloadedOnly && catalog.ready && books.isEmpty() && !catalog.online) item("error") { Failure(container.audiobookStore::requestRefresh) }
        if (filter == RECENT) {
            bookSection("progress", R.string.audiobook_in_progress, inProgress, catalog)
            bookSection("saved", R.string.audiobook_saved_section, saved, catalog)
        }
        if (sorted.isNotEmpty()) {
            val heading = when {
                filter == DOWNLOADED -> R.string.collection_downloaded
                else -> R.string.audiobook_all
            }
            bookSection("catalog", heading, sorted, catalog)
        } else if (catalog.ready && (downloadedOnly || catalog.online || books.isNotEmpty()) && (filter != RECENT || inProgress.isEmpty())) {
            item("empty") { Empty(stringResource(if (downloadedOnly) R.string.downloads_empty_title else R.string.audiobook_empty)) }
        }
    }
}

internal fun LazyListScope.homeAudiobook(catalog: AudiobookCatalog) {
    val latest = catalog.books.inProgress().firstOrNull() ?: return
    item("audiobook-home-continue") {
        BookHeader(R.string.audiobook_continue_home)
        BookHero(latest, catalog)
    }
}

private fun LazyListScope.bookSection(key: String, title: Int, books: List<Audiobook>, catalog: AudiobookCatalog) {
    if (books.isEmpty()) return
    item("$key-title") { BookHeader(title) }
    items(books, key = { "$key-${it.id}" }) { BookRow(it, catalog) }
}

private fun List<Audiobook>.inProgress(): List<Audiobook> =
    filter { it.progress?.completed == false }.sortedByDescending { it.progress?.updatedAtMs }

@Composable
private fun BookHeader(title: Int) {
    Text(
        stringResource(title),
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
        style = Type.section,
    )
}

@Composable
private fun BookLoading() {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { RecordLoading(32.dp) }
}

@Composable
private fun BookHero(book: Audiobook, catalog: AudiobookCatalog) {
    val palette = LocalPalette.current
    val hero = if (palette.dark) palette else paletteOf(LocalColorway.current, dark = true)
    val navigate = LocalNavigate.current
    val container = LocalContainer.current
    val cover = container.audiobookStore.cover(book)
    val progress = book.progress ?: return
    val chapterIndex = book.chapters.indexOfFirst { it.id == progress.chapterId }
    val chapter = book.chapters.getOrNull(chapterIndex)
    val elapsed = book.elapsedMs(progress).coerceIn(0, book.durationMs)
    val secondary = hero.foreground.copy(alpha = .84f)
    Box(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(Radius.hero).background(hero.raised)
            .clickable { navigate(AudiobookRoute(book.id)) },
    ) {
        if (cover != null) {
            Cover(cover, book.title, Modifier.matchParentSize().blur(14.dp))
            Box(
                Modifier.matchParentSize()
                    .background(Brush.horizontalGradient(
                        0f to hero.background.copy(alpha = .62f),
                        .34f to hero.background.copy(alpha = .84f),
                        1f to hero.background.copy(alpha = .97f),
                    ))
                    .background(Brush.verticalGradient(
                        .35f to hero.background.copy(alpha = 0f),
                        1f to hero.background.copy(alpha = .82f),
                    )),
            )
        }
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(cover, book.title, Modifier.size(72.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(book.title, style = Type.section, color = hero.foreground, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    book.author?.let { Text(it, style = Type.small, color = secondary) }
                    book.narrator?.let { Text(stringResource(R.string.audiobook_narrator, it), style = Type.small, color = secondary) }
                }
                CompositionLocalProvider(LocalPalette provides hero) { BookPlay(book, catalog, prominent = true) }
            }
            if (chapter != null) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(chapterHeading(chapterIndex + 1, chapter.title),
                        style = Type.small, color = hero.foreground)
                    if (chapter.durationMs > 0) {
                        val position = progress.positionMs.coerceIn(0, chapter.durationMs)
                        val fraction = position.fractionOf(chapter.durationMs)
                        val label = stringResource(R.string.audiobook_chapter_position)
                        Text(chapterTime(position, chapter.durationMs),
                            style = Type.tiny, color = secondary)
                        PlayerProgressTrack(fraction, hero.primary, hero.borderStrong,
                            Modifier.padding(top = 4.dp).progressSemantics(fraction).semantics { contentDescription = label })
                    }
                }
            }
            if (book.durationMs > 0) {
                Text(bookSummary(book, elapsed, progress.completed), style = Type.tiny, color = secondary)
            }
        }
    }
}

@Composable
internal fun BookRow(book: Audiobook, catalog: AudiobookCatalog, open: (() -> Unit)? = null) {
    val container = LocalContainer.current
    val palette = LocalPalette.current
    val navigate = LocalNavigate.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(Radius.row)
            .clickable { if (open != null) open() else navigate(AudiobookRoute(book.id)) }.padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Cover(container.audiobookStore.cover(book), book.title, Modifier.size(58.dp))
            if (book.id in catalog.downloaded) {
                Icon(Lucide.CircleCheck, stringResource(R.string.collection_downloaded),
                    Modifier.align(Alignment.BottomEnd).size(18.dp).background(palette.background, CircleShape), tint = palette.primary)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(book.title, style = Type.body, maxLines = 2, overflow = TextOverflow.Ellipsis)
            BookByline(book)
            BookProgress(book)
        }
        BookPlay(book, catalog)
        BookMenu(book, catalog)
    }
}

@Composable
private fun BookByline(book: Audiobook) {
    val narrator = book.narrator?.let { stringResource(R.string.audiobook_narrator, it) }
    val byline = listOfNotNull(book.author, narrator).joinToString(" · ")
    if (byline.isNotBlank()) Text(byline, style = Type.small, color = LocalPalette.current.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun BookProgress(book: Audiobook) {
    val palette = LocalPalette.current
    val progress = book.progress
    val elapsed = progress?.let(book::elapsedMs)?.coerceIn(0, book.durationMs) ?: 0
    val label = when {
        progress?.completed == true -> stringResource(R.string.audiobook_completed)
        progress != null -> stringResource(R.string.audiobook_remaining, bookTime(book.durationMs - elapsed))
        else -> bookTime(book.durationMs)
    }
    if (progress != null && book.durationMs > 0) LinearProgressIndicator(
        progress = { elapsed.toFloat() / book.durationMs },
        modifier = Modifier.fillMaxWidth().height(4.dp),
        color = palette.primary,
        trackColor = palette.borderStrong,
    )
    Text(label, style = Type.tiny, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun BookPlay(book: Audiobook, catalog: AudiobookCatalog, prominent: Boolean = false) {
    val playback = LocalContainer.current.audiobookPlayback
    val state by playback.state.collectAsStateWithLifecycle()
    val playing = state?.let { it.bookId == book.id && (it.playing || it.buffering) } == true
    val enabled = playing || catalog.canPlay(book)
    val palette = LocalPalette.current
    if (prominent && enabled) {
        CollectionTransportButton(playing, enabled, size = 48.dp, iconSize = 20.dp) { playback.toggle(book) }
        return
    }
    IconButton(onClick = { playback.toggle(book) }, enabled = enabled) {
        Icon(
            if (playing) Lucide.Pause else Lucide.Play,
            stringResource(if (playing) R.string.action_pause else R.string.action_play),
            Modifier.size(20.dp),
            tint = if (enabled) palette.primary else palette.faint,
        )
    }
}

@Composable
internal fun BookMenu(book: Audiobook, catalog: AudiobookCatalog) {
    val store = LocalContainer.current.audiobookStore
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(Lucide.EllipsisVertical, stringResource(R.string.audiobook_actions), Modifier.size(19.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(if (book.saved) R.string.collection_remove else R.string.collection_add)) },
                leadingIcon = { LibrarySaveIcon(book.saved, null) },
                onClick = { open = false; store.setSaved(book.id, !book.saved) },
            )
            val downloaded = book.id in catalog.downloaded
            val progress = catalog.downloading[book.id]
            val label = when {
                progress != null -> stringResource(R.string.audiobook_download_progress, (progress * 100).toInt())
                downloaded -> stringResource(R.string.audiobook_remove_download)
                book.id in catalog.failedDownloads -> stringResource(R.string.audiobook_retry_download)
                else -> stringResource(R.string.audiobook_download)
            }
            DropdownMenuItem(
                text = { Text(label) },
                leadingIcon = { Icon(if (downloaded) Lucide.Trash2 else Lucide.Download, null) },
                enabled = progress == null && (downloaded || catalog.online),
                onClick = {
                    open = false
                    if (downloaded) store.removeDownload(book.id) else store.download(book)
                },
            )
        }
    }
}

@Composable
fun AudiobookDetail(id: String) {
    val container = LocalContainer.current
    val catalog by container.audiobookStore.state.collectAsStateWithLifecycle()
    val playback by container.audiobookPlayback.state.collectAsStateWithLifecycle()
    val book = catalog.books.firstOrNull { it.id == id }
    if (book == null) {
        if (catalog.ready) Empty(stringResource(R.string.audiobook_empty)) else BookLoading()
        return
    }

    val active = playback?.takeIf { it.bookId == id }
    val chapterId = active?.chapterId ?: book.progress?.chapterId
    val cover = container.audiobookStore.cover(book)
    val playable = catalog.canPlay(book)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding(bottom = 24.dp)) {
        item("header") {
            DetailHeader(
                kind = stringResource(R.string.audiobook_kind),
                title = book.title,
                facts = listOfNotNull(
                    book.author,
                    book.narrator?.let { stringResource(R.string.audiobook_narrator, it) },
                    pluralStringResource(R.plurals.audiobook_chapter_count, book.chapters.size, book.chapters.size),
                    bookTime(book.durationMs),
                ),
                backdrop = cover,
            ) { Cover(cover, book.title, it) }
        }
        item("actions") { BookDetailActions(book, active, catalog) }
        if (active != null || book.progress != null) {
            item("listening-position") { BookListeningPosition(book, active) }
        }
        item("chapter-header") { SectionHeader(stringResource(R.string.audiobook_chapters)) }
        itemsIndexed(book.chapters, key = { _, chapter -> chapter.id }) { index, chapter ->
            val palette = LocalPalette.current
            val density = LocalLibraryDensity.current
            val current = chapter.id == chapterId
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp).clip(Radius.row)
                    .then(if (current) Modifier.background(palette.card) else Modifier)
                    .alpha(if (playable) 1f else .38f)
                    .clickable(enabled = playable) { container.audiobookPlayback.play(book, chapter.id) }
                    .heightIn(min = 48.dp)
                    .padding(start = 8.dp, end = 12.dp, top = density.rowPadding, bottom = density.rowPadding),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(Modifier.width(26.dp), contentAlignment = Alignment.CenterEnd) {
                    if (current && active?.playing == true) NowPlayingBars(palette.primary)
                    else Text((index + 1).toString(), style = Type.small, color = if (current) palette.primary else palette.faint)
                }
                Text(chapter.title, Modifier.weight(1f), style = Type.body.copy(fontWeight = FontWeight.Medium),
                    color = if (current) palette.primary else palette.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(bookTime(chapter.durationMs), style = Type.tiny, color = palette.faint)
            }
        }
    }
}

@Composable
private fun BookDetailActions(book: Audiobook, active: AudiobookPlaybackState?, catalog: AudiobookCatalog) {
    val container = LocalContainer.current
    val player = container.audiobookPlayback
    val palette = LocalPalette.current
    val playing = active?.let { it.playing || it.buffering } == true
    val download = catalog.downloading[book.id]
    val downloaded = book.id in catalog.downloaded
    val downloadLabel = stringResource(when {
        downloaded -> R.string.audiobook_remove_download
        book.id in catalog.failedDownloads -> R.string.audiobook_retry_download
        else -> R.string.audiobook_download
    })
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CollectionTransportButton(playing, playing || catalog.canPlay(book)) { player.toggle(book) }
        Spacer(Modifier.weight(1f))
        IconButton(onClick = { container.audiobookStore.setSaved(book.id, !book.saved) }) {
            LibrarySaveIcon(book.saved, stringResource(if (book.saved) R.string.collection_remove else R.string.collection_add))
        }
        if (download != null) {
            val label = stringResource(R.string.audiobook_download_progress, (download * 100).toInt())
            Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    progress = { download },
                    modifier = Modifier.size(22.dp).semantics { contentDescription = label },
                    color = palette.primary, trackColor = palette.raised, strokeWidth = 2.5.dp,
                )
            }
        } else {
            IconButton(enabled = downloaded || catalog.online, onClick = {
                if (downloaded) container.audiobookStore.removeDownload(book.id) else container.audiobookStore.download(book)
            }) {
                Icon(if (downloaded) Lucide.CircleArrowDown else Lucide.Download, downloadLabel, tint = if (downloaded) palette.primary else palette.muted)
            }
        }
    }
    if (book.id in catalog.failedDownloads) {
        Text(stringResource(R.string.audiobook_download_error), Modifier.padding(horizontal = 16.dp),
            style = Type.tiny, color = palette.muted)
    }
}

@Composable
private fun BookListeningPosition(book: Audiobook, active: AudiobookPlaybackState?) {
    val player = LocalContainer.current.audiobookPlayback
    val palette = LocalPalette.current
    val saved = book.progress
    val chapterIndex = book.chapters.indexOfFirst { it.id == (active?.chapterId ?: saved?.chapterId) }
    val chapter = book.chapters.getOrNull(chapterIndex)
    val duration = active?.durationMs?.takeIf { it > 0 } ?: chapter?.durationMs ?: 0
    val position = (active?.positionMs ?: saved?.positionMs ?: 0).coerceIn(0, duration)
    val elapsed = when {
        saved?.completed == true && (active == null || active.chapterId == saved.chapterId && active.positionMs >= saved.positionMs) -> book.durationMs
        active != null && chapterIndex >= 0 -> book.chapters.take(chapterIndex).sumOf { it.durationMs } + position
        else -> saved?.let(book::elapsedMs) ?: 0
    }.coerceIn(0, book.durationMs)
    val chapterProgressLabel = stringResource(R.string.audiobook_chapter_position)
    var preview by remember(active?.chapterId) { mutableStateOf<Long?>(null) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        chapter?.let {
            Text(chapterHeading(chapterIndex + 1, it.title), style = Type.small)
        }
        if (chapter != null && duration > 0) {
            Text(chapterTime(preview ?: position, duration), style = Type.tiny, color = palette.muted)
            if (active != null && !active.failed) {
                key(active.chapterId) {
                    Seekbar(position, duration, peaks = null, onScrub = { preview = it }, onSeek = player::seek)
                }
            } else {
                val fraction = position.fractionOf(duration)
                PlayerProgressTrack(fraction, palette.foreground, palette.borderStrong,
                    Modifier.progressSemantics(fraction).semantics { contentDescription = chapterProgressLabel })
            }
        }
        if (book.durationMs > 0 || saved?.completed == true) {
            Text(bookSummary(book, elapsed, saved?.completed == true && elapsed == book.durationMs),
                Modifier.padding(top = 4.dp), style = Type.tiny, color = palette.muted)
        }
        if (active?.failed == true) Text(stringResource(R.string.audiobook_playback_error), style = Type.small, color = palette.muted)
    }
}

@Composable
private fun chapterHeading(number: Int, title: String): String =
    if (title == stringResource(R.string.audiobook_chapter_number, number)) title
    else stringResource(R.string.audiobook_numbered_chapter, number, title)

@Composable
private fun chapterTime(position: Long, duration: Long): String =
    stringResource(R.string.audiobook_position_of, bookTime(position), bookTime(duration))

@Composable
private fun bookSummary(book: Audiobook, elapsed: Long, complete: Boolean): String =
    if (complete) stringResource(R.string.audiobook_completed)
    else stringResource(R.string.audiobook_book_summary, (elapsed.fractionOf(book.durationMs) * 100).roundToInt().coerceAtMost(99),
        bookTime(book.durationMs - elapsed))

private fun Long.fractionOf(duration: Long): Float = if (duration > 0) (toDouble() / duration).coerceIn(0.0, 1.0).toFloat() else 0f

private fun AudiobookCatalog.canPlay(book: Audiobook): Boolean =
    book.chapters.isNotEmpty() && (online || book.id in downloaded)

internal fun bookTime(ms: Long): String {
    val seconds = ms.coerceAtLeast(0) / 1_000
    return if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)
    else "%d:%02d".format(seconds / 60, seconds % 60)
}
