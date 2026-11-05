// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.ln
import kotlin.math.roundToInt

data class EqualizerState(
    val enabled: Boolean,
    val gains: List<Int>,
    val preampDb: Int = 0,
    val autoHeadroom: Boolean = true,
) {
    val preset: String? get() = PRESETS.entries.firstOrNull { it.value == gains }?.key
    val effectivePreampDb: Int get() = when {
        !enabled -> 0
        autoHeadroom -> minOf(preampDb, -maxOf(0, gains.maxOrNull() ?: 0))
        else -> preampDb
    }

    companion object {
        val BANDS_HZ = listOf(31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)
        const val LIMIT_DB = 12

        val PRESETS = linkedMapOf(
            "flat" to listOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
            "bass" to listOf(6, 5, 4, 2, 0, 0, 0, 0, 0, 0),
            "vocal" to listOf(-3, -2, -1, 0, 2, 3, 4, 3, 1, 0),
            "treble" to listOf(0, 0, 0, 0, 0, 0, 1, 3, 5, 6),
            "rock" to listOf(4, 3, 2, 0, -2, -1, 1, 3, 4, 3),
            "electronic" to listOf(5, 4, 2, 0, -2, 0, 2, 3, 4, 4),
            "acoustic" to listOf(2, 2, 1, 1, 2, 2, 3, 2, 1, 1),
            "warm" to listOf(3, 3, 2, 1, 0, 0, -1, -2, -3, -3),
        )

        fun restoreGains(saved: List<Int>?): List<Int> {
            val old = saved?.map { it.coerceIn(-LIMIT_DB, LIMIT_DB) } ?: return PRESETS.getValue("flat")
            if (old.size == BANDS_HZ.size) return old
            if (old.size != 5) return PRESETS.getValue("flat")
            val frequencies = listOf(60, 230, 910, 3600, 14000)
            return BANDS_HZ.map { hz ->
                val upper = frequencies.indexOfFirst { it >= hz }
                when {
                    upper == 0 -> old.first()
                    upper < 0 -> old.last()
                    else -> {
                        val fraction = ln(hz.toDouble() / frequencies[upper - 1]) / ln(frequencies[upper].toDouble() / frequencies[upper - 1])
                        (old[upper - 1] + fraction * (old[upper] - old[upper - 1])).roundToInt()
                    }
                }
            }
        }
    }
}

class EqualizerSettings(context: Context) {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    private val current = MutableStateFlow(
        EqualizerState(
            enabled = preferences.getBoolean(ENABLED, false),
            gains = EqualizerState.restoreGains(preferences.getString(GAINS, null)?.split(',')?.map { it.toIntOrNull() ?: 0 }),
            preampDb = preferences.getInt(PREAMP, 0).coerceIn(-EqualizerState.LIMIT_DB, EqualizerState.LIMIT_DB),
            autoHeadroom = preferences.getBoolean(HEADROOM, true),
        ),
    )

    val state: StateFlow<EqualizerState> = current

    fun setEnabled(enabled: Boolean) = save(current.value.copy(enabled = enabled))

    fun setGain(band: Int, gain: Int) = save(
        current.value.copy(
            gains = current.value.gains.mapIndexed { index, value ->
                if (index == band) gain.coerceIn(-EqualizerState.LIMIT_DB, EqualizerState.LIMIT_DB) else value
            },
        ),
    )

    fun applyPreset(name: String) = save(current.value.copy(gains = EqualizerState.PRESETS.getValue(name)))

    fun setPreamp(gain: Int) = save(current.value.copy(preampDb = gain.coerceIn(-EqualizerState.LIMIT_DB, EqualizerState.LIMIT_DB)))

    fun setAutoHeadroom(enabled: Boolean) = save(current.value.copy(autoHeadroom = enabled))

    fun reset() = save(EqualizerState(current.value.enabled, EqualizerState.PRESETS.getValue("flat")))

    private fun save(next: EqualizerState) {
        preferences.edit {
            putBoolean(ENABLED, next.enabled)
            putString(GAINS, next.gains.joinToString(","))
            putInt(PREAMP, next.preampDb)
            putBoolean(HEADROOM, next.autoHeadroom)
        }
        current.value = next
    }

    private companion object {
        const val FILE = "equalizer"
        const val ENABLED = "enabled"
        const val GAINS = "gains"
        const val PREAMP = "preamp"
        const val HEADROOM = "auto_headroom"
    }
}
