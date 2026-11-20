// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
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

private const val RECENT = "recent"
private const val DURATION = "duration"
private const val DOWNLOADED = "downloaded"

@Composable
fun AudiobookBrowse(savedOnly: Boolean = false) {
    val container = LocalContainer.current
    val catalog by container.audiobookStore.state.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(RECENT) }
    val saved = catalog.books.filter { it.saved }
    val books = if (savedOnly) saved else catalog.books
    val sorted = when (filter) {
        DURATION -> books.sortedBy { it.durationMs }
        DOWNLOADED -> books.filter { it.id in catalog.downloaded }
        else -> books.sortedByDescending { it.progress?.updatedAtMs ?: 0L }
    }
    val inProgress = books.inProgress()
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = playerContentPadding(top = 12.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (!savedOnly && filter == RECENT) inProgress.firstOrNull()?.let { book ->
            item("continue") {
                BookHeader(R.string.audiobook_continue)
                BookHero(book, catalog)
            }
        }
        item("filters") {
            CategoryFilterRow(filter, false, {}) {
                item(RECENT) { CategoryFilter(R.string.audiobook_recent, filter == RECENT) { filter = RECENT } }
                item(DURATION) { CategoryFilter(R.string.audiobook_by_duration, filter == DURATION) { filter = DURATION } }
                item(DOWNLOADED) { CategoryFilter(R.string.collection_downloaded, filter == DOWNLOADED) { filter = DOWNLOADED } }
            }
        }
        if (!catalog.ready && books.isEmpty()) item("loading") { BookLoading() }
        if (catalog.ready && books.isEmpty() && !catalog.online) item("error") { Failure(container.audiobookStore::requestRefresh) }
        if (!savedOnly && filter == RECENT) {
            bookSection("progress", R.string.audiobook_in_progress, inProgress, catalog)
            bookSection("saved", R.string.audiobook_saved_section, saved, catalog)
        }
        if (sorted.isNotEmpty()) {
            val heading = when {
                filter == DOWNLOADED -> R.string.collection_downloaded
                savedOnly -> R.string.audiobook_saved_section
                else -> R.string.audiobook_all
            }
            bookSection("catalog", heading, sorted, catalog)
        } else if (catalog.ready && (catalog.online || books.isNotEmpty())) {
            item("empty") { Empty(stringResource(R.string.audiobook_empty)) }
        }
    }
}

internal fun LazyListScope.homeAudiobooks(catalog: AudiobookCatalog, open: () -> Unit) {
    if (catalog.books.isEmpty()) return
    item("audiobook-home-title") { BookHeader(R.string.nav_audiobooks, open) }
    val inProgress = catalog.books.inProgress()
    inProgress.firstOrNull()?.let { book -> item("audiobook-home-continue") { BookHero(book, catalog) } }
    bookSection("home-progress", R.string.audiobook_in_progress, inProgress.take(3), catalog)
    bookSection("home-unplayed", R.string.audiobook_unplayed, catalog.books.filter { it.progress == null }.take(3), catalog)
}

private fun LazyListScope.bookSection(key: String, title: Int, books: List<Audiobook>, catalog: AudiobookCatalog) {
    if (books.isEmpty()) return
    item("$key-title") { BookHeader(title) }
    items(books, key = { "$key-${it.id}" }) { BookRow(it, catalog) }
}

private fun List<Audiobook>.inProgress(): List<Audiobook> =
    filter { it.progress?.completed == false }.sortedByDescending { it.progress?.updatedAtMs }

@Composable
private fun BookHeader(title: Int, open: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(title), Modifier.weight(1f), style = Type.section)
        if (open != null) TextButton(onClick = open) {
            Text(stringResource(R.string.audiobook_browse_all), color = LocalPalette.current.primary, style = Type.small)
            Icon(Lucide.ChevronRight, null, Modifier.size(16.dp), tint = LocalPalette.current.primary)
        }
    }
}

@Composable
private fun BookLoading() {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { RecordLoading(32.dp) }
}

