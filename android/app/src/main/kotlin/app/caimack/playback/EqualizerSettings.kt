// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class EqualizerState(val enabled: Boolean, val gains: List<Int>) {
    val preset: String? get() = PRESETS.entries.firstOrNull { it.value == gains }?.key

    companion object {
        val BANDS_HZ = listOf(60, 230, 910, 3600, 14000)
        const val LIMIT_DB = 12

        val PRESETS = linkedMapOf(
            "flat" to listOf(0, 0, 0, 0, 0),
            "bass" to listOf(6, 4, 0, 0, 0),
            "vocal" to listOf(-2, 0, 3, 3, 0),
            "treble" to listOf(0, 0, 0, 3, 6),
        )
    }
}

class EqualizerSettings(context: Context) {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    private val current = MutableStateFlow(
        EqualizerState(
            enabled = preferences.getBoolean(ENABLED, false),
            gains = preferences.getString(GAINS, null)?.split(',')?.mapNotNull { it.toIntOrNull() }
                ?.takeIf { it.size == EqualizerState.BANDS_HZ.size }
                ?: EqualizerState.PRESETS.getValue("flat"),
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

    private fun save(next: EqualizerState) {
        preferences.edit {
            putBoolean(ENABLED, next.enabled)
            putString(GAINS, next.gains.joinToString(","))
        }
        current.value = next
    }

    private companion object {
        const val FILE = "equalizer"
        const val ENABLED = "enabled"
        const val GAINS = "gains"
    }
}
