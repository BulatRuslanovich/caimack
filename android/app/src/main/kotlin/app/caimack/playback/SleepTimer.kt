// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

import android.os.SystemClock
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

sealed interface SleepTimerState {
    data class Minutes(val minutes: Int, val endsAtMs: Long) : SleepTimerState {
        val remainingMs: Long get() = (endsAtMs - SystemClock.elapsedRealtime()).coerceAtLeast(0)

        internal suspend fun fade(setLevel: (Float) -> Unit) {
            delay((remainingMs - SleepTimer.FADE_MS).coerceAtLeast(0))
            while (true) {
                val remaining = remainingMs
                if (remaining == 0L) return
                setLevel(remaining.toFloat() / SleepTimer.FADE_MS)
                delay(minOf(remaining, 200L))
            }
        }
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
