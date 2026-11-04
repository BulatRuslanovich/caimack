// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RadioPolicyTest {
    @Test
    fun `older songs can return while recent and upcoming entries remain excluded`() {
        val order = listOf(0, 1, 2, 3, 4, 5)
        assertEquals(listOf(1, 2, 3, 4, 5), RadioPolicy.exclusions(order, 3, order.toSet()))
        assertEquals(listOf(4, 1, 3, 2), RadioPolicy.exclusions(listOf(0, 4, 1, 3, 2), 3, setOf(0, 4, 1, 3, 2)))
    }

    @Test
    fun `refresh protects history, next item and manual additions`() {
        assertEquals(setOf(0, 1, 2, 4), RadioPolicy.retained(listOf(0, 1, 2, 3, 4), 1) { it != 4 })
    }

    @Test
    fun `shuffle protects traversal history rather than physical indices`() {
        assertEquals(setOf(4, 1, 3, 2), RadioPolicy.retained(listOf(4, 1, 3, 0, 2), 1) { it != 2 })
    }

    @Test
    fun `refresh requires a listening outcome or a meaningful choice`() {
        assertTrue(RadioPolicy.reactsTo("trackSkipped", 5))
        assertTrue(RadioPolicy.reactsTo("trackLiked", null))
        assertTrue(RadioPolicy.reactsTo("trackAddedToQueue", null))
        assertFalse(RadioPolicy.reactsTo("trackStarted", null))
        assertFalse(RadioPolicy.reactsTo("trackPlayed", 30))
        assertTrue(RadioPolicy.reactsTo("trackPlayed", 60))
    }
}
