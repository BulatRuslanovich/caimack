// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CoverToneTest {
    private fun argb(r: Int, g: Int, b: Int, a: Int = 255) = (a shl 24) or (r shl 16) or (g shl 8) or b

    private fun image(first: Int, second: Int = first, share: Double = 1.0): IntArray {
        val size = TONE_SAMPLE_EDGE * TONE_SAMPLE_EDGE
        val split = Math.round(size * share).toInt()
        return IntArray(size) { if (it < split) first else second }
    }

    @Test
    fun `takes the hue and chroma of a flat colour`() {
        assertEquals(CoverTone(79.8, 0.13), coverTone(image(argb(217, 164, 65))))
        assertEquals(CoverTone(263.1, 0.18), coverTone(image(argb(40, 90, 200))))
    }

    @Test
    fun `lets the dominant colour win`() =
        assertEquals(CoverTone(24.9, 0.177), coverTone(image(argb(200, 60, 60), argb(60, 160, 90), 0.7)))

    @Test
    fun `ignores near-black around a small colourful patch`() =
        assertEquals(CoverTone(3.9, 0.139), coverTone(image(argb(230, 120, 150), argb(10, 10, 10), 0.3)))

    @Test
    fun `calls black-and-white covers neutral`() {
        assertNull(coverTone(image(argb(240, 240, 240), argb(20, 20, 20), 0.5)))
        assertNull(coverTone(image(argb(128, 120, 116))))
    }

    @Test
    fun `skips transparent pixels`() {
        assertNull(coverTone(image(argb(0, 0, 0, 0))))
        assertEquals(CoverTone(263.1, 0.18), coverTone(image(argb(40, 90, 200), argb(255, 0, 0, 0), 0.5)))
    }
}
