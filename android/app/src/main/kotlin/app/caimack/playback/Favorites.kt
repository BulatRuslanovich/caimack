// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import app.caimack.api.CaimackApi
import app.caimack.api.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class Favorites(private val api: CaimackApi, private val scope: CoroutineScope, private val signals: Signals) {
    private val overrides = MutableStateFlow<Map<String, Boolean>>(emptyMap())

    val state: StateFlow<Map<String, Boolean>> = overrides

    fun isFavorite(track: Track): Boolean = overrides.value[track.id] ?: track.isFavorite

    fun toggle(track: Track) {
        val liked = !isFavorite(track)
        overrides.update { it + (track.id to liked) }
        scope.launch {
            runCatching { if (liked) api.like(track.id) else api.unlike(track.id) }
                .onSuccess { signals.choice(if (liked) "trackLiked" else "trackUnliked", track.id, track.durationSeconds) }
                .onFailure { overrides.update { it + (track.id to !liked) } }
        }
    }
}
