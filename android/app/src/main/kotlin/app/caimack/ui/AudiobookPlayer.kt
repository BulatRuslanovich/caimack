// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.audiobooks.Audiobook
import app.caimack.audiobooks.AudiobookPlaybackState
import app.caimack.haptics.PlayerHaptic

@Composable
internal fun AudiobookMiniPlayer(
    book: Audiobook,
    playback: AudiobookPlaybackState,
    cover: String?,
    onOpen: () -> Unit,
    onBook: () -> Unit,
) {
    val container = LocalContainer.current
    val chapter = book.chapters.firstOrNull { it.id == playback.chapterId }
    MiniPlayerLayout(
        artwork = PlayerArtworkRef(book.id, cover, book.title),
        position = playback.positionMs,
        duration = playback.durationMs.takeIf { it > 0 } ?: chapter?.durationMs ?: 0,
        playing = playback.playing || playback.buffering,
        buffering = playback.buffering,
        saved = book.saved,
        saveLabel = stringResource(if (book.saved) R.string.collection_remove else R.string.collection_add),
        onOpen = onOpen,
        toggle = { container.audiobookPlayback.toggle(book) },
        save = { container.audiobookStore.setSaved(book.id, !book.saved) },
        leadingControl = { _, secondary -> IconAction(Lucide.LibraryBig, stringResource(R.string.audiobook_open_book), tint = secondary, onClick = onBook) },
    ) { modifier ->
        MiniPlayerText(book.title, chapter?.title ?: book.author.orEmpty(), null, modifier.testTag("mini-player-tracks"))
    }
}

@Composable
internal fun AudiobookFullPlayer(
    book: Audiobook,
    playback: AudiobookPlaybackState,
    cover: String?,
    onOpenBook: () -> Unit,
    onClose: () -> Unit,
) {
    CaimackTheme(dark = true, palette = PlayerPalette) {
        BookPlayerContent(book, playback, cover, onOpenBook, onClose)
    }
}

@Composable
private fun BookPlayerContent(
    book: Audiobook,
    playback: AudiobookPlaybackState,
    cover: String?,
    onOpenBook: () -> Unit,
    onClose: () -> Unit,
) {
    val container = LocalContainer.current
    val player = container.audiobookPlayback
    val palette = LocalPalette.current
    val haptic = rememberPlayerHaptics()
    val surface = rememberPlayerSurface(cover)
    val artwork = PlayerArtworkRef(book.id, cover, book.title)
    val index = book.chapters.indexOfFirst { it.id == playback.chapterId }
    val chapter = book.chapters.getOrNull(index)
    val duration = playback.durationMs.takeIf { it > 0 } ?: chapter?.durationMs ?: 0
    var chapters by rememberSaveable(book.id) { mutableStateOf(false) }
    var options by remember { mutableStateOf(false) }

    FullPlayerLayout(
        panelOpen = chapters,
        onBack = { if (chapters) chapters = false else onClose() },
        header = {
            PlayerHeader(stringResource(R.string.player_now_playing), onClose) {
                Box {
                    IconAction(Lucide.EllipsisVertical, stringResource(R.string.menu_more)) { options = true }
                    DropdownMenu(options, onDismissRequest = { options = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.audiobook_open_book)) },
                            leadingIcon = { Icon(Lucide.LibraryBig, null) },
                            onClick = { options = false; onOpenBook() },
                        )
                    }
                }
            }
        },
        artwork = { modifier, inset -> BookRecord(artwork, playback, modifier.padding(horizontal = inset)) },
        background = { PlayerBackdropFill(surface, it.testTag("player-backdrop")) },
        stage = { modifier ->
            if (chapters) {
                BookChapterQueue(book, index, playback.playing, modifier) { chapterId -> player.play(book, chapterId) }
            } else {
                BookRecord(artwork, playback, modifier)
            }
        },
        controls = { modifier ->
            Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.Bottom)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(book.title, style = if (chapters) Type.body else displayStyle(book.title),
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                        book.author?.let { Text(it, style = Type.body, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        chapter?.let { Text(it.title, style = Type.small, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        if (playback.failed) Text(stringResource(R.string.audiobook_playback_error), style = Type.tiny, color = palette.muted)
                    }
                    Box(Modifier.size(48.dp).clip(Radius.row).clickable {
                        haptic(PlayerHaptic.Favorite)
                        container.audiobookStore.setSaved(book.id, !book.saved)
                    }, contentAlignment = Alignment.Center) {
                        LibrarySaveIcon(book.saved, stringResource(if (book.saved) R.string.collection_remove else R.string.collection_add))
                    }
                }
                if (!chapters && duration > 0) {
                    key(playback.chapterId) {
                        Seekbar(playback.positionMs, duration, peaks = null, onSeek = player::seek)
                    }
                    Row {
                        Text(bookTime(playback.positionMs), style = Type.tiny, color = palette.muted)
                        Spacer(Modifier.weight(1f))
                        Text(bookTime(duration), style = Type.tiny, color = palette.muted)
                    }
                }
                PlayerTransport(
                    playing = playback.playing || playback.buffering,
                    buffering = playback.buffering,
                    toggle = { player.toggle(book) },
                    leading = {
                        IconAction(Lucide.History, stringResource(R.string.audiobook_back_time)) {
                            haptic(PlayerHaptic.Skip)
                            player.skipTime(false)
                        }
                    },
                    previous = {
                        IconAction(Lucide.SkipBack, stringResource(R.string.audiobook_previous_chapter), size = 26, enabled = index > 0) {
                            haptic(PlayerHaptic.Skip)
                            player.skipChapter(false)
                        }
                    },
                    next = {
                        IconAction(Lucide.SkipForward, stringResource(R.string.audiobook_next_chapter), size = 26,
                            enabled = index in 0 until book.chapters.lastIndex) {
                            haptic(PlayerHaptic.Skip)
                            player.skipChapter(true)
                        }
                    },
                    trailing = {
                        IconAction(Lucide.SkipTimeForward, stringResource(R.string.audiobook_forward_time)) {
                            haptic(PlayerHaptic.Skip)
                            player.skipTime(true)
                        }
                    },
                )
                Row(Modifier.fillMaxWidth().testTag("full-player-footer"), verticalAlignment = Alignment.CenterVertically) {
                    Spacer(Modifier.weight(1f))
                    Box(Modifier.semantics { selected = chapters }) {
                        IconAction(Lucide.ListVideo, stringResource(R.string.audiobook_chapters),
                            tint = if (chapters) palette.primary else palette.muted) { chapters = !chapters }
                    }
                }
            }
        },
    )
}

