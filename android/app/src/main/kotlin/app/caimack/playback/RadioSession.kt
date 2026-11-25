// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

import android.content.Context
import androidx.core.content.edit
import app.caimack.api.ConnectRadio
import app.caimack.api.RadioBatch
import app.caimack.api.RecommendationReason
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import java.util.concurrent.atomic.AtomicLong

data class RadioNote(val reason: RecommendationReason, val explore: Boolean)

data class RadioState(
    val seedTrackId: String? = null,
    val notes: Map<String, RadioNote> = emptyMap(),
    val generation: Long = 0,
    val active: Boolean = false,
    val focus: String? = null,
    val playlistId: String? = null,
    val sessionId: String? = null,
) {
    fun connectRadio() = ConnectRadio(seedTrackId, focus, notes.mapValues { it.value.reason }, playlistId, sessionId)
}

class RadioSession(context: Context) {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    private val current = MutableStateFlow(RadioState())
    private val continuing = MutableStateFlow(preferences.getBoolean(AUTOPLAY, true))
    private val generation = AtomicLong()

    val state: StateFlow<RadioState> = current

    val autoplay: StateFlow<Boolean> = continuing

    fun start(seedTrackId: String?, batch: RadioBatch, playlistId: String? = null, sessionId: String? = null) {
        val recommended = batch.tracks.map { it.track.id }.filter { it != seedTrackId }
        PlaySources.tag(
            if (playlistId == null) recommended else listOfNotNull(seedTrackId) + recommended,
            PlaySources.radio(seeded = seedTrackId != null, playlist = playlistId != null),
            sessionId,
        )
        current.value = RadioState(
            seedTrackId, notesOf(batch), generation.incrementAndGet(), active = true, playlistId = playlistId, sessionId = sessionId,
        )
    }

    fun extend(batch: RadioBatch) {
        val state = current.value
        PlaySources.tag(
            batch.tracks.map { it.track.id },
            if (state.active) PlaySources.radio(playlist = state.playlistId != null) else "radio:autoplay",
            state.sessionId,
        )
        current.update { it.copy(notes = it.notes + notesOf(batch)) }
    }

    fun reset() {
        current.value = RadioState(generation = generation.incrementAndGet())
    }

    fun restore(state: RadioState) {
        current.value = state.copy(generation = generation.incrementAndGet())
    }

    fun setAutoplay(enabled: Boolean) {
        preferences.edit { putBoolean(AUTOPLAY, enabled) }
        continuing.value = enabled
    }

    private fun notesOf(batch: RadioBatch) = batch.tracks.mapNotNull { recommended ->
        recommended.reason?.let { recommended.track.id to RadioNote(it, recommended.signals?.explore == true) }
    }.toMap()

    private companion object {
        const val FILE = "radio"
        const val AUTOPLAY = "autoplay"
    }
}
