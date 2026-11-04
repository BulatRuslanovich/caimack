// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SettingsSearchUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun searchingFiltersSettingsAndClearingRestoresThem() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container) { SettingsScreen() }
            }
        }
        compose.onNodeWithContentDescription(context.getString(R.string.settings_search))
            .performTextInput(context.getString(R.string.settings_theme))
        compose.onNode(hasText(context.getString(R.string.settings_theme)) and !hasSetTextAction()).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.settings_quality)).assertDoesNotExist()
        compose.onNodeWithContentDescription(context.getString(R.string.search_clear)).performClick()
        compose.onNodeWithText(context.getString(R.string.settings_quality)).assertIsDisplayed()
    }

    @Test
    fun searchingForAnUnknownSettingShowsAnEmptyState() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container) { SettingsScreen() }
            }
        }
        compose.onNodeWithContentDescription(context.getString(R.string.settings_search)).performTextInput("xyzxyz")
        compose.onNodeWithText(context.getString(R.string.settings_search_empty)).assertIsDisplayed()
    }

    @Test
    fun localizedSearchFindsOptionsAndWifi() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for (language in listOf("ru", "en")) {
            val configuration = Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)) }
            val resources = context.createConfigurationContext(configuration).resources
            assertEquals(setOf(SettingKey.Downloads), matchingSettings("wifi", resources))
            assertEquals(setOf(SettingKey.Theme), matchingSettings(if (language == "ru") "темная" else "dark", resources))
        }
    }
}
