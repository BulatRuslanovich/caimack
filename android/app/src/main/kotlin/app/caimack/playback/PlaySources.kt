// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

object PlaySources {
    private const val MAX_TAGGED = 2000

    private data class Attribution(val source: String, val sessionId: String?)
    private val sources = LinkedHashMap<String, Attribution>()

    fun tag(trackIds: Iterable<String>, source: String?, sessionId: String? = null) {
        if (source == null) return
        synchronized(sources) {
            trackIds.forEach { id ->
                sources.remove(id)
                sources[id] = Attribution(source, sessionId)
            }
            while (sources.size > MAX_TAGGED) sources.remove(sources.keys.first())
        }
    }

    fun of(trackId: String): String? = synchronized(sources) { sources[trackId]?.source }

    fun sessionOf(trackId: String): String? = synchronized(sources) { sources[trackId]?.sessionId }

    fun radio(seeded: Boolean = false, playlist: Boolean = false): String = when {
        playlist -> "radio:playlist"
        seeded -> "radio:track"
        else -> "radio"
    }
}
