// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TrackSheetGestureUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun upwardFlingKeepsTheOpenSheetInPlaceAndDownwardSwipeDismissesIt() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val track = Track("sheet-gesture", "Track", "artist", "Artist", durationSeconds = 180)
        var open by mutableStateOf(true)
        compose.setContent {
            CaimackTheme {
                CompositionLocalProvider(LocalContainer provides container) {
                    if (open) TrackSheet(track) { open = false }
                }
            }
        }

        val sheet = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.PaneTitle))
        compose.waitForIdle()
        val restingTop = sheet.fetchSemanticsNode().positionInRoot.y
        val handleY = with(compose.density) { 24.dp.toPx() }
        compose.mainClock.autoAdvance = false
        try {
            for (fromHandle in listOf(false, true)) {
                sheet.performTouchInput {
                    val startY = if (fromHandle) handleY else height * 0.65f
                    val endY = if (fromHandle) 1f else height * 0.25f
                    swipe(Offset(center.x, startY), Offset(center.x, endY), 80)
                }
                repeat(16) {
                    compose.mainClock.advanceTimeByFrame()
                    val gestureTarget = if (fromHandle) "handle" else "list"
                    assertEquals(
                        "Sheet moved after an upward swipe on the $gestureTarget",
                        restingTop,
                        sheet.fetchSemanticsNode().positionInRoot.y,
                        1f,
                    )
                }
            }
        } finally {
            compose.mainClock.autoAdvance = true
        }

        sheet.performTouchInput {
            swipe(Offset(center.x, handleY), Offset(center.x, height * 0.7f), 200)
        }
        sheet.assertDoesNotExist()
    }
}
