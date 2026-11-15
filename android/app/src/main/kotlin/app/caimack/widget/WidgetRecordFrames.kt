// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.widget

/** Keep the outgoing sleeve intact when a different track enters the other slot. */
internal data class WidgetRecordFrames<T>(
    val frames: List<T> = emptyList(),
    val slot: Int = 0,
    private val track: String? = null,
) {
    val current: T? get() = frames.getOrNull(slot)

    fun next(frame: T, track: String?): WidgetRecordFrames<T> {
        if (frames.isEmpty()) return WidgetRecordFrames(listOf(frame, frame), 0, track)
        val nextSlot = if (this.track == track) slot else 1 - slot
        return WidgetRecordFrames(frames.toMutableList().apply { this[nextSlot] = frame }, nextSlot, track)
    }
}
