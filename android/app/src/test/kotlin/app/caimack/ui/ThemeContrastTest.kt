// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemeContrastTest {
    @Test
    fun `control boundaries remain visible on palette surfaces`() {
        for (dark in listOf(false, true)) {
            val fixed = Colorway.entries.map { paletteOf(it, dark) }
            val adaptive = (0 until 360 step 15).map { hue ->
                coverPalette(dark, coverPaletteSeed(PlayerBackdropTone(0.66, 0.22, hue.toDouble())))
            }
            for (palette in fixed + adaptive) {
                for (surface in listOf(palette.background, palette.card, palette.popover, palette.raised, palette.accent)) {
                    assertContrast(palette.controlBorder.compositeOver(surface), surface, 3f)
                }
            }
        }
    }

    @Test
    fun `player captions and seek rail stay visible over artwork`() {
        val surfaces = listOf(playerBackdropSurface(null)) + (0 until 360 step 15).map { hue ->
            playerBackdropSurface(PlayerBackdropTone(0.90, 0.22, hue.toDouble()))
        }
        for (surface in surfaces) {
            for (argb in listOf(surface.top, surface.bottom)) {
                val background = Color(argb)
                assertContrast(PlayerPalette.muted, background, 4.5f)
                assertContrast(PlayerPalette.controlBorder.compositeOver(background), background, 3f)
            }
        }
    }

    @Test
    fun `saved theme choices override only the system default`() {
        assertTrue(Appearance.isDark(Appearance.SYSTEM, systemDark = true))
        assertFalse(Appearance.isDark(Appearance.SYSTEM, systemDark = false))
        assertTrue(Appearance.isDark(Appearance.DARK, systemDark = false))
        assertFalse(Appearance.isDark(Appearance.LIGHT, systemDark = true))
        assertTrue(Appearance.isDark("unknown", systemDark = true))
    }

    private fun assertContrast(foreground: Color, background: Color, minimum: Float) {
        val (low, high) = listOf(foreground.luminance(), background.luminance()).sorted()
        val ratio = (high + 0.05f) / (low + 0.05f)
        assertTrue("Contrast $ratio for $foreground on $background is below $minimum", ratio >= minimum)
    }
}
