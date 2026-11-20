// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.audiobooks

import app.caimack.api.ConnectCommand
import androidx.media3.common.Player
import kotlinx.coroutines.delay
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
import java.io.IOException
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
    private val stopMusic: suspend () -> Unit,
    private val routeBook: (ConnectCommand.PlayAudiobook) -> Boolean,
) {
    private var connection: ListenableFuture<MediaController>? = null
    private var start: Job? = null
    private var checkpointWrite: Job? = null
    private var selection = 0L
    private val current = MutableStateFlow<AudiobookPlaybackState?>(null)
    private var remote: AudiobookPlaybackState? = null
    var localState: AudiobookPlaybackState? = null
        private set
    val sessionId get() = selection
    val state = current.asStateFlow()

    fun showRemote(book: app.caimack.api.ConnectBook?) {
        val duration = book?.let { selected -> store.state.value.books.firstOrNull { it.id == selected.bookId }
            ?.chapters?.firstOrNull { it.id == selected.chapterId }?.durationMs } ?: 0
        remote = book?.let { AudiobookPlaybackState(it.bookId, it.chapterId, it.positionMs, duration, it.playing, false, false) }
        current.value = localState ?: remote
    }

    private fun route(active: AudiobookPlaybackState, chapter: String = active.chapterId, position: Long = active.positionMs, playing: Boolean = active.playing, keepPosition: Boolean = false): Boolean =
        localState == null && routeBook(ConnectCommand.PlayAudiobook(active.bookId, chapter, position, playing, keepPosition))
    val openFromNotification = MutableStateFlow(false)

    fun toggle(book: Audiobook) {
        val active = state.value
        if (active?.bookId == book.id && route(active, playing = !active.playing, keepPosition = true)) return
        if (active?.bookId == book.id && (active.playing || active.buffering)) controller()?.pause()
        else play(book)
    }

    fun play(book: Audiobook, chapterId: String? = null) {
        val visible = remote
        if (visible != null && localState == null) {
            val target = chapterId ?: book.progress?.takeUnless { it.completed }?.chapterId ?: book.chapters.firstOrNull()?.id ?: return
            val position = if (chapterId == null) book.progress?.takeUnless { it.completed }?.positionMs ?: 0L else 0L
            if (routeBook(ConnectCommand.PlayAudiobook(book.id, target, position, true))) return
        }
        val owner = account() ?: return
        start?.cancel()
        start = scope.launch(Dispatchers.Main) {
            try {
                val player = connect()
                if (player.playWhenReady) player.pause()
                checkpointWrite?.join()
                if (chapterId == null) store.refreshForPlayback(owner, book.id)
                checkpointWrite?.join()
                if (account() != owner) return@launch
                val selected = store.state.value.books.firstOrNull { it.id == book.id } ?: book
                val saved = selected.progress?.takeUnless { it.completed || chapterId != null }
                val index = selected.chapters.indexOfFirst { it.id == (chapterId ?: saved?.chapterId) }.coerceAtLeast(0)
                if (selected.chapters.isEmpty()) return@launch
                val position = saved?.takeIf { it.chapterId == selected.chapters[index].id }?.positionMs ?: 0L
                load(player, owner, selected, index, position, playing = true)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                android.util.Log.w("Caimack", "Could not start audiobook playback", error)
            }
        }
    }

    private suspend fun load(player: MediaController, owner: AudiobookAccount, selected: Audiobook, index: Int, position: Long, playing: Boolean) {
        val extras = Bundle().apply {
            putString(BOOK_ID, selected.id)
            putLong(SELECTION, ++selection)
            putLong(RESUME_VERSION, selected.progress?.updatedAtMs ?: 0)
        }
        val items = selected.chapters.map { chapter -> mediaItem(owner, selected, chapter, extras) }
        stopMusic()
        check(account() == owner)
        player.setMediaItems(items, index, position)
        player.prepare()
        player.playWhenReady = playing
    }

    suspend fun receiveHandoff(command: ConnectCommand.PlayAudiobook) {
        val owner = checkNotNull(account())
        start?.cancel()
        val player = connect()
        if (command.keepPosition) {
            val item = player.currentMediaItem
            check(item?.mediaId == command.chapterId && item.mediaMetadata.extras?.getString(BOOK_ID) == command.bookId)
            if (command.playing) player.play() else player.pause()
            return
        }
        store.refreshForPlayback(owner, command.bookId)
        val book = store.state.value.books.first { it.id == command.bookId }
        val index = book.chapters.indexOfFirst { it.id == command.chapterId }
        require(index >= 0 && command.positionMs >= 0)
        val position = command.positionMs.coerceAtMost(book.chapters[index].durationMs)
        load(player, owner, book, index, position, command.playing)
        val request = selection
        try {
            while (player.playbackState != Player.STATE_READY || (command.playing && !player.isPlaying)) {
                check(request == selection && account() == owner && player.playerError == null)
                delay(40)
            }
        } catch (error: Exception) {
            if (request == selection) pauseForMusic()
            throw error
        }
    }

    suspend fun transfer(send: suspend (ConnectCommand.PlayAudiobook) -> Unit) {
        val player = checkNotNull(controller())
        val item = checkNotNull(player.currentMediaItem)
        val book = checkNotNull(item.mediaMetadata.extras?.getString(BOOK_ID))
        val request = selection
        val playing = player.playWhenReady
        player.pause()
        try {
            send(ConnectCommand.PlayAudiobook(book, item.mediaId, player.currentPosition.coerceAtLeast(0), playing))
        } catch (error: Exception) {
            if (playing && request == selection && player.currentMediaItem == item) player.play()
            throw error
        }
        if (request == selection && player.currentMediaItem == item) player.clearMediaItems()
    }

    fun recordProgress(owner: AudiobookAccount, bookId: String, value: AudiobookProgress, basedOn: Long) {
        val before = checkpointWrite
        checkpointWrite = scope.launch {
            before?.join()
            try { store.checkpoint(owner, bookId, value, basedOn) }
            catch (error: IOException) { android.util.Log.w("Caimack", "Could not save audiobook progress", error) }
        }
    }

    fun seek(positionMs: Long) {
        if (remote?.let { route(it, position = positionMs) } != true) controller()?.seekTo(positionMs)
    }
    fun skipTime(forward: Boolean) {
        remote?.takeIf { localState == null }?.let { seek((it.positionMs + if (forward) 15_000 else -15_000).coerceIn(0, it.durationMs)); return }
        val player = controller() ?: return
        if (forward) player.seekForward() else player.seekBack()
    }

    fun skipChapter(next: Boolean) {
        remote?.takeIf { localState == null }?.let { active ->
            val chapters = store.state.value.books.firstOrNull { it.id == active.bookId }?.chapters ?: return
            val index = chapters.indexOfFirst { it.id == active.chapterId }
            chapters.getOrNull(index + if (next) 1 else -1)?.let { route(active, chapter = it.id, position = 0) }
            return
        }
        val player = controller() ?: return
        if (next) player.seekToNextMediaItem() else player.seekToPreviousMediaItem()
    }

    fun prepareMusicHandoff(): () -> Unit {
        val audiobookRequest = start
        return { if (audiobookRequest === start) pauseForMusic() }
    }

    fun pauseForMusic() {
        start?.cancel()
        val player = controller() ?: return
        if (player.mediaItemCount != 0) {
            player.pause()
            player.clearMediaItems()
        }
    }

    fun publish(playback: AudiobookPlaybackState?) {
        localState = playback
        current.value = playback ?: remote
    }

    fun mediaItem(account: AudiobookAccount, book: Audiobook, chapter: AudiobookChapter, extras: Bundle): MediaItem =
        MediaItem.Builder().setMediaId(chapter.id).setUri(store.audio(account, book, chapter))
            .setMediaMetadata(MediaMetadata.Builder().setTitle(chapter.title).setAlbumTitle(book.title)
                .setArtist(book.author).setArtworkUri(store.cover(book)?.toUri())
                .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER)
                .setExtras(extras).build())
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
        const val SELECTION = "app.caimack.audiobook.selection"
        const val RESUME_VERSION = "app.caimack.audiobook.resumeVersion"
        const val OPEN = "app.caimack.audiobook.open"
    }
}
