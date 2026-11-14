// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.haptics

import org.junit.Assert.*
import org.junit.Test

class TactileFeedbackTest {
    @Test fun frequentGrooveTicksAreLimitedButIntentionalActionsAreNotDropped() {
        var time = 0L
        var enabled = true
        val events = mutableListOf<PlayerHaptic>()
        val feedback = TactileFeedback({ enabled }, { time }, events::add)
        repeat(100) { time = it.toLong(); feedback.perform(PlayerHaptic.Tick) }
        assertEquals(3, events.size)
        feedback.perform(PlayerHaptic.Boundary)
        feedback.perform(PlayerHaptic.Skip)
        assertEquals(PlayerHaptic.Skip, events.last())
        val count = events.size
        enabled = false
        time = 1000
        feedback.perform(PlayerHaptic.Tick)
        feedback.perform(PlayerHaptic.Button)
        assertEquals(count, events.size)
    }

    @Test fun seekingTicksAtTimeDivisionsAndOnlyOnceAtEachBoundary() {
        val seek = SeekHaptics(20_000)
        seek.start(1000)
        assertNull(seek.move(1100))
        assertEquals(PlayerHaptic.Tick, seek.move(5100))
        assertNull(seek.move(5200))
        assertEquals(PlayerHaptic.Boundary, seek.move(20_000))
        assertNull(seek.move(21_000))
        assertEquals(PlayerHaptic.Tick, seek.move(8000))
        assertEquals(PlayerHaptic.Boundary, seek.move(-100))
        assertNull(seek.move(0))
        assertNull(SeekHaptics(0).move(100))
    }
}
