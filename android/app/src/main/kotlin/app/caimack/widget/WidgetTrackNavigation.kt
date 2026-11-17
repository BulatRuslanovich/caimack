// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.widget

/** Bind a button's direction to its source/target, not to an unrelated later track. */
internal data class WidgetTrackNavigation(
    val from: String?,
    val target: String?,
    val previous: Boolean,
    val requestedAt: Long,
) {
    fun isPrevious(oldTrack: String?, newTrack: String?, now: Long): Boolean =
        previous && oldTrack != newTrack && from == oldTrack &&
            (target == null || target == newTrack) && now - requestedAt in 0..5_000
}
