// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.haptics

internal enum class PlayerHaptic { Button, Skip, Favorite, Tick, Boundary, SwipeArmed, SwipeCancelled, Confirm }

internal class TactileFeedback(
    private val enabled: () -> Boolean,
    private val now: () -> Long,
    private val emit: (PlayerHaptic) -> Unit,
) {
    private var lastTick: Long? = null
    fun perform(event: PlayerHaptic) {
        if (!enabled()) return
        val time = now()
        if (event == PlayerHaptic.Tick) {
            if (lastTick?.let { time - it < TICK_INTERVAL_MS } == true) return
            lastTick = time
        }
        emit(event)
    }
    companion object { const val TICK_INTERVAL_MS = 45L }
}

/** Emit at time divisions and on entering an end stop, rather than on every drag pixel. */
internal class SeekHaptics(private val duration: Long) {
    private var previous: Long? = null
    fun start(position: Long) { previous = position.coerceIn(0, duration.coerceAtLeast(0)) }
    fun move(position: Long): PlayerHaptic? {
        if (duration <= 0) return null
        val next = position.coerceIn(0, duration)
        val old = previous
        previous = next
        if (old == null || old == next) return null
        if (next == 0L || next == duration) return PlayerHaptic.Boundary
        return if (old / DIVISION_MS != next / DIVISION_MS) PlayerHaptic.Tick else null
    }
    companion object { const val DIVISION_MS = 5_000L }
}
