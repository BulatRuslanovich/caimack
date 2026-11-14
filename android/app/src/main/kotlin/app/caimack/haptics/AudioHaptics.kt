// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.haptics

import android.media.audiofx.AudioEffect
import android.media.audiofx.HapticGenerator

enum class MusicHapticsStatus { Unsupported, Off, Ready, Active, Failed }

internal interface AudioHapticEffect : AutoCloseable {
    fun enable(enabled: Boolean): Boolean
}

internal interface AudioHapticFactory {
    val available: Boolean
    fun create(session: Int): AudioHapticEffect?
}

internal object AndroidAudioHapticFactory : AudioHapticFactory {
    override val available: Boolean get() = runCatching { HapticGenerator.isAvailable() }.getOrDefault(false)
    override fun create(session: Int): AudioHapticEffect? = HapticGenerator.create(session)?.let { generator ->
        object : AudioHapticEffect {
            override fun enable(enabled: Boolean) = generator.setEnabled(enabled) == AudioEffect.SUCCESS
            override fun close() = generator.release()
        }
    }
}

/** Only the local audio output owns an effect. No timers or synthetic beat patterns. */
internal class AudioHaptics(
    private val factory: AudioHapticFactory,
    private val report: (MusicHapticsStatus) -> Unit,
) : AutoCloseable {
    private val supported = factory.available
    private var effect: AudioHapticEffect? = null
    private var session = 0
    private var enabled = false
    private var failed = false

    fun update(sessionId: Int, requested: Boolean, playing: Boolean) {
        if (!supported) { release(); report(MusicHapticsStatus.Unsupported); return }
        if (!requested) { release(); report(MusicHapticsStatus.Off); return }
        if (sessionId != session) { release(); session = sessionId }
        if (failed) { report(MusicHapticsStatus.Failed); return }
        if (sessionId <= 0) { report(MusicHapticsStatus.Ready); return }
        try {
            if (playing && effect == null) effect = factory.create(sessionId) ?: error("Audio haptics unavailable for session")
            if (effect != null && enabled != playing) {
                check(effect!!.enable(playing)) { "Audio haptics rejected enable state" }
                enabled = playing
            }
            report(if (enabled) MusicHapticsStatus.Active else MusicHapticsStatus.Ready)
        } catch (_: RuntimeException) {
            release()
            session = sessionId
            failed = true
            report(MusicHapticsStatus.Failed)
        }
    }

    private fun release() {
        effect?.let { runCatching { it.enable(false) }; runCatching { it.close() } }
        effect = null
        session = 0
        enabled = false
        failed = false
    }

    override fun close() {
        release()
        report(if (supported) MusicHapticsStatus.Off else MusicHapticsStatus.Unsupported)
    }
}
