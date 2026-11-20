// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class NavigationTransitionUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun routeChangesKeepScreensOpaqueAndReverseDirectionOnReturn() {
        lateinit var nav: NavHostController
        compose.setContent {
            nav = rememberNavController()
            AppNavHost(nav, Modifier.fillMaxSize().testTag("route-viewport")) {
                composable<HomeRoute> { Box(Modifier.fillMaxSize().background(Color.Red)) }
                composable<PlaylistRoute> { Box(Modifier.fillMaxSize().background(Color.Green)) }
                composable<LibraryRoute> { Box(Modifier.fillMaxSize().background(Color.Green)) }
            }
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        val viewport = compose.onNodeWithTag("route-viewport")
        fun checkTransition(action: () -> Unit) {
            compose.runOnIdle(action)
            var sawBothScreens = false
            repeat(12) {
                compose.mainClock.advanceTimeByFrame()
                val image = viewport.captureToImage().toPixelMap()
                val row = (1..19).map { x -> image[image.width * x / 20, image.height / 2] }
                val red = row.count { it.red > 0.95f && it.green < 0.05f && it.blue < 0.05f }
                val green = row.count { it.green > 0.95f && it.red < 0.05f && it.blue < 0.05f }
                assertTrue("Screen colors blended during navigation", red + green == row.size)
                if (red > 0 && green > 0) {
                    assertTrue("Home should be on the left of the destination", row.first().red > 0.95f)
                    assertTrue("The destination should be on the right of Home", row.last().green > 0.95f)
                    sawBothScreens = true
                }
            }
            assertTrue("Expected to sample a frame with both screens in view", sawBothScreens)
            compose.mainClock.advanceTimeBy(300)
        }
        checkTransition { nav.navigate(PlaylistRoute("playlist")) }
        checkTransition { nav.popBackStack() }
        checkTransition { nav.openSection(LibraryRoute) }
        checkTransition { nav.openSection(HomeRoute) }
    }
}
