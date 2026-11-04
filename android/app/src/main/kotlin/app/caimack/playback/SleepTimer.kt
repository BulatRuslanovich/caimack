// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.os.SystemClock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

sealed interface SleepTimerState {
    data class Minutes(val minutes: Int, val endsAtMs: Long) : SleepTimerState {
        val remainingMs: Long get() = (endsAtMs - SystemClock.elapsedRealtime()).coerceAtLeast(0)
    }

    data object TrackEnd : SleepTimerState
}

class SleepTimer {
    private val current = MutableStateFlow<SleepTimerState?>(null)

    val state: StateFlow<SleepTimerState?> = current

    fun set(minutes: Int) {
        current.value = SleepTimerState.Minutes(minutes, SystemClock.elapsedRealtime() + minutes * 60_000L)
    }

    fun untilTrackEnd() {
        current.value = SleepTimerState.TrackEnd
    }

    fun cancel() {
        current.value = null
    }

    companion object {
        val MINUTES = listOf(15, 30, 45, 60, 90)

        const val FADE_MS = 15_000L
    }
}
