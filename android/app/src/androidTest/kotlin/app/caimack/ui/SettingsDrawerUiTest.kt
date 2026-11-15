// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.User
import app.caimack.session.SessionState
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

class SettingsDrawerUiTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as CaimackApp).container
    private val web = MockWebServer()
    private val user = User("drawer-test", "Визуальная проверка")
    private val originalTheme = container.appearance.theme.value
    private val originalLanguage = container.appearance.language
    private val originalFontScale = context.resources.configuration.fontScale
    private val originalLocalHttp = container.connectionPreferences.allowLocalHttp.value
    private fun label(id: Int) = context.getString(id)

    @Before fun start() = runBlocking {
        Remote.cache.clear()
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = when (request.url.encodedPath) {
                    "/api/auth/login", "/api/auth/me" -> Json.encodeToString(user)
                    "/api/config" -> "{\"recommendationsEnabled\":true}"
                    "/api/me/settings" -> "{\"quality\":\"Original\"}"
                    "/api/home/feed" -> "{\"blocks\":[]}"
                    "/api/playlists", "/api/playlists/public", "/api/genres" -> "[]"
                    else -> return MockResponse.Builder().code(204).build()
                }
                return MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()
            }
        }
        web.start()
        container.connectionPreferences.setAllowLocalHttp(true)
        check(container.session.login(web.url("/").toString(), user.username, "fixture") == null)
    }

    @After fun stop() {
        container.player.stop()
        container.appearance.setTheme(originalTheme)
        container.appearance.setLanguage(originalLanguage)
        shell("settings put system font_scale $originalFontScale")
        runBlocking { container.session.logout() }
        container.connectionPreferences.setAllowLocalHttp(originalLocalHttp)
        Remote.cache.clear()
        web.close()
    }

    private fun shell(command: String) {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }

    @Test
    fun settingsDrawerOpensFullWidthSectionsAndPreservesTheCurrentScreen() {
        container.appearance.setLanguage("ru")
        compose.activityRule.scenario.recreate()
        compose.onNode(hasText(label(R.string.nav_search)) and hasClickAction()).performClick()
        val searchWidth = compose.onNodeWithContentDescription(label(R.string.search_placeholder)).fetchSemanticsNode().boundsInRoot.width
        compose.onNodeWithContentDescription(label(R.string.search_placeholder)).performTextInput("ab")
        compose.onNodeWithContentDescription(label(R.string.search_placeholder)).performImeAction()
        compose.onNode(hasText("В") and hasClickAction()).performClick()
        compose.onNodeWithText(label(R.string.sign_out)).assertIsDisplayed()
        val panelSearch = compose.onNodeWithContentDescription(label(R.string.settings_search)).fetchSemanticsNode().boundsInRoot
        assertTrue("The menu must leave a strip of the app visible on the left", panelSearch.left > 40)
        assertTrue("The menu is narrower than the full screen", panelSearch.width < searchWidth)
        compose.onNodeWithText(label(R.string.settings_playback)).performClick()
        compose.onNodeWithText(label(R.string.settings_quality)).assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.settings_close)).assertDoesNotExist()
        assertEquals("Submenus use the entire screen", searchWidth,
            compose.onNodeWithContentDescription(label(R.string.settings_search)).fetchSemanticsNode().boundsInRoot.width, 1f)
        compose.onNodeWithContentDescription(label(R.string.nav_back)).performClick()
        compose.onNodeWithContentDescription(label(R.string.search_placeholder)).assertTextContains("ab")

        compose.onNode(hasText("В") and hasClickAction()).performClick()
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithContentDescription(label(R.string.settings_close)).assertDoesNotExist()
        compose.onNodeWithContentDescription(label(R.string.search_placeholder)).assertTextContains("ab")
    }

    @Test
    fun settingsDrawerClosesWithOutsideTapAndRightSwipe() {
        container.appearance.setLanguage("ru")
        compose.activityRule.scenario.recreate()
        compose.onNode(hasText("В") and hasClickAction()).performClick()
        compose.onNodeWithText(label(R.string.sign_out)).assertIsDisplayed()
        compose.onRoot().performTouchInput { click(Offset(width * 0.04f, height * 0.5f)) }
        compose.onNodeWithContentDescription(label(R.string.settings_close)).assertDoesNotExist()
        compose.onNode(hasText("В") and hasClickAction()).performClick()
        compose.onRoot().performTouchInput { swipe(Offset(width * 0.2f, height * 0.5f), Offset(width * 0.95f, height * 0.5f), 300) }
        compose.onNodeWithContentDescription(label(R.string.settings_close)).assertDoesNotExist()
        compose.onNodeWithText(label(R.string.nav_home)).assertIsDisplayed()
    }

    @Test
    fun settingsDrawerSupportsLargeTextAndSigningOut() {
        container.appearance.setLanguage("ru")
        shell("settings put system font_scale 1.3")
        compose.activityRule.scenario.recreate()
        compose.onNode(hasText("В") and hasClickAction()).performClick()
        compose.onNodeWithText(label(R.string.settings_playback)).assertIsDisplayed()
        compose.onNodeWithText(label(R.string.sign_out)).assertIsDisplayed()
        compose.waitForIdle()
        val bitmap = checkNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        java.io.File(context.cacheDir, "settings-drawer-large-text.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        compose.onNodeWithText(label(R.string.sign_out)).performClick()
        compose.waitUntil(5_000) { container.session.state.value is SessionState.SignedOut }
        assertTrue("Signing out must stop playback", container.player.state.value.current == null)
    }

    @Test
    fun settingsDrawerSearchSurvivesRecreationAndLogoutStaysVisible() {
        container.appearance.setLanguage("ru")
        container.appearance.setTheme(Appearance.DARK)
        compose.activityRule.scenario.recreate()
        compose.onNode(hasText("В") and hasClickAction()).performClick()
        fun save(name: String) {
            compose.waitForIdle()
            val bitmap = checkNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
            java.io.File(context.cacheDir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
        compose.onNodeWithText(label(R.string.sign_out)).assertIsDisplayed()
        save("settings-drawer-dark")
        container.appearance.setTheme(Appearance.LIGHT)
        compose.onNodeWithText(label(R.string.sign_out)).assertIsDisplayed()
        save("settings-drawer-light")
        compose.onNodeWithContentDescription(label(R.string.settings_search)).performTextInput("тёмная")
        compose.onNodeWithText(label(R.string.settings_playback)).assertDoesNotExist()
        compose.onNodeWithText(label(R.string.settings_appearance)).assertIsDisplayed()
        compose.activityRule.scenario.recreate()
        compose.onNodeWithContentDescription(label(R.string.settings_search)).assertTextContains("тёмная")
        compose.onNodeWithText(label(R.string.sign_out)).assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.search_clear)).performClick()
        compose.onNodeWithText(label(R.string.settings_playback)).assertIsDisplayed()
    }

}
