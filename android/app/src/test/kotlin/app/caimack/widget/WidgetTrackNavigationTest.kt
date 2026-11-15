// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.widget

import org.junit.Assert.*
import org.junit.Test

class WidgetTrackNavigationTest {
    @Test fun `previous enters from the left even when wrapping to a higher queue index`() {
        val back = WidgetTrackNavigation("first", "last", previous = true, requestedAt = 100)
        assertTrue(back.isPrevious("first", "last", 150))
        assertFalse(back.copy(previous = false).isPrevious("first", "last", 150))
    }

    @Test fun `restart or unrelated track change cannot reuse an old previous command`() {
        val back = WidgetTrackNavigation("two", "one", previous = true, requestedAt = 100)
        assertFalse(back.isPrevious("two", "two", 150))
        assertFalse(back.isPrevious("two", "three", 150))
        assertFalse(back.isPrevious("other", "one", 150))
        assertFalse(back.isPrevious("two", "one", 5_101))
    }

    @Test fun `cold controller can resolve a direction before its queue arrives`() {
        assertTrue(WidgetTrackNavigation("two", null, previous = true, requestedAt = 100).isPrevious("two", "one", 150))
    }
}
