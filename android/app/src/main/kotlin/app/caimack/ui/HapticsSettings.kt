// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.haptics.MusicHapticsStatus
import app.caimack.haptics.PlayerHaptic

@Composable
internal fun HapticsSettings(touch: Boolean, music: Boolean) {
    val preferences = LocalContainer.current.haptics
    val touchEnabled by preferences.touchEnabled.collectAsState()
    val musicEnabled by preferences.musicEnabled.collectAsState()
    val status by preferences.musicStatus.collectAsState()
    val feedback = rememberPlayerHaptics()
    if (touch) {
        val label = stringResource(R.string.settings_touch_haptics)
        Column {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                SettingLabel(label,
                    stringResource(if (preferences.tactileAvailable) R.string.settings_touch_haptics_hint else R.string.settings_touch_haptics_unavailable),
                    modifier = Modifier.weight(1f).padding(end = 12.dp))
                Toggle(modifier = Modifier.semantics { contentDescription = label }, checked = touchEnabled && preferences.tactileAvailable, enabled = preferences.tactileAvailable,
                    onCheckedChange = preferences::setTouchEnabled)
            }
            if (preferences.tactileAvailable) TextButton(onClick = { feedback(PlayerHaptic.Confirm) }, enabled = touchEnabled) {
                Text(stringResource(R.string.settings_haptics_preview))
            }
        }
    }
    if (music) {
        val label = stringResource(R.string.settings_music_haptics)
        val hint = when {
            !preferences.musicAvailable -> R.string.settings_music_haptics_unavailable
            status == MusicHapticsStatus.Failed -> R.string.settings_music_haptics_failed
            musicEnabled && status == MusicHapticsStatus.Active -> R.string.settings_music_haptics_active
            musicEnabled -> R.string.settings_music_haptics_ready
            else -> R.string.settings_music_haptics_hint
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SettingLabel(label, stringResource(hint),
                modifier = Modifier.weight(1f).padding(end = 12.dp))
            Toggle(modifier = Modifier.semantics { contentDescription = label }, checked = musicEnabled, enabled = preferences.musicAvailable, onCheckedChange = preferences::setMusicEnabled)
        }
    }
}
