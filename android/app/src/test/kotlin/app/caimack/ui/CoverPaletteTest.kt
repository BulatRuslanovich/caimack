// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CoverPaletteTest {
    @Test
    fun `cover is a saved colourway with a coffee fallback`() {
        assertEquals(Colorway.Cover, Colorway.of("cover"))
        for (dark in listOf(true, false)) {
            assertEquals(paletteOf(Colorway.Coffee, dark), paletteOf(Colorway.Cover, dark))
        }
    }

    @Test
    fun `cover hue changes cards and controls while keeping the coffee background`() {
        val red = coverPaletteSeed(PlayerBackdropTone(0.6, 0.22, 25.0))
        val blue = coverPaletteSeed(PlayerBackdropTone(0.6, 0.22, 260.0))
        for (dark in listOf(true, false)) {
            val warm = coverPalette(dark, red)
            val cool = coverPalette(dark, blue)
            val coffee = paletteOf(Colorway.Coffee, dark)
            assertEquals(coffee.background, warm.background)
            assertEquals(coffee.background, cool.background)
            assertNotEquals(warm.card, cool.card)
            assertNotEquals(warm.primary, cool.primary)
            assertNotEquals(warm.action, cool.action)
        }
    }

    @Test
    fun `surfaces and controls retain text contrast across cover hues`() {
        for (dark in listOf(true, false)) {
            for (hue in 0 until 360 step 5) {
                for (chroma in listOf(0.02, 0.09, 0.22)) {
                    val palette = coverPalette(dark, coverPaletteSeed(PlayerBackdropTone(0.6, chroma, hue.toDouble())))
                    for (surface in listOf(palette.background, palette.card, palette.popover, palette.raised, palette.accent)) {
                        for (text in listOf(palette.foreground, palette.muted, palette.faint)) {
                            assertContrast(text, surface)
                        }
                    }
                    assertContrast(palette.onPrimary, palette.primary)
                    assertContrast(palette.primary, palette.selection)
                    assertContrast(palette.onAction, palette.action)
                }
            }
        }
    }

    private fun assertContrast(first: Color, second: Color) {
        val (low, high) = listOf(first.luminance(), second.luminance()).sorted()
        val contrast = (high + 0.05f) / (low + 0.05f)
        assertTrue("Contrast for $first on $second is $contrast", contrast >= 4.5f)
    }
}
