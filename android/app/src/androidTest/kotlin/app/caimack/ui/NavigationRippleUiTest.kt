// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.math.abs

class NavigationRippleUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun pressedFeedbackStaysInsideTheFillWithFullSizeTouchTargets() {
        var density = 1f
        compose.setContent {
            density = LocalDensity.current.density
            CaimackTheme(dark = true) {
                val nav = rememberNavController()
                Column(Modifier.width(360.dp).fillMaxSize().background(LocalPalette.current.background)) {
                    Box(Modifier.weight(1f)) {
                        NavHost(nav, startDestination = LibraryRoute) {
                            composable<LibraryRoute> {}
                        }
                    }
                    BottomBar(nav)
                }
            }
        }
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // Selected and unselected controls must use the same feedback geometry.
        for (label in listOf(R.string.nav_library, R.string.nav_search)) {
            val caption = context.getString(label)
            val node = compose.onNodeWithText(caption).assertHeightIsAtLeast(48.dp)
            val target = node.fetchSemanticsNode().boundsInRoot
            val text = compose.onNodeWithText(caption, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
                .translate(-target.topLeft)
            val fill = Rect(target.width / 2 - 30 * density, text.top - 34 * density,
                target.width / 2 + 30 * density, text.top - 2 * density)
            val radius = fill.height / 2
            // Also press the extra touch area, outside the visible fill.
            for (extraTouchArea in listOf(false, true)) {
                compose.waitForIdle()
                Thread.sleep(350) // Android's ripple drawable also uses the platform clock.
                val before = node.captureToImage().toPixelMap()
                node.performTouchInput { down(if (extraTouchArea) Offset(center.x, 1f) else center) }
                compose.mainClock.advanceTimeBy(400)
                Thread.sleep(350)
                val pressed = node.captureToImage().toPixelMap()
                node.performTouchInput { cancel() }
                compose.mainClock.advanceTimeBy(600)
                var changedInside = 0
                var changedOutside = 0
                for (y in 0 until before.height) for (x in 0 until before.width) {
                    val a = before[x, y]
                    val b = pressed[x, y]
                    if (maxOf(abs(a.red - b.red), abs(a.green - b.green), abs(a.blue - b.blue)) < 0.02f) continue
                    val point = Offset(x + 0.5f, y + 0.5f)
                    val corner = Offset(point.x.coerceIn(fill.left + radius, fill.right - radius),
                        point.y.coerceIn(fill.top + radius, fill.bottom - radius))
                    if ((point - corner).getDistance() <= radius + 1.5f) changedInside++ else changedOutside++
                }
                assertTrue("$caption must show feedback, extra touch area=$extraTouchArea", changedInside > 20)
                assertEquals("$caption feedback must follow its fill, extra touch area=$extraTouchArea", 0, changedOutside)
            }
        }
    }
}
