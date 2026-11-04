// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaySourcesTest {
    @Test
    fun `the latest source of a track wins and an unknown one is ignored`() {
        PlaySources.tag(listOf("a", "b"), "album")
        PlaySources.tag(listOf("a"), "queue")
        PlaySources.tag(listOf("b"), null)

        assertEquals("queue", PlaySources.of("a"))
        assertEquals("album", PlaySources.of("b"))
        assertNull(PlaySources.of("never"))
    }

    @Test
    fun `radios are told apart`() {
        assertEquals("radio:mood:sad", PlaySources.radio("sad"))
        assertEquals("radio:track", PlaySources.radio(null, seeded = true))
        assertEquals("radio", PlaySources.radio(null))
    }
}
