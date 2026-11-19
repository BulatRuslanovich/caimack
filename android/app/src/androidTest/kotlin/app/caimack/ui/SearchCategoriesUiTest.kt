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
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.R
import java.io.File
import org.junit.Rule
import org.junit.Test

class SearchCategoriesUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun themesKeepSearchFiltersScrollableAndClearable() {
        val baseContext = InstrumentationRegistry.getInstrumentation().targetContext
        val configuration = Configuration(baseContext.resources.configuration).apply {
            setLocales(LocaleList.forLanguageTags("ru"))
        }
        val context = baseContext.createConfigurationContext(configuration)
        var colorway by mutableStateOf(Colorway.Coffee)
        var dark by mutableStateOf(true)
        var fontScale by mutableFloatStateOf(1f)
        var category by mutableStateOf<SearchCategory?>(null)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(
                LocalDensity provides Density(density.density, fontScale),
                LocalContext provides context,
                LocalConfiguration provides configuration,
            ) {
                CaimackTheme(dark = dark, colorway = colorway) {
                    // A narrow phone viewport makes overflow and scrolling observable.
                    Box(Modifier.width(320.dp).background(LocalPalette.current.background)) {
                        SearchCategoryFilters(category) { category = it }
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
            val file = File(context.cacheDir, "search-categories-$name.png")
            file.outputStream().use {
                compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        for (theme in Colorway.entries) for (night in listOf(true, false)) {
            compose.runOnIdle { colorway = theme; dark = night }
            scrollTo(R.string.nav_tracks).assertIsNotSelected().assertTouchHeightIsEqualTo(48.dp)
            snapshot("${theme.key}-$night")
            scrollTo(R.string.nav_genres).assertIsDisplayed().performClick()
            node(R.string.nav_genres).assertIsSelected()
            node(R.string.nav_tracks).assertDoesNotExist()
            compose.onNodeWithContentDescription(context.getString(R.string.collection_clear_filter)).performClick()
            scrollTo(R.string.nav_tracks).assertIsNotSelected()
        }
        compose.runOnIdle { fontScale = 1.5f }
        scrollTo(R.string.nav_playlists).performClick()
        node(R.string.nav_playlists).assertIsSelected().assertTouchHeightIsEqualTo(48.dp)
        snapshot("large-text")
        node(R.string.nav_playlists).performClick()
        scrollTo(R.string.nav_playlists).assertIsNotSelected()
    }
}
