// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.isActive

/** The held row stays under the finger while the list scrolls and swaps beneath it. */
internal class QueueDragState(
    private val list: LazyListState,
    private val onSwap: State<(Int, Int) -> Unit>,
) {
    var dragged by mutableStateOf<Int?>(null)
        private set
    var landed by mutableStateOf<Int?>(null)
        private set
    var center by mutableFloatStateOf(0f)
        private set

    fun start(key: Int): Boolean {
        if (dragged != null) return false
        val row = list.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key } ?: return false
        center = row.offset + row.size / 2f
        landed = null
        dragged = key
        return true
    }

    fun dragBy(amount: Float) {
        center += amount
        retarget()
    }

    private fun visibleCenter(size: Int): Float {
        val layout = list.layoutInfo
        val half = minOf(size / 2f, (layout.viewportEndOffset - layout.viewportStartOffset) / 2f)
        return center.coerceIn(layout.viewportStartOffset + half, layout.viewportEndOffset - half)
    }

    fun translation(key: Int): Float {
        if (key != dragged) return 0f
        val row = list.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key } ?: return 0f
        return visibleCenter(row.size) - row.offset - row.size / 2f
    }

    fun retarget() {
        val key = dragged ?: return
        val (target, _) = swapTarget(list, key, translation(key)) ?: return
        // Reordering the first visible key must not anchor the viewport to its
        // new index and eject the held handle from composition.
        list.requestScrollToItem(list.firstVisibleItemIndex, list.firstVisibleItemScrollOffset)
        onSwap.value(key, target)
    }

    fun finish(): Int? = dragged.also {
        if (it != null) landed = it
        dragged = null
    }

    fun cancel() {
        dragged = null
        landed = null
    }
}

@Composable
internal fun rememberQueueDragState(
    list: LazyListState,
    onSwap: (Int, Int) -> Unit,
): QueueDragState {
    val latestSwap = rememberUpdatedState(onSwap)
    val drag = remember(list) { QueueDragState(list, latestSwap) }
    val density = LocalDensity.current
    LaunchedEffect(drag.dragged) {
        if (drag.dragged == null) return@LaunchedEffect
        val edge = with(density) { 64.dp.toPx() }
        val maxSpeed = with(density) { 700.dp.toPx() }
        var previous = withFrameNanos { it }
        while (isActive && drag.dragged != null) {
            val now = withFrameNanos { it }
            val seconds = ((now - previous) / 1_000_000_000f).coerceAtMost(0.032f)
            previous = now
            val layout = list.layoutInfo
            val speed = when {
                drag.center < layout.viewportStartOffset + edge ->
                    -((layout.viewportStartOffset + edge - drag.center) / edge).coerceIn(0f, 1f)
                drag.center > layout.viewportEndOffset - edge ->
                    ((drag.center - layout.viewportEndOffset + edge) / edge).coerceIn(0f, 1f)
                else -> 0f
            }
            if (speed != 0f) list.scrollBy(speed * maxSpeed * seconds)
            // Also swap after scrolling when the finger itself has not moved.
            drag.retarget()
        }
    }
    return drag
}
