// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.haptics

import org.junit.Assert.*
import org.junit.Test

class AudioHapticsTest {
    private class Effect : AudioHapticEffect {
        val changes = mutableListOf<Boolean>()
        var released = false
        var rejectEnable = false
        override fun enable(enabled: Boolean): Boolean { changes += enabled; return !enabled || !rejectEnable }
        override fun close() { released = true }
    }
    private class Factory(override val available: Boolean = true) : AudioHapticFactory {
        val sessions = mutableListOf<Int>()
        val effects = mutableListOf<Effect>()
        var fail = false
        override fun create(session: Int): AudioHapticEffect? {
            sessions += session
            if (fail) return null
            return Effect().also { effects += it }
        }
    }

    @Test fun unsupportedAndOffNeverCreateAnEffect() {
        for (available in listOf(false, true)) {
            val factory = Factory(available)
            var state: MusicHapticsStatus? = null
            val controller = AudioHaptics(factory) { state = it }
            controller.update(42, requested = false, playing = true)
            assertTrue(factory.sessions.isEmpty())
            assertEquals(if (available) MusicHapticsStatus.Off else MusicHapticsStatus.Unsupported, state)
            if (!available) { controller.update(42, true, true); assertTrue(factory.sessions.isEmpty()) }
        }
    }

    @Test fun localPlaybackEnablesTheEffectAndPauseOrBufferingDisablesIt() {
        val factory = Factory()
        var state: MusicHapticsStatus? = null
        val controller = AudioHaptics(factory) { state = it }
        controller.update(0, true, true)
        controller.update(42, true, false)
        assertTrue(factory.sessions.isEmpty())
        assertEquals(MusicHapticsStatus.Ready, state)
        controller.update(42, true, true)
        controller.update(42, true, true)
        assertEquals(listOf(42), factory.sessions)
        assertEquals(listOf(true), factory.effects.single().changes)
        assertEquals(MusicHapticsStatus.Active, state)
        controller.update(42, true, false)
        assertEquals(listOf(true, false), factory.effects.single().changes)
        assertEquals(MusicHapticsStatus.Ready, state)
        controller.update(42, true, true)
        assertEquals(listOf(true, false, true), factory.effects.single().changes)
    }

    @Test fun replacingTheAudioTrackReleasesThePreviousSession() {
        val factory = Factory()
        val controller = AudioHaptics(factory) {}
        controller.update(10, true, true)
        controller.update(20, true, true)
        assertEquals(listOf(10, 20), factory.sessions)
        assertTrue(factory.effects[0].released)
        assertFalse(factory.effects[1].released)
        controller.update(20, false, true)
        assertTrue(factory.effects[1].released)
    }

    @Test fun failedOutputsDoNotLoopAndCanBeRetriedAfterTogglingOrSessionChange() {
        val factory = Factory().apply { fail = true }
        var state: MusicHapticsStatus? = null
        val controller = AudioHaptics(factory) { state = it }
        repeat(3) { controller.update(10, true, true) }
        assertEquals(listOf(10), factory.sessions)
        assertEquals(MusicHapticsStatus.Failed, state)
        factory.fail = false
        controller.update(10, false, false)
        controller.update(10, true, true)
        assertEquals(MusicHapticsStatus.Active, state)
        factory.effects.last().rejectEnable = true
        controller.update(10, true, false)
        controller.update(10, true, true)
        assertEquals(MusicHapticsStatus.Failed, state)
        assertTrue(factory.effects.last().released)
        controller.update(11, true, true)
        assertEquals(MusicHapticsStatus.Active, state)
        controller.close()
        assertTrue(factory.effects.last().released)
        assertEquals(MusicHapticsStatus.Off, state)
    }
}
