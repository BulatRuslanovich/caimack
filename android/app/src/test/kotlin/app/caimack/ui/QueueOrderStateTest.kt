// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import app.caimack.api.Track
import org.junit.Assert.*
import org.junit.Test

class QueueOrderStateTest {
    private fun track(id: String) = Track(id, id, "artist", "Artist", durationSeconds = 180)

    @Test fun dropKeepsTheOccurrenceAtItsDestinationBeforeAndAfterPlayerConfirmation() {
        val source = listOf(track("a"), track("b"), track("c"), track("d"))
        val order = QueueOrderState(source)
        val key = order.entries.last().key
        order.move(key, order.entries.first().key)
        val landed = order.entries.map { it.key }
        assertEquals(3 to 0, order.commit(key))
        assertEquals(key, order.entries.first().key)
        assertEquals(3, order.sourceIndex(key))
        // Progress/metadata snapshots still carry the previous queue while the
        // move command is in flight. They must not roll the row back.
        order.sync(source.map { it.copy(isFavorite = true) })
        assertEquals(landed, order.entries.map { it.key })
        assertNotNull(order.pending)
        order.sync(listOf(source[3], source[0], source[1], source[2]))
        assertEquals(landed, order.entries.map { it.key })
        assertEquals(0, order.sourceIndex(key))
        assertNull(order.pending)
    }

    @Test fun duplicateTracksKeepSeparateOccurrenceKeysAfterConfirmation() {
        val source = listOf(track("a"), track("b"), track("a"), track("c"))
        val order = QueueOrderState(source)
        val key = order.entries[2].key
        val other = order.entries[0].key
        order.move(key, other)
        order.commit(key)
        val landed = order.entries.map { it.key }
        order.sync(listOf(source[2], source[0], source[1], source[3]))
        assertEquals(landed, order.entries.map { it.key })
        assertEquals(key, order.entries[0].key)
        assertEquals(other, order.entries[1].key)
    }

    @Test fun cancellationOrFailureRestoresConfirmedOrderWithoutChangingKeys() {
        val order = QueueOrderState(listOf(track("a"), track("b"), track("c")))
        val original = order.entries
        order.move(original[2].key, original[0].key)
        order.commit(original[2].key)
        order.cancel()
        assertEquals(original, order.entries)
        assertNull(order.pending)
    }

    @Test fun swappingAdjacentIdenticalTracksKeepsTheirNewIdentityOrderWithoutACommand() {
        val order = QueueOrderState(listOf(track("a"), track("a"), track("b")))
        val first = order.entries[0].key
        val second = order.entries[1].key
        order.move(second, first)
        assertNull(order.commit(second))
        assertEquals(second, order.entries.first().key)
        assertEquals(0, order.sourceIndex(second))
        assertEquals(1, order.sourceIndex(first))
        assertNull(order.pending)
    }
}
