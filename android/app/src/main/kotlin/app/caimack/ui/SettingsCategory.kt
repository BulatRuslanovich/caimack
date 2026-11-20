// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import app.caimack.R

enum class SettingsCategory(val key: String, val title: Int, val hint: Int) {
    Playback("playback", R.string.settings_playback, R.string.settings_playback_intro),
    Equalizer("equalizer", R.string.settings_equalizer, R.string.settings_equalizer_intro),
    Appearance("appearance", R.string.settings_appearance, R.string.settings_appearance_intro),
    Downloads("downloads", R.string.settings_downloads, R.string.settings_downloads_intro),
    Listening("listening", R.string.listening_title, R.string.listening_intro),
    Account("account", R.string.nav_account, R.string.settings_account_intro),
    Updates("updates", R.string.settings_updates, R.string.settings_updates_intro),
    Experimental("experimental", R.string.settings_experimental, R.string.settings_experimental_intro);
    companion object { fun of(key: String) = entries.firstOrNull { it.key == key } }
}

@Composable
internal fun SettingsOverview(query: String = "") {
    val navigate = LocalNavigate.current
    val resources = LocalResources.current
    // Observe locale changes as well as the query (Resources itself can be reused).
    LocalConfiguration.current
    val recommendations = recommendationsEnabled()
    val matching = matchingSettings(query, resources).filter { recommendations || it != SettingKey.Tile }
    val categories = SettingsCategory.entries.filter { category ->
        query.isBlank() || matching.any { it.section == category.title }
    }
    Column {
        if (categories.isEmpty()) Empty(stringResource(R.string.settings_search_empty))
        categories.forEach { category ->
            val icon: ImageVector = when (category) {
                SettingsCategory.Playback -> Lucide.AudioLines
                SettingsCategory.Equalizer -> Lucide.Disc3
                SettingsCategory.Appearance -> Lucide.Settings
                SettingsCategory.Downloads -> Lucide.Download
                SettingsCategory.Listening -> Lucide.ChartLine
                SettingsCategory.Account -> Lucide.UsersRound
                SettingsCategory.Updates -> Lucide.Download
                SettingsCategory.Experimental -> Lucide.FlaskConical
            }
            LibraryEntry(stringResource(category.title), stringResource(category.hint), icon) {
                navigate(if (category == SettingsCategory.Listening) ListeningRoute() else SettingsSectionRoute(category.key))
            }
        }
    }
}
