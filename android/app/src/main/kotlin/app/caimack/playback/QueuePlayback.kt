// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ShuffleOrder.DefaultShuffleOrder
import kotlin.random.Random

private const val PRESERVE_QUEUE = "app.caimack.PRESERVE_QUEUE"

/** Restores and transfers already contain the chosen playback order and history. */
internal fun preserveQueue(items: List<MediaItem>): List<MediaItem> = items.mapIndexed { index, item ->
    if (index != 0) item else item.buildUpon().setRequestMetadata(
        item.requestMetadata.buildUpon().setExtras(Bundle(item.requestMetadata.extras ?: Bundle.EMPTY).apply {
            putBoolean(PRESERVE_QUEUE, true)
        }).build(),
    ).build()
}

internal fun orderedQueue(items: List<MediaItem>, index: Int, order: List<Int>?): Pair<List<MediaItem>, Int> {
    val valid = order?.takeIf { it.sorted() == items.indices.toList() }
    return preserveQueue(valid?.map(items::get) ?: items) to (valid?.indexOf(index) ?: index)
}

/** The visible playlist is the playback order, including while shuffle is enabled. */
@OptIn(UnstableApi::class)
internal class QueuePlayback(private val player: ExoPlayer, private val random: Random = Random.Default) : Player.Listener {
    private var windows = windowIds()
    private var original = windows
    private var editing = false

    init { player.addListener(this) }

    override fun onTimelineChanged(timeline: Timeline, reason: Int) {
        if (editing) return
        val next = windowIds()
        val previous = windows.toSet()
        val replaced = next.isNotEmpty() && next.none(previous::contains)
        windows = next
        if (replaced) {
            original = next
            val preserved = player.getMediaItemAt(0).requestMetadata.extras?.getBoolean(PRESERVE_QUEUE) == true
            if (!preserved) {
                val current = player.currentMediaItemIndex.coerceIn(next.indices)
                val tail = (current + 1 until next.size).toList() + (0 until current).toList()
                reorder(listOf(current) + if (player.shuffleModeEnabled) tail.shuffled(random) else tail)
            }
        } else if (!player.shuffleModeEnabled) {
            original = next
        } else {
            val surviving = next.toSet()
            original = original.filter(surviving::contains) + next.filterNot(original.toSet()::contains)
        }
        useVisibleOrder()
    }

    override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
        if (editing) return
        val ids = windowIds()
        if (ids.isEmpty()) return
        val current = player.currentMediaItemIndex.coerceIn(ids.indices)
        val order = if (shuffleModeEnabled) {
            original = ids
            // Start a new shuffled queue from every occurrence, including the
            // old history. The playing source stays first and keeps its position.
            listOf(current) + ids.indices.filter { it != current }.shuffled(random)
        } else {
            val rank = original.withIndex().associate { it.value to it.index }
            val start = rank[ids[current]] ?: 0
            val upcoming = (current + 1 until ids.size).sortedBy {
                ((rank[ids[it]] ?: original.size) - start - 1 + original.size) % original.size
            }
            (0..current).toList() + upcoming
        }
        reorder(order)
    }

    fun jumpTo(index: Int) {
        if (index !in 0 until player.mediaItemCount) return
        val current = player.currentMediaItemIndex
        val destination = when {
            index == current -> index
            current < 0 -> 0
            index > current -> current + 1
            else -> current
        }
        // Only the previous current entry becomes history. Entries between it
        // and the chosen song remain upcoming, in their existing order.
        if (index != destination) player.moveMediaItem(index, destination)
        player.seekTo(destination, 0)
        player.play()
    }

    private fun windowIds(): List<Any> {
        val window = Timeline.Window()
        return (0 until player.currentTimeline.windowCount).map { player.currentTimeline.getWindow(it, window).uid }
    }

    private fun reorder(order: List<Int>) {
        if (order == order.indices.toList()) {
            useVisibleOrder()
            return
        }
        val before = windowIds()
        val items = order.map(player::getMediaItemAt)
        val current = player.currentMediaItemIndex
        val target = order.indexOf(current)
        editing = true
        try {
            if (current != target) player.moveMediaItem(current, target)
            // Keep the current source/buffer alive. Replacing only the upcoming
            // tail also avoids hundreds of individual moves for large queues.
            player.removeMediaItems(target + 1, player.mediaItemCount)
            player.addMediaItems(items.drop(target + 1))
            val after = windowIds()
            val relocated = order.withIndex().associate { (position, source) -> before[source] to after[position] }
            original = original.mapNotNull(relocated::get)
            useVisibleOrder()
        } finally {
            windows = windowIds()
            editing = false
        }
    }

    private fun useVisibleOrder() {
        if (!player.shuffleModeEnabled) return
        val timeline = player.currentTimeline
        var next = timeline.getFirstWindowIndex(true)
        var expected = 0
        while (next == expected && expected < player.mediaItemCount) {
            expected++
            next = timeline.getNextWindowIndex(next, Player.REPEAT_MODE_OFF, true)
        }
        if (expected != player.mediaItemCount) {
            player.setShuffleOrder(DefaultShuffleOrder(IntArray(player.mediaItemCount) { it }, 0L))
        }
    }
}
