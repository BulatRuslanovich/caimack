// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import app.caimack.api.Paged
import app.caimack.api.Track
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class CollectionTracksTest {
    private fun track(id: Int) = Track("$id", "Track $id", "artist", "Artist", durationSeconds = 180)

    @Test fun collectionActionsIncludeTracksPastTheFirstPage() = runBlocking {
        val requests = mutableListOf<Int>()
        val all = collectionTracks { page ->
            requests += page
            val start = (page - 1) * 50
            Paged((start until minOf(start + 50, 123)).map(::track), 123, page, 50)
        }
        assertEquals(listOf(1, 2, 3), requests)
        assertEquals(123, all.size)
        assertEquals("122", all.last().id)
    }

    @Test fun failedLaterPageDoesNotReturnAPartialCollection() = runBlocking {
        try {
            collectionTracks { page ->
                if (page == 2) throw java.io.IOException("offline")
                Paged(listOf(track(1)), 2, 1, 1)
            }
            fail("Must surface the failed page")
        } catch (_: java.io.IOException) { }
    }

    @Test fun movingTracksAcrossPagesDoNotProduceDuplicates() = runBlocking {
        val all = collectionTracks { page ->
            Paged(if (page == 1) listOf(track(1), track(2)) else listOf(track(2), track(3)), 4, page, 2)
        }
        assertEquals(listOf("1", "2", "3"), all.map { it.id })
    }
}
