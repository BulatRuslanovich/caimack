// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.widget

import org.junit.Assert.*
import org.junit.Test

class WidgetRecordFramesTest {
    @Test fun `pause and metadata refresh preserve the current sleeve and slot`() {
        val playing = WidgetRecordFrames<String>().next("a playing", "a")
        val paused = playing.next("a paused", "a")
        assertEquals(playing.slot, paused.slot)
        assertEquals("a paused", paused.current)
        assertEquals(playing.slot, paused.next("a liked", "a").slot)
    }

    @Test fun `rapid track changes keep only the outgoing and incoming records`() {
        val a = WidgetRecordFrames<String>().next("a", "a")
        val b = a.next("b", "b")
        assertNotEquals(a.slot, b.slot)
        assertEquals("a", b.frames[a.slot])
        val c = b.next("c", "c")
        assertEquals(a.slot, c.slot)
        assertEquals("b", c.frames[b.slot])
        assertEquals("c", c.current)
        assertEquals(2, c.frames.size)
    }
}
