// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.res.Resources
import app.caimack.R
import java.util.Locale

internal enum class SettingKey(val section: Int, vararg val terms: Int) {
    Quality(R.string.settings_playback, R.string.settings_quality, R.string.settings_help_quality, R.string.settings_quality_low, R.string.settings_quality_normal, R.string.settings_quality_original),
    Transitions(R.string.settings_playback, R.string.settings_smart_transitions, R.string.settings_help_smartTransitions),
    Loudness(R.string.settings_playback, R.string.settings_normalize_volume, R.string.settings_help_normalizeVolume),
    Downloads(R.string.settings_downloads, R.string.settings_auto_downloads, R.string.downloads_title),
    Reminder(R.string.nav_account, R.string.settings_recap_reminder),
    Tile(R.string.settings_playback, R.string.settings_tile),
    Equalizer(R.string.settings_equalizer, R.string.settings_equalizer, R.string.settings_help_equalizer, R.string.settings_equalizer_flat, R.string.settings_equalizer_bass, R.string.settings_equalizer_vocal, R.string.settings_equalizer_treble),
    Theme(R.string.settings_appearance, R.string.settings_theme, R.string.settings_help_theme, R.string.settings_theme_system, R.string.settings_theme_dark, R.string.settings_theme_light),
    Palette(R.string.settings_appearance, R.string.settings_colorway, R.string.settings_help_colorway, R.string.settings_colorway_coffee, R.string.settings_colorway_graphite, R.string.settings_colorway_midnight, R.string.settings_colorway_plum, R.string.settings_colorway_studio),
    Density(R.string.settings_appearance, R.string.settings_library_density, R.string.settings_density_compact, R.string.settings_density_comfortable, R.string.settings_density_spacious),
    PlayerEffects(R.string.settings_appearance, R.string.settings_player_effects, R.string.settings_help_player_effects),
    Cover(R.string.settings_appearance, R.string.settings_cover_tone, R.string.settings_help_coverTone),
    Language(R.string.settings_appearance, R.string.settings_language, R.string.settings_help_language, R.string.language_english, R.string.language_russian),
    SignOut(R.string.nav_account, R.string.sign_out),
}

internal fun matchingSettings(query: String, resources: Resources): Set<SettingKey> =
    SettingKey.entries.filterTo(mutableSetOf()) { setting ->
        settingsSearchMatches(query, listOf(resources.getString(setting.section)) + setting.terms.map(resources::getString))
    }

internal fun settingsSearchMatches(query: String, terms: List<String>): Boolean {
    fun normalized(text: String) = text.lowercase(Locale.ROOT).replace('ё', 'е').replace(Regex("[\\p{P}\\p{S}]"), "")
    val text = normalized(terms.joinToString(" "))
    return normalized(query).split(Regex("\\s+")).filter(String::isNotEmpty).all(text::contains)
}
