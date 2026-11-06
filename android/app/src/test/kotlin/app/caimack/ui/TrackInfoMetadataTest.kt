// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import app.caimack.api.Track
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class TrackInfoMetadataTest {
    @Test fun `catalog metadata survives decoding for track information`() {
        val track = Json.decodeFromString<Track>("""{
            "id":"1","title":"Title","artistId":"a","artistName":"Artist","durationSeconds":180,
            "genreName":"Electronic","trackNumber":2,"discNumber":1,"codec":"flac",
            "bitrateKbps":950,"sampleRateHz":44100,"bitsPerSample":24,
            "originalFileName":"02 - Song.flac","createdAt":"2026-11-06T10:00:00Z","hasLyrics":true
        }""")
        assertEquals(44100, track.sampleRateHz)
        assertEquals(24, track.bitsPerSample)
        assertEquals("02 - Song.flac", track.originalFileName)
        assertEquals(true, track.hasLyrics)
        assertEquals("Electronic", track.genreName)
    }

    @Test fun `older cached tracks remain readable without new metadata`() {
        val track = Json.decodeFromString<Track>("""{"id":"1","title":"Title","artistId":"a","artistName":"Artist","durationSeconds":180}""")
        assertNull(track.originalFileName)
        assertNull(track.hasLyrics)
        assertNull(track.sampleRateHz)
    }
}
