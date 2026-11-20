// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.res.Resources
import app.caimack.R
import java.util.Locale

internal enum class SettingKey(val section: Int, vararg val terms: Int) {
    Listening(R.string.listening_title, R.string.listening_intro, R.string.listening_minutes, R.string.listening_artists, R.string.listening_songs),
    LocalHttp(R.string.nav_account, R.string.settings_connection, R.string.settings_local_http),
    Quality(R.string.settings_playback, R.string.settings_quality, R.string.settings_help_quality, R.string.settings_quality_low, R.string.settings_quality_normal, R.string.settings_quality_original),
    Transitions(R.string.settings_playback, R.string.settings_smart_transitions, R.string.settings_help_smartTransitions),
    Loudness(R.string.settings_playback, R.string.settings_normalize_volume, R.string.settings_help_normalizeVolume),
    Downloads(R.string.settings_downloads, R.string.settings_auto_downloads, R.string.downloads_title),
    Reminder(R.string.nav_account, R.string.settings_recap_reminder),
    Tile(R.string.settings_playback, R.string.settings_tile),
    TouchHaptics(R.string.settings_playback, R.string.settings_touch_haptics, R.string.settings_touch_haptics_hint),
    MusicHaptics(R.string.settings_playback, R.string.settings_music_haptics, R.string.settings_music_haptics_hint),
    Equalizer(R.string.settings_equalizer, R.string.settings_equalizer, R.string.settings_help_equalizer, R.string.settings_equalizer_flat, R.string.settings_equalizer_bass, R.string.settings_equalizer_vocal, R.string.settings_equalizer_treble),
    Theme(R.string.settings_appearance, R.string.settings_theme, R.string.settings_help_theme, R.string.settings_theme_system, R.string.settings_theme_dark, R.string.settings_theme_light),
    Palette(R.string.settings_appearance, R.string.settings_colorway, R.string.settings_help_colorway, R.string.settings_colorway_coffee, R.string.settings_colorway_graphite, R.string.settings_colorway_midnight, R.string.settings_colorway_plum, R.string.settings_colorway_studio, R.string.settings_colorway_cover),
    Density(R.string.settings_appearance, R.string.settings_library_density, R.string.settings_density_compact, R.string.settings_density_comfortable, R.string.settings_density_spacious),
    PlayerEffects(R.string.settings_appearance, R.string.settings_player_effects, R.string.settings_help_player_effects),
    Cover(R.string.settings_appearance, R.string.settings_cover_tone, R.string.settings_help_coverTone),
    Language(R.string.settings_appearance, R.string.settings_language, R.string.settings_help_language, R.string.language_english, R.string.language_russian),
    SignOut(R.string.nav_account, R.string.sign_out),
    Updates(R.string.settings_updates, R.string.settings_updates_intro, R.string.update_check, R.string.update_installed),
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
