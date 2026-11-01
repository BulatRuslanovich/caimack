// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.navigation.NavHostController
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.R
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class NavigationTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var nav: NavHostController

    private fun start() {
        compose.setContent {
            CaimackTheme(dark = true) {
                nav = rememberNavController()
                Column {
                    NavHost(nav, startDestination = HomeRoute, modifier = Modifier.weight(1f)) {
                        composable<HomeRoute> { Text("home-screen", Modifier.testTag("home")) }
                        composable<SearchRoute> {
                            var query by rememberSaveable { mutableStateOf("") }
                            BasicTextField(query, { query = it }, Modifier.testTag("query"))
                        }
                        composable<PlaylistsRoute> {
                            Column {
                                LibraryShortcuts({ nav.openSection(FavoritesRoute) }, { nav.openSection(DownloadsRoute) })
                                Text("playlists-screen", Modifier.testTag("playlists"))
                            }
                        }
                        composable<FavoritesRoute> { Text("favorites-screen", Modifier.testTag("favorites")) }
                        composable<DownloadsRoute> { Text("downloads-screen", Modifier.testTag("downloads")) }
                        composable<AlbumsRoute> { Text("albums-screen", Modifier.testTag("albums")) }
                        composable<SettingsRoute> { Text("settings-screen", Modifier.testTag("settings")) }
                        composable<AlbumRoute> { Text("album-screen", Modifier.testTag("album")) }
                    }
                    BottomBar(nav)
                }
            }
        }
    }

    private fun tapTab(label: Int) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        compose.onNodeWithText(context.getString(label)).performClick()
    }

    @Test
    fun homeButtonClosesSettingsOnTheFirstTap() {
        start()
        repeat(3) {
            compose.runOnIdle { nav.navigate(SettingsRoute) }
            compose.onNodeWithTag("settings").assertIsDisplayed()
            tapTab(R.string.nav_home)
            compose.onNodeWithTag("home").assertIsDisplayed()
            compose.runOnIdle {
                assertTrue(nav.currentDestination?.hasRoute(HomeRoute::class) == true)
                assertNull(nav.previousBackStackEntry)
            }
        }
    }

    @Test
    fun returningHomeDoesNotRestoreThePreviousDetailScreen() {
        start()
        compose.runOnIdle { nav.navigate(AlbumRoute("album")) }
        tapTab(R.string.nav_search)
        tapTab(R.string.nav_home)
        compose.onNodeWithTag("home").assertIsDisplayed()
    }

    @Test
    fun leavingSettingsPreservesSearchWithoutRestoringSettings() {
        start()
        tapTab(R.string.nav_search)
        compose.onNodeWithTag("query").performTextInput("saved search")
        compose.runOnIdle { nav.navigate(SettingsRoute) }
        tapTab(R.string.nav_library)
        compose.onNodeWithTag("playlists").assertIsDisplayed()
        tapTab(R.string.nav_search)
        compose.onNodeWithTag("query").assertTextEquals("saved search")
    }

    @Test
    fun returningToSearchAfterSettingsAndHomePreservesTheQuery() {
        start()
        tapTab(R.string.nav_search)
        compose.onNodeWithTag("query").performTextInput("saved search")
        compose.runOnIdle { nav.navigate(SettingsRoute) }
        tapTab(R.string.nav_home)
        compose.onNodeWithTag("home").assertIsDisplayed()
        tapTab(R.string.nav_search)
        compose.onNodeWithTag("query").assertTextEquals("saved search")
    }

    @Test
    fun reselectingSearchFromADetailReturnsToSearchAndKeepsItsSelection() {
        start()
        tapTab(R.string.nav_search)
        compose.runOnIdle { nav.navigate(AlbumRoute("album")) }
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        compose.onNodeWithText(context.getString(R.string.nav_search)).assertIsSelected()
        tapTab(R.string.nav_search)
        compose.onNodeWithTag("query").assertIsDisplayed()
    }

    @Test
    fun libraryShortcutsOpenFavoritesAndDownloads() {
        start()
        tapTab(R.string.nav_library)
        tapTab(R.string.nav_favorites)
        compose.onNodeWithTag("favorites").assertIsDisplayed()
        compose.runOnIdle { nav.openSection(PlaylistsRoute) }
        tapTab(R.string.downloads_title)
        compose.onNodeWithTag("downloads").assertIsDisplayed()
    }

    @Test
    fun libraryButtonRemembersTheLastLibrarySection() {
        start()
        tapTab(R.string.nav_library)
        compose.runOnIdle { nav.openSection(AlbumsRoute) }
        compose.onNodeWithTag("albums").assertIsDisplayed()
        tapTab(R.string.nav_search)
        tapTab(R.string.nav_library)
        compose.onNodeWithTag("albums").assertIsDisplayed()
        tapTab(R.string.nav_library)
        compose.onNodeWithTag("albums").assertIsDisplayed()
    }
}
