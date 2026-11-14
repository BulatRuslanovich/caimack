// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import org.junit.Assert.*
import org.junit.Test

class PlayerBackdropPaletteTest {
    private fun blocks(vararg colors: Pair<Int, Int>) = colors.flatMap { (color, count) -> List(count) { color } }.toIntArray()

    @Test fun selectsColourOverBlackAndWhite() {
        val tone = playerBackdropTone(blocks(0xff0c0c0c.toInt() to 700, 0xffebebeb.toInt() to 100, 0xffd26e28.toInt() to 200))!!
        assertTrue(tone.hue in 30.0..80.0)
    }

    @Test fun areaBeatsSmallSaturatedAccent() {
        val tone = playerBackdropTone(blocks(0xff82be96.toInt() to 600, 0xffc81eaa.toInt() to 250, 0xff0a0a0a.toInt() to 150))!!
        assertTrue(tone.hue in 130.0..180.0)
    }

    @Test fun monochromeAndMissingArtAreNeutral() {
        for (pixels in listOf(intArrayOf(), intArrayOf(0x00ff0000), blocks(0xfff5f5f5.toInt() to 500, 0xff0a0a0a.toInt() to 500), blocks(0xff807874.toInt() to 1000), blocks(0xff505050.toInt() to 990, 0xffff0000.toInt() to 10))) {
            assertNull(playerBackdropTone(pixels))
        }
        assertEquals(0xff525252.toInt(), playerBackdropSurface(null).top)
    }

    @Test fun darkColourHasNoArtificialBrightGradient() {
        val surface = playerBackdropSurface(playerBackdropTone(blocks(0xff070824.toInt() to 800, 0xfff5f5f5.toInt() to 200)))
        assertEquals(surface.top, surface.bottom)
        assertTrue((surface.top and 255) > ((surface.top shr 16) and 255))
    }

    @Test fun pixelOrderDoesNotChangePalette() {
        val pixels = blocks(0xff82be96.toInt() to 250, 0xffc81eaa.toInt() to 250, 0xff0a0a0a.toInt() to 250, 0xffdcdcdc.toInt() to 250)
        assertEquals(playerBackdropTone(pixels), playerBackdropTone(pixels.reversedArray()))
    }
}