@Composable
private fun BookHero(book: Audiobook, catalog: AudiobookCatalog) {
    val palette = LocalPalette.current
    val navigate = LocalNavigate.current
    val container = LocalContainer.current
    val cover = container.audiobookStore.cover(book)
    Box(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(Radius.panel).background(palette.raised)
            .clickable { navigate(AudiobookRoute(book.id)) },
    ) {
        if (cover != null) {
            Cover(cover, book.title, Modifier.matchParentSize())
            Box(Modifier.matchParentSize().background(Brush.horizontalGradient(listOf(palette.background.copy(alpha = .35f), palette.background.copy(alpha = .95f)))))
        }
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Cover(cover, book.title, Modifier.size(76.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(book.title, style = Type.section, color = palette.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                BookByline(book)
                book.progress?.let { progress -> book.chapters.firstOrNull { it.id == progress.chapterId }?.let {
                    Text(it.title, color = palette.muted, style = Type.tiny, maxLines = 1, overflow = TextOverflow.Ellipsis)
                } }
                BookProgress(book)
            }
            BookPlay(book, catalog)
        }
    }
}

@Composable
private fun BookRow(book: Audiobook, catalog: AudiobookCatalog) {
    val container = LocalContainer.current
    val palette = LocalPalette.current
    val navigate = LocalNavigate.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(Radius.row)
            .clickable { navigate(AudiobookRoute(book.id)) }.padding(vertical = 5.dp),
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
private fun BookPlay(book: Audiobook, catalog: AudiobookCatalog) {
    val playback = LocalContainer.current.audiobookPlayback
    val state by playback.state.collectAsStateWithLifecycle()
    val playing = state?.let { it.bookId == book.id && (it.playing || it.buffering) } == true
    val palette = LocalPalette.current
    IconButton(onClick = { playback.toggle(book) }, enabled = playing || catalog.canPlay(book)) {
        Icon(
            if (playing) Lucide.Pause else Lucide.Play,
            stringResource(if (playing) R.string.action_pause else R.string.action_play),
            Modifier.size(20.dp),
            tint = if (playing || catalog.canPlay(book)) palette.primary else palette.faint,
        )
    }
}

@Composable
private fun BookMenu(book: Audiobook, catalog: AudiobookCatalog) {
    val store = LocalContainer.current.audiobookStore
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(Lucide.EllipsisVertical, stringResource(R.string.audiobook_actions), Modifier.size(19.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(if (book.saved) R.string.audiobook_unsave else R.string.audiobook_save)) },
                leadingIcon = { Icon(if (book.saved) Lucide.Check else Lucide.LibraryBig, null) },
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
internal fun AudiobookMiniPlayer(book: Audiobook, catalog: AudiobookCatalog, open: () -> Unit) {
    val palette = LocalPalette.current
    val cover = LocalContainer.current.audiobookStore.cover(book)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp).clip(Radius.panel)
            .background(palette.raised).clickable(onClick = open).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Cover(cover, book.title, Modifier.size(42.dp))
        Column(Modifier.weight(1f)) {
            Text(book.title, style = Type.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
            BookByline(book)
        }
        BookPlay(book, catalog)
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
        if (active != null && book.chapters.size > 1) {
            IconButton(onClick = { player.skipChapter(false) }, enabled = book.chapters.first().id != active.chapterId) {
                Icon(Lucide.SkipBack, stringResource(R.string.audiobook_previous_chapter), Modifier.size(18.dp))
            }
            IconButton(onClick = { player.skipChapter(true) }, enabled = book.chapters.last().id != active.chapterId) {
                Icon(Lucide.SkipForward, stringResource(R.string.audiobook_next_chapter), Modifier.size(18.dp))
            }
        }
        Spacer(Modifier.weight(1f))
        IconButton(onClick = { container.audiobookStore.setSaved(book.id, !book.saved) }) {
            LibrarySaveIcon(book.saved, stringResource(if (book.saved) R.string.audiobook_unsave else R.string.audiobook_save))
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
    val chapter = book.chapters.firstOrNull { it.id == (active?.chapterId ?: book.progress?.chapterId) }
    val position = active?.positionMs ?: book.progress?.positionMs ?: 0
    val duration = active?.durationMs?.takeIf { it > 0 } ?: chapter?.durationMs ?: 0
    var dragging by remember(active?.chapterId) { mutableStateOf(false) }
    var target by remember(active?.chapterId) { mutableFloatStateOf(0f) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        chapter?.let {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(it.title, Modifier.weight(1f), style = Type.small, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${bookTime(if (dragging) target.toLong() else position)} / ${bookTime(duration)}", style = Type.tiny, color = palette.muted)
            }
        }
        if (duration > 0 && active != null && !active.failed) {
            Slider(
                value = if (dragging) target else position.coerceIn(0, duration).toFloat(),
                onValueChange = { dragging = true; target = it },
                onValueChangeFinished = { player.seek(target.toLong()); dragging = false },
                valueRange = 0f..duration.toFloat(),
                colors = SliderDefaults.colors(
                    thumbColor = palette.primary,
                    activeTrackColor = palette.primary,
                    inactiveTrackColor = palette.borderStrong,
                ),
            )
        } else {
            BookProgress(book)
        }
        if (active?.failed == true) Text(stringResource(R.string.audiobook_playback_error), style = Type.small, color = palette.muted)
    }
}

private fun AudiobookCatalog.canPlay(book: Audiobook): Boolean =
    book.chapters.isNotEmpty() && (online || book.id in downloaded)

private fun bookTime(ms: Long): String {
    val seconds = ms.coerceAtLeast(0) / 1_000
    return if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)
    else "%d:%02d".format(seconds / 60, seconds % 60)
}
