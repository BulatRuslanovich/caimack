// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import app.caimack.api.Track
import app.caimack.api.TrackLoudness
import org.junit.Assert.assertEquals
import org.junit.Test

class LoudnessTest {
    private fun measured(lufs: Double?) = Track(
        id = "song",
        title = "Song",
        artistId = "artist",
        artistName = "Artist",
        durationSeconds = 200,
        loudness = lufs?.let { TrackLoudness(lufs = it, truePeak = -1.0) },
    )

    @Test
    fun `a loud master is turned down to the target`() {
        assertEquals(0.501f, Loudness.gain(measured(Loudness.TARGET_LUFS + 6), true), 0.001f)
    }

    @Test
    fun `a quiet track is never turned up`() {
        assertEquals(1f, Loudness.gain(measured(Loudness.TARGET_LUFS - 6), true))
    }

    @Test
    fun `nothing changes when switched off or not measured`() {
        assertEquals(1f, Loudness.gain(measured(-6.0), false))
        assertEquals(1f, Loudness.gain(measured(null), true))
        assertEquals(1f, Loudness.gain(null, true))
    }
}
