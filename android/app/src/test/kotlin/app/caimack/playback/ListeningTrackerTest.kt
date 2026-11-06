// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ListeningTrackerTest {
    @Test
    fun `an automatic radio return is not a deliberate replay`() {
        val recorded = mutableListOf<ListeningEvent>()
        val radio = ListeningTracker(sourceOf = { "radio:track" }) { recorded += it }
        radio.begin("song", 210)
        radio.finish(ListeningTracker.COMPLETED)
        radio.begin("song", 210)
        assertEquals(listOf("trackStarted", "trackCompleted", "trackStarted"), recorded.map { it.type })
    }

    private val events = mutableListOf<ListeningEvent>()
    private val tracker = ListeningTracker { events += it }

    private fun types() = events.map { it.type }

    private fun last(type: String) = events.last { it.type == type }

    @Test
    fun `the start is recorded`() {
        tracker.begin("song", 210)

        assertEquals(listOf("trackStarted"), types())
        assertEquals(210, last("trackStarted").durationSeconds)
    }

    @Test
    fun `a repeat listen of the same track is marked`() {
        tracker.begin("song", 210)
        tracker.finish(ListeningTracker.COMPLETED)
        tracker.begin("song", 210)

        assertEquals(listOf("trackStarted", "trackCompleted", "trackStarted", "trackReplayed"), types())
    }

    @Test
    fun `a first listen of another track is not a repeat`() {
        tracker.begin("song", 210)
        tracker.begin("other", 210)

        assertEquals(listOf("trackStarted", "trackStarted"), types())
    }

    @Test
    fun `steady playback is counted`() {
        tracker.begin("song", 210)
        for (second in 1..40) tracker.accumulate(second.toDouble())

        assertEquals(30, last("trackPlayed").listenedSeconds)
        assertEquals(30, last("trackPlayed").positionSeconds)
    }

    @Test
    fun `a seek is not counted as listening`() {
        tracker.begin("song", 210)
        tracker.accumulate(1.0)
        tracker.accumulate(120.0)
        tracker.finish(ListeningTracker.SKIPPED)

        assertEquals(1, last("trackSkipped").listenedSeconds)
        assertEquals(120, last("trackSkipped").positionSeconds)
    }

    @Test
    fun `short seeks and restored positions do not count towards history`() {
        tracker.begin("song", 210)
        tracker.reposition(60.0)
        tracker.accumulate(61.0)
        tracker.reposition(62.0)
        assertEquals(1, tracker.listenedSeconds)
    }

    @Test
    fun `backwards movement is not counted`() {
        tracker.begin("song", 210)
        tracker.accumulate(1.5)
        tracker.accumulate(0.0)
        tracker.finish(ListeningTracker.SKIPPED)

        assertEquals(1, last("trackSkipped").listenedSeconds)
    }

    @Test
    fun `a heartbeat goes out once per thirty listened seconds`() {
        tracker.begin("song", 210)
        for (second in 1..90) tracker.accumulate(second.toDouble())

        assertEquals(3, types().count { it == "trackPlayed" })
    }

    @Test
    fun `nothing is recorded while no track is playing`() {
        tracker.accumulate(10.0)

        assertTrue(events.isEmpty())
    }

    @Test
    fun `a track is finished at most once`() {
        tracker.begin("song", 210)
        tracker.finish(ListeningTracker.COMPLETED)
        tracker.finish(ListeningTracker.SKIPPED)

        assertEquals(listOf("trackStarted", "trackCompleted"), types())
    }

    @Test
    fun `the next track starts from zero`() {
        tracker.begin("song", 210)
        for (second in 1..20) tracker.accumulate(second.toDouble())
        tracker.begin("other", 180)
        tracker.accumulate(1.0)
        tracker.finish(ListeningTracker.SKIPPED)

        assertEquals("other", last("trackSkipped").trackId)
        assertEquals(1, last("trackSkipped").listenedSeconds)
    }

    @Test
    fun `history waits for thirty seconds or almost the whole of a short track`() {
        assertEquals(30, ListeningTracker.historyThreshold(240))
        assertEquals(11, ListeningTracker.historyThreshold(12))
        assertEquals(1, ListeningTracker.historyThreshold(0))
    }

    @Test
    fun `discarding a failed or interrupted track does not record a skip`() {
        tracker.begin("song", 210)
        tracker.accumulate(1.0)
        tracker.discard()
        tracker.finish(ListeningTracker.SKIPPED)
        assertEquals(listOf("trackStarted"), types())
        assertEquals(0, tracker.listenedSeconds)
        tracker.begin("song", 210)
        tracker.accumulate(1.0)
        tracker.finish(ListeningTracker.COMPLETED)
        assertEquals("song", last("trackCompleted").trackId)
        assertEquals(1, last("trackCompleted").listenedSeconds)
        assertEquals(listOf("trackStarted", "trackStarted", "trackCompleted"), types())
    }

    @Test
    fun `the source travels with every event of a listen`() {
        val sourced = ListeningTracker(sourceOf = { id -> if (id == "song") "home:forYou" else null }) { events += it }

        sourced.begin("song", 210)
        sourced.accumulate(1.0)
        sourced.finish(ListeningTracker.SKIPPED)
        sourced.begin("other", 210)

        assertEquals(listOf("home:forYou", "home:forYou", null), events.map { it.source })
    }
}
