// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import app.caimack.api.Lyrics
import app.caimack.api.LyricWord
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricsTest {
    @Test fun oldLineOnlyResponsesRemainReadable() {
        val lyrics = Json { ignoreUnknownKeys = true }.decodeFromString<Lyrics>("""{"plain":"Hello","lines":[{"at":1000,"text":"Hello"}],"trackId":"id"}""")
        assertTrue(lyrics.lines.single().words.isEmpty())
    }

    @Test fun wordFillFollowsAudioPositionAndResetsAfterSeeking() {
        val word = LyricWord(1000, 2000, "Привет ")
        assertEquals(0f, lyricWordProgress(word, 900))
        assertEquals(.5f, lyricWordProgress(word, 1500))
        assertEquals(1f, lyricWordProgress(word, 2000))
        assertEquals(0f, lyricWordProgress(word, 500))
        assertEquals(1f, lyricWordProgress(word.copy(end = 1000), 1000))
    }
}
