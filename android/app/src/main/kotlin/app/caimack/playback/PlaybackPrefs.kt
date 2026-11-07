// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class PlaybackPrefs(private val context: Context) {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    private val smart = MutableStateFlow(preferences.getBoolean(SMART_TRANSITIONS, true))

    val smartTransitions: StateFlow<Boolean> = smart

    fun setSmartTransitions(enabled: Boolean) {
        preferences.edit { putBoolean(SMART_TRANSITIONS, enabled) }
        smart.value = enabled
    }

    private val normalize = MutableStateFlow(preferences.getBoolean(NORMALIZE_VOLUME, false))

    val normalizeVolume: StateFlow<Boolean> = normalize

    fun setNormalizeVolume(enabled: Boolean) {
        preferences.edit { putBoolean(NORMALIZE_VOLUME, enabled) }
        normalize.value = enabled
    }

    private val autoDownload = MutableStateFlow(preferences.getBoolean(AUTO_DOWNLOAD, false))

    val autoDownloads: StateFlow<Boolean> = autoDownload

    fun setAutoDownloads(enabled: Boolean) {
        preferences.edit { putBoolean(AUTO_DOWNLOAD, enabled) }
        autoDownload.value = enabled
        Background.schedule(context)
    }

    private val reminder = MutableStateFlow(preferences.getBoolean(RECAP_REMINDER, false))

    val recapReminder: StateFlow<Boolean> = reminder

    fun setRecapReminder(enabled: Boolean) {
        preferences.edit { putBoolean(RECAP_REMINDER, enabled) }
        reminder.value = enabled
        Background.schedule(context)
    }

    var autoDownloaded: Set<String>
        get() = preferences.getStringSet(AUTO_DOWNLOADED, emptySet()).orEmpty()
        set(value) = preferences.edit { putStringSet(AUTO_DOWNLOADED, value) }

    var recapNotifiedMonth: String?
        get() = preferences.getString(RECAP_NOTIFIED, null)
        set(value) = preferences.edit { putString(RECAP_NOTIFIED, value) }

    private companion object {
        const val FILE = "playback"
        const val SMART_TRANSITIONS = "smart_transitions"
        const val NORMALIZE_VOLUME = "normalize_volume"
        const val AUTO_DOWNLOAD = "auto_download"
        const val AUTO_DOWNLOADED = "auto_downloaded"
        const val RECAP_REMINDER = "recap_reminder"
        const val RECAP_NOTIFIED = "recap_notified"
    }
}
