// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import androidx.media3.common.Player
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class PlayerModesUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun fullPlayerControlsDoNotChangeWithTheLibraryTheme() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        var colorway by mutableStateOf(Colorway.Coffee)
        var dark by mutableStateOf(true)
        val state = PlayerState(queue = listOf(Track("theme-review", "Theme review", "artist", "Caimack", durationSeconds = 180)),
            shuffle = true, repeat = Player.REPEAT_MODE_ONE)
        compose.setContent {
            CaimackTheme(dark = dark, colorway = colorway) {
                CompositionLocalProvider(LocalContainer provides container) { FullPlayer(state) {} }
            }
        }
        var reference: Bitmap? = null
        for (theme in Colorway.entries) for (night in listOf(true, false)) {
            compose.runOnIdle { colorway = theme; dark = night }
            compose.onNodeWithContentDescription(context.getString(R.string.player_shuffle)).assertIsSelected()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, context.getString(R.string.player_shuffle_on)))
            compose.onNodeWithContentDescription(context.getString(R.string.player_repeat)).assertIsSelected()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, context.getString(R.string.player_repeat_one)))
            val controls = compose.onNodeWithTag("full-player-transport").captureToImage().asAndroidBitmap()
            reference?.let { assertTrue("Fullscreen controls must be independent of $theme/$night", it.sameAs(controls)) }
                ?: run { reference = controls }
            if (theme == Colorway.Coffee && night || theme == Colorway.Studio && !night) {
                File(context.cacheDir, "theme-full-player-${theme.key}-$night.png").outputStream().use {
                    compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
                }
            }
        }
    }

    @Test fun modesRemainVisibleAndAccessibleAcrossPalettesAndCoverColours() {
        var colorway by mutableStateOf(Colorway.Coffee)
        var dark by mutableStateOf(true)
        var shuffled by mutableStateOf(false)
        var repeat by mutableIntStateOf(0)
        var clicks = 0
        compose.setContent {
            CaimackTheme(dark = dark, colorway = colorway) {
                Column(Modifier.width(360.dp).background(LocalPalette.current.background).padding(16.dp)) {
                    Text("${colorway.key} / $dark", color = LocalPalette.current.foreground, style = Type.section)
                    // The bar uses application tokens, while the full player uses its own palette.
                    Row {
                        PlayerModeButton(Lucide.Shuffle, "Shuffle", shuffled, if (shuffled) "On" else "Off") { shuffled = !shuffled }
                        PlayerModeButton(if (repeat == 1) Lucide.Repeat1 else Lucide.Repeat, "Repeat", repeat != 0,
                            listOf("Off", "One track", "Queue")[repeat]) { repeat = (repeat + 1) % 3 }
                        PlayerModeButton(Lucide.Shuffle, "Unavailable", true, "On", enabled = false) { clicks++ }
                    }
                    CompositionLocalProvider(LocalPalette provides PlayerPalette) {
                        listOf(null, PlayerBackdropTone(0.1, 0.1, 260.0), PlayerBackdropTone(0.95, 0.2, 50.0),
                            PlayerBackdropTone(0.7, 0.3, 0.0), PlayerBackdropTone(0.6, 0.3, 140.0), PlayerBackdropTone(0.5, 0.3, 260.0))
                            .forEach { tone ->
                                Row(Modifier.fillMaxWidth().background(Color(playerBackdropSurface(tone).top)).padding(8.dp),
                                    horizontalArrangement = Arrangement.SpaceEvenly) {
                                    PlayerModeButton(Lucide.Shuffle, "Off sample", false, "Off") {}
                                    PlayerModeButton(Lucide.Shuffle, "On sample", true, "On") {}
                                    PlayerModeButton(Lucide.Repeat, "Queue sample", true, "Queue") {}
                                    PlayerModeButton(Lucide.Repeat1, "One sample", true, "One track") {}
                                }
                            }
                    }
                }
            }
        }
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for (theme in Colorway.entries) for (night in listOf(true, false)) {
            compose.runOnIdle { colorway = theme; dark = night }
            compose.onNodeWithContentDescription("Shuffle").assertIsNotSelected().assertHeightIsAtLeast(48.dp)
                .performClick().assertIsSelected()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "On"))
            compose.onNodeWithContentDescription("Repeat").performClick().assertIsSelected()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "One track"))
            val file = File(context.cacheDir, "theme-modes-${theme.key}-$night.png")
            file.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
            if (theme == Colorway.Graphite && night) {
                val shuffle = compose.onNodeWithContentDescription("Shuffle")
                shuffle.performTouchInput { down(center) }
                compose.mainClock.advanceTimeBy(150)
                File(context.cacheDir, "theme-modes-oled-pressed.png").outputStream().use {
                    compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
                }
                shuffle.performTouchInput { up() }
                shuffle.assertIsNotSelected().performClick().assertIsSelected()
            }
            compose.onNodeWithContentDescription("Repeat").performClick().assertIsSelected()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Queue"))
            compose.onNodeWithContentDescription("Repeat").performClick().assertIsNotSelected()
            compose.onNodeWithContentDescription("Shuffle").performClick().assertIsNotSelected()
            compose.onNodeWithContentDescription("Unavailable").assertIsNotEnabled().performClick()
            compose.runOnIdle { assertEquals(0, clicks) }
        }
    }
}
