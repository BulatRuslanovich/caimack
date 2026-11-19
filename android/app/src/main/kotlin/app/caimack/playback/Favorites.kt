// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import app.caimack.api.CaimackApi
import app.caimack.api.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class Favorites(private val api: CaimackApi, private val scope: CoroutineScope, private val signals: Signals,
    private val savedPreference: (String, String) -> Boolean? = { _, _ -> null },
    private val identity: () -> String? = { "default" }) {
    private val overrides = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    private class Pending(var confirmed: Boolean) {
        val mutex = Mutex()
        var revision = 0L
    }
    private val pending = mutableMapOf<String, Pending>()
    private val jobs = mutableSetOf<Job>()
    private var account: String? = null

    val state: StateFlow<Map<String, Boolean>> = overrides

    /** Also checked at reads: account changes cannot expose the previous user's optimistic state. */
    @Synchronized fun refreshAccount() {
        val current = identity()
        if (account == current) return
        account = current
        val previous = jobs.toList()
        jobs.clear()
        pending.clear()
        overrides.value = emptyMap()
        previous.forEach { it.cancel() }
    }

    @Synchronized fun isFavorite(track: Track): Boolean {
        refreshAccount()
        return overrides.value[track.id] ?: account?.let { savedPreference(it, track.id) } ?: track.isFavorite
    }

    @Synchronized fun toggle(track: Track) {
        refreshAccount()
        val owner = account ?: return
        val previous = isFavorite(track)
        val liked = !previous
        val change = pending.getOrPut(track.id) { Pending(previous) }
        val revision = ++change.revision
        overrides.update { it + (track.id to liked) }
        val job = scope.launch {
            change.mutex.withLock {
                // Superseded operations that have not started need not reach the server.
                if (!current(owner, track.id, change, revision)) return@withLock
                try {
                    if (liked) api.like(track.id) else api.unlike(track.id)
                    synchronized(this@Favorites) {
                        if (sameAccount(owner, track.id, change)) {
                            change.confirmed = liked
                            signals.choice(if (liked) "trackLiked" else "trackUnliked", track.id, track.durationSeconds)
                        }
                    }
                } catch (cancel: CancellationException) {
                    throw cancel
                } catch (_: Exception) {
                    synchronized(this@Favorites) {
                        if (current(owner, track.id, change, revision))
                            overrides.update { it + (track.id to change.confirmed) }
                    }
                }
            }
        }
        jobs += job
        job.invokeOnCompletion { synchronized(this) { jobs -= job } }
    }

    @Synchronized private fun sameAccount(owner: String, id: String, change: Pending): Boolean =
        identity() == owner && account == owner && pending[id] === change

    @Synchronized private fun current(owner: String, id: String, change: Pending, revision: Long): Boolean =
        sameAccount(owner, id, change) && change.revision == revision
}
