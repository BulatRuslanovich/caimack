// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.haptics

import android.content.Context
import android.os.VibratorManager
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class HapticsPreferences(context: Context) {
    private val preferences = context.getSharedPreferences("haptics", Context.MODE_PRIVATE)
    val tactileAvailable = runCatching { context.getSystemService(VibratorManager::class.java).defaultVibrator.hasVibrator() }.getOrDefault(false)
    val musicAvailable = tactileAvailable && AndroidAudioHapticFactory.available
    private val touch = MutableStateFlow(preferences.getBoolean("touch", true))
    private val music = MutableStateFlow(musicAvailable && preferences.getBoolean("music", false))
    private val status = MutableStateFlow(if (musicAvailable) MusicHapticsStatus.Off else MusicHapticsStatus.Unsupported)
    val touchEnabled = touch.asStateFlow()
    val musicEnabled = music.asStateFlow()
    val musicStatus = status.asStateFlow()

    fun setTouchEnabled(enabled: Boolean) {
        preferences.edit { putBoolean("touch", enabled) }
        touch.value = enabled
    }

    fun setMusicEnabled(enabled: Boolean) {
        val next = enabled && musicAvailable
        preferences.edit { putBoolean("music", next) }
        music.value = next
    }

    internal fun reportMusicStatus(value: MusicHapticsStatus) { status.value = value }
}
