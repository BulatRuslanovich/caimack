// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class EqualizerStateTest {
    @Test fun `legacy gains follow logarithmic frequencies without losing endpoints`() {
        assertEquals(listOf(6, 6, 5, 4, 2, 0, -2, -3, -5, -6), EqualizerState.restoreGains(listOf(6, 4, 0, -3, -6)))
    }

    @Test fun `invalid settings are flat and saved gains are bounded`() {
        assertEquals(EqualizerState.PRESETS.getValue("flat"), EqualizerState.restoreGains(listOf(3)))
        assertEquals(listOf(12, -12) + List(8) { 0 }, EqualizerState.restoreGains(listOf(99, -99) + List(8) { 0 }))
    }

    @Test fun `headroom respects manual attenuation and bypass`() {
        val state = EqualizerState(true, EqualizerState.PRESETS.getValue("bass"), preampDb = 3)
        assertEquals(-6, state.effectivePreampDb)
        assertEquals(-9, state.copy(preampDb = -9).effectivePreampDb)
        assertEquals(3, state.copy(autoHeadroom = false).effectivePreampDb)
        assertEquals(0, state.copy(enabled = false).effectivePreampDb)
    }

    @Test fun `every preset controls ten bands`() {
        assertEquals(10, EqualizerState.BANDS_HZ.size)
        EqualizerState.PRESETS.values.forEach { assertEquals(10, it.size) }
    }
}
