// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import app.caimack.api.MapPoint
import app.caimack.api.Track
import org.junit.Assert.*
import org.junit.Test

class MapPresentationTest {
    private val tracks = (0..12).map { Track("$it", "Track $it", "artist", "Artist", durationSeconds = 180) }
    private val points = tracks.mapIndexed { index, track -> MapPoint(track.id, index / 20f, 0.5f, track.title, "Artist") }

    @Test fun `route follows playback order and ignores tracks absent from the map`() {
        val route = playbackMapRoute(points.filter { it.id != "7" }, tracks, 5, false, 6)!!
        assertEquals("5", route.at.id)
        assertEquals(listOf("2", "3", "4"), route.behind.map { it.id })
        assertEquals(listOf("6", "8", "9", "10", "11"), route.ahead.map { it.id })
    }

    @Test fun `shuffle route uses actual next index and does not invent history`() {
        val route = playbackMapRoute(points, tracks, 5, true, 11)!!
        assertTrue(route.behind.isEmpty())
        assertEquals(listOf("11"), route.ahead.map { it.id })
        assertNull(playbackMapRoute(points, tracks, -1, false, 0))
        assertNull(playbackMapRoute(emptyList(), tracks, 5, false, 6))
    }

    @Test fun `cover tiles are culled spaced and prioritize selected tracks`() {
        val dense = (0..200).map { MapPoint("$it", it / 1000f, 0.5f, "Track", "Artist") } +
            MapPoint("outside", 20f, 20f, "Outside", "Artist")
        val visible = visibleMapCovers(dense, MapView(5f, 0f, -1000f), 500f, 500f, 32f, null, "1")
        assertTrue(visible.any { it.id == "1" })
        assertFalse(visible.any { it.id == "outside" })
        assertTrue(visible.size < dense.size)
        assertEquals(visible.size, visible.map { it.id }.toSet().size)
        assertTrue(visibleMapCovers(points, MapView(5f, 0f, 0f), 0f, 0f, 32f, null, null).isEmpty())
    }

    @Test fun `layer controls match web keys with motion separate from visible layer count`() {
        assertEquals(listOf("route", "covers", "links", "motion"), MapLayer.entries.map { it.key })
        assertEquals(3, MapLayer.entries.count { it != MapLayer.Motion })
    }
}
