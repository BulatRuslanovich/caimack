// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

internal fun matchesCollection(collection: List<String>, queue: List<String>, current: String?, automatic: Set<String> = emptySet()): Boolean {
    val members = collection.toSet()
    val queued = queue.filter { it in members || it !in automatic }
    if (current == null || collection.isEmpty() || collection.size != queued.size || current !in collection) return false
    val counts = collection.groupingBy { it }.eachCount().toMutableMap()
    for (id in queued) {
        val count = counts[id] ?: return false
        if (count == 0) return false
        counts[id] = count - 1
    }
    return true
}
