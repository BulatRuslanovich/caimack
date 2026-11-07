// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import app.caimack.api.Genre
import org.junit.Assert.*
import org.junit.Test

class GenreNamesTest {
    @Test fun internalGenreNamesAreReadableAndUnknownNamesRemainAvailable() {
        assertEquals("Metalcore", readableGenre("metalcoregenre"))
        assertEquals("International rap", readableGenre("foreignrap"))
        assertEquals("My own genre", readableGenre("my_own_genre"))
        assertEquals("", readableGenre(""))
    }
    @Test fun discoveryIsBoundedAndAliasesDoNotCrowdOutOtherGenres() {
        val genres = (1..20).map { Genre("$it", "Genre $it", it) } + listOf(
            Genre("rock", "rock", 2), Genre("allrock", "allrock", 100), Genre("pop", "pop", 1),
        )
        val preview = previewGenres(genres)
        assertEquals(8, preview.size)
        assertEquals("rock", preview.first().id)
        assertTrue(preview.any { it.id == "pop" })
        assertEquals(1, preview.count { readableGenre(it.name) == "Rock" })
    }
}
