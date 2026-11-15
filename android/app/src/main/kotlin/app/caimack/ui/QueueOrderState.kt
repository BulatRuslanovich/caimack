// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.caimack.api.Track

internal data class QueueEntry(val key: Int, val track: Track)

/** Keeps occurrence identities and the dropped order through an asynchronous player update. */
internal class QueueOrderState(queue: List<Track>) {
    private var sequence = 0
    private var request = 0
    private var source = queue
    private var confirmed = reconcile(queue, emptyList())
    private var indices = confirmed.mapIndexed { index, entry -> entry.key to index }.toMap()
    var entries by mutableStateOf(confirmed)
        private set
    var pending by mutableStateOf<Int?>(null)
        private set
    var revision by mutableStateOf(0)
        private set

    private fun reconcile(queue: List<Track>, previous: List<QueueEntry>): List<QueueEntry> {
        val available = previous.groupBy { it.track.id }.mapValues { ArrayDeque(it.value) }
        return queue.map { track -> QueueEntry(available[track.id]?.removeFirstOrNull()?.key ?: sequence++, track) }
    }

    fun sync(queue: List<Track>) {
        if (queue === source) return
        val unchanged = queue.map { it.id } == source.map { it.id }
        source = queue
        confirmed = reconcile(queue, if (unchanged) confirmed else entries)
        indices = confirmed.mapIndexed { index, entry -> entry.key to index }.toMap()
        if (unchanged) {
            val tracks = confirmed.associate { it.key to it.track }
            entries = entries.map { it.copy(track = tracks[it.key] ?: it.track) }
        } else {
            entries = confirmed
            pending = null
            revision++
        }
    }

    fun sourceIndex(key: Int): Int = indices[key] ?: -1

    fun move(key: Int, target: Int) {
        if (pending != null) return
        val from = entries.indexOfFirst { it.key == key }
        val to = entries.indexOfFirst { it.key == target }
        if (from >= 0 && to >= 0 && from != to) {
            entries = entries.toMutableList().apply { add(to, removeAt(from)) }
        }
    }

    fun commit(key: Int): Pair<Int, Int>? {
        val from = sourceIndex(key)
        val to = entries.indexOfFirst { it.key == key }
        if (from < 0 || to < 0 || from == to) return null
        if (entries.map { it.track.id } == confirmed.map { it.track.id }) {
            confirmed = entries
            indices = confirmed.mapIndexed { index, entry -> entry.key to index }.toMap()
            return null
        }
        pending = ++request
        return from to to
    }

    fun cancel() {
        entries = confirmed
        pending = null
    }
}
