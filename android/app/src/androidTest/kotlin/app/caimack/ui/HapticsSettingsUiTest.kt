// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.Manifest
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.haptics.HapticsPreferences
import java.io.File
import java.util.Locale
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class HapticsSettingsUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun preferencesPersistAndUnsupportedMusicFeedbackCannotBeEnabled() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val container = (context.applicationContext as CaimackApp).container
        val preferences = container.haptics
        val originalTouch = preferences.touchEnabled.value
        val originalMusic = preferences.musicEnabled.value
        val configuration = Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag("ru")); fontScale = 1.2f }
        val localized = context.createConfigurationContext(configuration)
        preferences.setTouchEnabled(true)
        preferences.setMusicEnabled(false)
        compose.setContent {
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides configuration, LocalContainer provides container) {
                CaimackTheme {
                    Surface(Modifier.fillMaxSize(), color = LocalPalette.current.background) {
                        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) { HapticsSettings(touch = true, music = true) }
                    }
                }
            }
        }
        try {
            assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.VIBRATE))
            assertFalse(preferences.musicEnabled.value)
            val touch = compose.onNodeWithContentDescription(localized.getString(R.string.settings_touch_haptics))
            val music = compose.onNodeWithContentDescription(localized.getString(R.string.settings_music_haptics))
            if (preferences.tactileAvailable) {
                touch.assertIsOn().performClick()
                assertFalse(preferences.touchEnabled.value)
                assertFalse(HapticsPreferences(context).touchEnabled.value)
                compose.onNodeWithText(localized.getString(R.string.settings_haptics_preview)).assertIsNotEnabled()
                touch.performClick()
                compose.onNodeWithText(localized.getString(R.string.settings_haptics_preview)).performClick()
            } else touch.assertIsNotEnabled()
            if (preferences.musicAvailable) {
                music.assertIsOff().performClick()
                assertTrue(preferences.musicEnabled.value)
                assertTrue(HapticsPreferences(context).musicEnabled.value)
                music.performClick()
            } else {
                music.assertIsOff().assertIsNotEnabled()
                preferences.setMusicEnabled(true)
                assertFalse(preferences.musicEnabled.value)
                compose.onNodeWithText(localized.getString(R.string.settings_music_haptics_unavailable)).assertIsDisplayed()
            }
            compose.waitForIdle()
            File(context.cacheDir, "haptics-settings.png").outputStream().use {
                instrumentation.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            File(context.cacheDir, "haptics-capabilities.json").writeText("{\"touch\":${preferences.tactileAvailable},\"audio\":${preferences.musicAvailable}}")
        } finally { preferences.setTouchEnabled(originalTouch); preferences.setMusicEnabled(originalMusic) }
    }
}
