// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.graphics.Bitmap
import android.content.res.Configuration
import android.os.LocaleList
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.R
import java.io.File
import org.junit.Rule
import org.junit.Test

class LibraryNavigationUiTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var nav: NavHostController

    @Test fun themesKeepScopeAndScrollableCategoriesUsable() {
        val baseContext = InstrumentationRegistry.getInstrumentation().targetContext
        val configuration = Configuration(baseContext.resources.configuration).apply {
            setLocales(LocaleList.forLanguageTags("ru"))
        }
        val context = baseContext.createConfigurationContext(configuration)
        var colorway by mutableStateOf(Colorway.Coffee)
        var dark by mutableStateOf(true)
        var fontScale by mutableFloatStateOf(1f)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(
                LocalDensity provides Density(density.density, fontScale),
                LocalContext provides context,
                LocalConfiguration provides configuration,
            ) {
                CaimackTheme(dark = dark, colorway = colorway) {
                    nav = rememberNavController()
                    // A narrow phone viewport makes overflow and scrolling observable.
                    Box(Modifier.width(320.dp).background(LocalPalette.current.background)) {
                        NavHost(nav, startDestination = TracksRoute) {
                            composable<LibraryRoute> { LibraryScopeSelector(nav, saved = true) }
                            composable<TracksRoute> { LibraryCatalogFrame(nav, TracksRoute) {} }
                            composable<AlbumsRoute> { LibraryCatalogFrame(nav, AlbumsRoute) {} }
                            composable<ArtistsRoute> { LibraryCatalogFrame(nav, ArtistsRoute) {} }
                            composable<PlaylistsRoute> { LibraryCatalogFrame(nav, PlaylistsRoute) {} }
                            composable<GenresRoute> { LibraryCatalogFrame(nav, GenresRoute) {} }
                        }
                    }
                }
            }
        }
        fun node(label: Int) = compose.onNodeWithText(context.getString(label))
        fun scrollTo(label: Int): SemanticsNodeInteraction {
            compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(context.getString(label)))
            return node(label)
        }
        fun snapshot(name: String) {
            val file = File(context.cacheDir, "library-navigation-$name.png")
            file.outputStream().use {
                compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        for (theme in Colorway.entries) for (night in listOf(true, false)) {
            compose.runOnIdle { colorway = theme; dark = night }
            node(R.string.collection_catalog).assertIsSelected().assertHeightIsAtLeast(48.dp)
            scrollTo(R.string.nav_tracks).assertIsSelected().assertHeightIsAtLeast(48.dp)
            snapshot("${theme.key}-$night")
            scrollTo(R.string.nav_genres).assertIsDisplayed().performClick()
            scrollTo(R.string.nav_genres).assertIsSelected()
            node(R.string.collection_saved).performClick().assertIsSelected()
            node(R.string.collection_catalog).performClick().assertIsSelected()
            scrollTo(R.string.nav_tracks).assertIsSelected()
        }
        compose.runOnIdle { fontScale = 1.5f }
        node(R.string.collection_saved).assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        scrollTo(R.string.nav_playlists).performClick()
        scrollTo(R.string.nav_playlists).assertIsSelected().assertHeightIsAtLeast(48.dp)
        snapshot("large-text")
        node(R.string.collection_saved).performClick().assertIsSelected()
        // Returning to the catalog retains the established Tracks entry behavior.
        node(R.string.collection_catalog).performClick()
        scrollTo(R.string.nav_tracks).assertIsSelected()
        scrollTo(R.string.nav_albums).performClick().assertIsSelected()
        compose.runOnIdle { nav.popBackStack() }
        scrollTo(R.string.nav_tracks).assertIsSelected()
    }
}
