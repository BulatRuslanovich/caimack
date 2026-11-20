// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.audiobooks

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class AudiobookPlaybackState(
    val bookId: String,
    val chapterId: String,
    val positionMs: Long,
    val durationMs: Long,
    val playing: Boolean,
    val buffering: Boolean,
    val failed: Boolean,
)

internal class AudiobookPlayback(
    private val context: Context,
    private val scope: CoroutineScope,
    private val store: AudiobookStore,
    private val account: () -> AudiobookAccount?,
    private val stopMusic: () -> Unit,
) {
    private var connection: ListenableFuture<MediaController>? = null
    private var start: Job? = null
    private val current = MutableStateFlow<AudiobookPlaybackState?>(null)
    val state = current.asStateFlow()
    val openFromNotification = MutableStateFlow(false)

    fun toggle(book: Audiobook) {
        val active = state.value
        if (active?.bookId == book.id && (active.playing || active.buffering)) controller()?.pause()
        else play(book)
    }

    fun play(book: Audiobook, chapterId: String? = null) {
        val owner = account() ?: return
        val active = state.value
        start?.cancel()
        start = scope.launch(Dispatchers.Main) {
            try {
                val player = connect()
                if (active != null && active.bookId != book.id) player.pause()
                if (chapterId == null && store.state.value.online) store.refreshForPlayback(owner, book.id)
                if (account() != owner) return@launch
                val selected = store.state.value.books.firstOrNull { it.id == book.id } ?: book
                val saved = selected.progress?.takeUnless { it.completed || chapterId != null }
                val index = selected.chapters.indexOfFirst { it.id == (chapterId ?: saved?.chapterId) }.coerceAtLeast(0)
                if (selected.chapters.isEmpty()) return@launch
                val position = saved?.takeIf { it.chapterId == selected.chapters[index].id }?.positionMs ?: 0L
                val items = selected.chapters.map { chapter -> mediaItem(owner, selected, chapter) }
                stopMusic()
                player.setMediaItems(items, index, position)
                player.prepare()
                player.play()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                android.util.Log.w("Caimack", "Could not start audiobook playback", error)
            }
        }
    }

    fun seek(positionMs: Long) { controller()?.seekTo(positionMs) }
    fun skipChapter(next: Boolean) {
        val player = controller() ?: return
        if (next) player.seekToNextMediaItem() else player.seekToPreviousMediaItem()
    }

    fun pauseForMusic() {
        start?.cancel()
        val player = controller() ?: return
        if (player.mediaItemCount != 0) {
            player.pause()
            player.clearMediaItems()
        }
    }

    fun publish(playback: AudiobookPlaybackState?) { current.value = playback }

    fun mediaItem(account: AudiobookAccount, book: Audiobook, chapter: AudiobookChapter): MediaItem =
        MediaItem.Builder().setMediaId(chapter.id).setUri(store.audio(account, book, chapter))
            .setMediaMetadata(MediaMetadata.Builder().setTitle(chapter.title).setAlbumTitle(book.title)
                .setArtist(book.author).setArtworkUri(store.cover(book)?.toUri())
                .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER)
                .setExtras(Bundle().apply { putString(BOOK_ID, book.id) }).build())
            .build()

    private fun controller(): MediaController? =
        connection?.takeIf { it.isDone }?.let { runCatching { it.get() }.getOrNull() }

    private suspend fun connect(): MediaController = suspendCancellableCoroutine { continuation ->
        val pending = connection?.takeUnless { it.isCancelled || (it.isDone && controller() == null) }
            ?: MediaController.Builder(context, SessionToken(context, ComponentName(context, AudiobookService::class.java)))
                .setListener(object : MediaController.Listener {
                    override fun onDisconnected(controller: MediaController) { connection = null }
                })
                .buildAsync().also { connection = it }
        pending.addListener({
            if (continuation.isActive) {
                val result = runCatching { pending.get() }
                result.onSuccess { continuation.resume(it) }.onFailure { continuation.resumeWithException(it) }
            }
        }, ContextCompat.getMainExecutor(context))
    }

    companion object {
        const val BOOK_ID = "app.caimack.audiobook.id"
        const val OPEN = "app.caimack.audiobook.open"
    }
}
