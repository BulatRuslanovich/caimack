// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareCardTest {
    private val measure = { text: String -> text.length.toFloat() }

    @Test
    fun `short text stays on one line`() =
        assertEquals(listOf("Let It Happen"), wrapLines(measure, "Let It Happen", 20f, 2))

    @Test
    fun `words wrap at the width`() =
        assertEquals(listOf("one two", "three"), wrapLines(measure, "one two three", 8f, 3))

    @Test
    fun `overflow ends the last line with an ellipsis`() {
        val lines = wrapLines(measure, "one two three four five six", 8f, 2)

        assertEquals(2, lines.size)
        assertTrue(lines.last().endsWith("…"))
        assertTrue(lines.all { it.length <= 8 })
    }

    @Test
    fun `a single word longer than the width is kept`() =
        assertEquals(listOf("Supercalifragilistic"), wrapLines(measure, "Supercalifragilistic", 5f, 2))
}
