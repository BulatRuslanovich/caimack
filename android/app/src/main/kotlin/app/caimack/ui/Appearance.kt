// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.Context
import android.content.res.Configuration
import androidx.core.content.edit
import app.caimack.widget.NowPlayingWidget
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class Appearance(private val context: Context) {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    private val chosenTheme = MutableStateFlow(preferences.getString(THEME, SYSTEM) ?: SYSTEM)

    val theme: StateFlow<String> = chosenTheme

    private val chosenColorway = MutableStateFlow(Colorway.of(preferences.getString(COLORWAY, null)))

    val colorway: StateFlow<Colorway> = chosenColorway

    private val chosenCoverTone = MutableStateFlow(preferences.getBoolean(COVER_TONE, true))

    val coverTone: StateFlow<Boolean> = chosenCoverTone

    private val chosenLibraryDensity = MutableStateFlow(LibraryDensity.of(preferences.getString(LIBRARY_DENSITY, null)))
    val libraryDensity: StateFlow<LibraryDensity> = chosenLibraryDensity

    fun setLibraryDensity(value: LibraryDensity) {
        preferences.edit { putString(LIBRARY_DENSITY, value.key) }
        chosenLibraryDensity.value = value
    }

    val language: String get() = preferences.getString(LANGUAGE, "").orEmpty()

    fun palette(): Palette = paletteOf(colorway.value, when (theme.value) {
        DARK -> true
        LIGHT -> false
        else -> context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    })

    fun setTheme(value: String) {
        preferences.edit { putString(THEME, value) }
        chosenTheme.value = value
        NowPlayingWidget.refresh(context)
    }

    fun setColorway(value: Colorway) {
        preferences.edit { putString(COLORWAY, value.key) }
        chosenColorway.value = value
        NowPlayingWidget.refresh(context)
    }

    fun setCoverTone(value: Boolean) {
        preferences.edit { putBoolean(COVER_TONE, value) }
        chosenCoverTone.value = value
        NowPlayingWidget.refresh(context)
    }

    fun setLanguage(value: String) = preferences.edit(commit = true) { putString(LANGUAGE, value) }

    companion object {
        const val SYSTEM = "system"
        const val DARK = "dark"
        const val LIGHT = "light"

        private const val FILE = "appearance"
        private const val THEME = "theme"
        private const val COLORWAY = "colorway"
        private const val LANGUAGE = "language"
        private const val COVER_TONE = "cover_tone"
        private const val LIBRARY_DENSITY = "library_density"

        fun localized(base: Context): Context {
            val language = base.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(LANGUAGE, "").orEmpty()
            if (language.isEmpty()) return base
            val configuration = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)) }
            return base.createConfigurationContext(configuration)
        }
    }
}
