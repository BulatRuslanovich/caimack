// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

object PlaySources {
    private const val MAX_TAGGED = 2000

    private val sources = LinkedHashMap<String, String>()

    fun tag(trackIds: Iterable<String>, source: String?) {
        if (source == null) return
        synchronized(sources) {
            trackIds.forEach { id ->
                sources.remove(id)
                sources[id] = source
            }
            while (sources.size > MAX_TAGGED) sources.remove(sources.keys.first())
        }
    }

    fun of(trackId: String): String? = synchronized(sources) { sources[trackId] }

    fun radio(mood: String?, seeded: Boolean = false): String = when {
        mood != null -> "radio:mood:$mood"
        seeded -> "radio:track"
        else -> "radio"
    }
}
