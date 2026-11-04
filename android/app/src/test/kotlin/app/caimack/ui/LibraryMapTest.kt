// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryMapTest {
    @Test
    fun `the tracks fill the canvas when their bounds are known`() {
        val view = fitView(1000f, 500f, Bounds(0.4f, 0.4f, 0.6f, 0.5f))

        val middle = toScreen(Spot(0.5f, 0.45f), view, 500f)
        assertEquals(500f, middle.x, 0.01f)
        assertEquals(250f, middle.y, 0.01f)

        val top = toScreen(Spot(0.5f, 0.4f), view, 500f)
        assertTrue(top.y in 40f..80f)
    }

    @Test
    fun `the spot under the fingers stays in place while zooming`() {
        val view = fitView(500f, 500f, null)
        val fingers = Spot(120f, 340f)
        val under = toMap(fingers, view, 500f)

        val after = toScreen(under, zoomAt(view, 2.5f, fingers), 500f)

        assertEquals(fingers.x, after.x, 0.01f)
        assertEquals(fingers.y, after.y, 0.01f)
    }

    @Test
    fun `zoom stops at the limit`() =
        assertEquals(MAX_ZOOM, zoomAt(fitView(100f, 100f, null), 1000f, Spot(0f, 0f)).k)

    @Test
    fun `the grid gets finer as the map zooms in`() {
        assertEquals(0.1f, gridStep(1f), 1e-6f)
        assertEquals(0.05f, gridStep(2.5f), 1e-6f)
        assertEquals(0.1f, gridStep(0.8f), 1e-6f)
    }

    @Test
    fun `constellations link neighbours inside a cluster but not across the gap`() {
        val spots = listOf(
            Spot(0.1f, 0.1f), Spot(0.12f, 0.1f), Spot(0.11f, 0.12f),
            Spot(0.9f, 0.9f), Spot(0.92f, 0.9f), Spot(0.91f, 0.92f),
        )

        val links = constellation(spots)

        assertTrue(links.isNotEmpty())
        links.forEach { (a, b) -> assertEquals(a < 3, b < 3) }
    }

    @Test
    fun `every pair is listed once`() =
        assertEquals(listOf(0 to 1), constellation(listOf(Spot(0f, 0f), Spot(0.01f, 0f))))

    @Test
    fun `brightness grows with plays on a log scale`() {
        assertEquals(0f, playsLevel(0, 10))
        assertEquals(1f, playsLevel(10, 10), 1e-6f)
        assertTrue(playsLevel(1, 100) > 0.1f)
    }
}