@Composable
private fun BookRecord(artwork: PlayerArtworkRef, playback: AudiobookPlaybackState, modifier: Modifier) {
    val motion = playerMotionEnabled()
    val extension by animateFloatAsState(if (playback.playing) 1f else 0f, tween(if (motion) 650 else 0), label = "deck-centering")
    BoxWithConstraints(modifier.testTag("player-artwork-scene"), contentAlignment = Alignment.Center) {
        val size = minOf((maxWidth - 8.dp) / (1 + RECORD_OUT), (maxHeight - 24.dp) / 1.4f, 320.dp).coerceAtLeast(1.dp)
        RecordArtwork(
            artwork, spinning = playback.playing && !playback.buffering,
            modifier = Modifier.size(size).offset(x = -size * RECORD_OUT * 0.5f * extension).testTag("player-record"),
            out = playback.playing,
            jacket = Modifier.nowPlayingCover(LocalFullPlayerVisibility.current),
        )
    }
}

@Composable
private fun BookChapterQueue(
    book: Audiobook,
    index: Int,
    playing: Boolean,
    modifier: Modifier,
    select: (String) -> Unit,
) {
    val palette = LocalPalette.current
    Column(modifier) {
        SectionHeader(stringResource(R.string.audiobook_chapters))
        LazyColumn(Modifier.fillMaxWidth().weight(1f), state = rememberLazyListState(index.coerceAtLeast(0))) {
            itemsIndexed(book.chapters, key = { _, chapter -> chapter.id }) { chapterIndex, chapter ->
                val current = chapterIndex == index
                Row(
                    Modifier.fillMaxWidth().clip(Radius.row)
                        .then(if (current) Modifier.background(palette.card) else Modifier)
                        .clickable { select(chapter.id) }.heightIn(min = 48.dp).padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (current && playing) NowPlayingBars(palette.primary)
                    else Text((chapterIndex + 1).toString(), style = Type.small, color = palette.muted)
                    Text(chapter.title, Modifier.weight(1f), style = Type.small,
                        color = if (current) palette.primary else palette.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(bookTime(chapter.durationMs), style = Type.tiny, color = palette.muted)
                }
            }
        }
    }
}
