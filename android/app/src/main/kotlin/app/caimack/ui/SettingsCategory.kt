// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.vector.ImageVector
import app.caimack.R

enum class SettingsCategory(val key: String, val title: Int, val hint: Int) {
    Playback("playback", R.string.settings_playback, R.string.settings_playback_intro),
    Equalizer("equalizer", R.string.settings_equalizer, R.string.settings_equalizer_intro),
    Appearance("appearance", R.string.settings_appearance, R.string.settings_appearance_intro),
    Downloads("downloads", R.string.settings_downloads, R.string.settings_downloads_intro),
    Account("account", R.string.nav_account, R.string.settings_account_intro),
    Updates("updates", R.string.settings_updates, R.string.settings_updates_intro);
    companion object { fun of(key: String) = entries.firstOrNull { it.key == key } }
}

@Composable
internal fun SettingsOverview() {
    val navigate = LocalNavigate.current
    Column {
        SettingsCategory.entries.forEach { category ->
            val icon: ImageVector = when (category) {
                SettingsCategory.Playback -> Lucide.AudioLines
                SettingsCategory.Equalizer -> Lucide.Disc3
                SettingsCategory.Appearance -> Lucide.Settings
                SettingsCategory.Downloads -> Lucide.Download
                SettingsCategory.Account -> Lucide.UsersRound
                SettingsCategory.Updates -> Lucide.Download
            }
            LibraryEntry(stringResource(category.title), stringResource(category.hint), icon) {
                navigate(SettingsSectionRoute(category.key))
            }
        }
    }
}
