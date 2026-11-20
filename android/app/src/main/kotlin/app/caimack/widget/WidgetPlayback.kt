// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.widget

import android.content.Context
import android.os.PowerManager
import app.caimack.AppContainer
import app.caimack.api.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

private data class BookWidgetContent(val id: String, val chapter: String, val playing: Boolean, val cover: String?, val downloaded: Boolean)
private data class WidgetContent(val track: Track?, val playing: Boolean, val liked: Boolean, val durationMs: Long)
private data class WidgetPlayback(val content: WidgetContent, val positionMs: Long, val remote: Boolean)

/** Observe the same selected output as the app, independently of the local audio renderer. */
internal fun observeWidgetPlayback(context: Context, container: AppContainer) = container.scope.launch(Dispatchers.Main) {
    val app = context.applicationContext
    val power = app.getSystemService(PowerManager::class.java)
    launch {
        var last: BookWidgetContent? = null
        combine(container.audiobooksEnabled, container.audiobookPlayback.state, container.audiobookStore.state) { enabled, state, catalog ->
            val book = state?.takeIf { enabled }?.let { active -> catalog.books.find { it.id == active.bookId } }
            val content = if (book != null)
                BookWidgetContent(book.id, state.chapterId, state.playing, book.coverUrl, book.id in catalog.downloaded)
            else null
            content to state
        }.collect { (content, state) ->
            if (content != last) {
                NowPlayingWidget.refresh(app)
                last = content
            } else if (content != null && state != null && power.isInteractive) {
                NowPlayingWidget.progress(app, state.positionMs, state.durationMs, audiobook = true)
            }
        }
    }
    var previous: WidgetContent? = null
    combine(container.player.state, container.connect.state, container.favorites.state) { player, connect, _ ->
        val remote = connect.selectedId != null
        // Selection and track lookup can complete in different emissions. Never publish the
        // old local track as the selected device's track while its snapshot is loading.
        if (remote && (connect.playback == null ||
                connect.playback.deviceId != connect.selectedId ||
                connect.playback.trackIds.getOrNull(connect.playback.index) != player.current?.id)) return@combine null
        val track = player.current
        WidgetPlayback(
            WidgetContent(track, player.playing && (!remote || connect.available),
                track?.let(container.favorites::isFavorite) ?: false, player.durationMs),
            container.player.position, remote,
        )
    }.distinctUntilChanged().collect { snapshot ->
        if (snapshot == null) return@collect
        val content = snapshot.content
        if (content != previous) {
            NowPlayingWidget.show(app, content.track, content.playing, snapshot.positionMs, content.durationMs)
            previous = content
        } else if (snapshot.remote && power.isInteractive) {
            // Remote reports carry progress too. Keep these lightweight, just like local ticks.
            NowPlayingWidget.progress(app, snapshot.positionMs, content.durationMs)
        }
    }
}
