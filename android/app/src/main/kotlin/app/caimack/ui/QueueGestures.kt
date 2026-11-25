// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import app.caimack.haptics.PlayerHaptic
import kotlin.math.abs

@Composable
internal fun QueueGestures(
    enabled: Boolean,
    revision: Int,
    onRemove: () -> Unit,
    onPlayNext: () -> Unit,
    onReorderStart: () -> Boolean,
    onReorder: (Float) -> Unit,
    onReorderEnd: () -> Unit,
    onReorderCancel: () -> Unit,
    haptic: (PlayerHaptic) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (swipe: Modifier, body: Modifier) -> Unit,
) {
    val remove by rememberUpdatedState(onRemove)
    val playNext by rememberUpdatedState(onPlayNext)
    val reorderStart by rememberUpdatedState(onReorderStart)
    val reorder by rememberUpdatedState(onReorder)
    val reorderEnd by rememberUpdatedState(onReorderEnd)
    val reorderCancel by rememberUpdatedState(onReorderCancel)
    val feedback by rememberUpdatedState(haptic)
    val palette = LocalPalette.current
    var dragging by remember { mutableStateOf(false) }
    var reordering by remember { mutableStateOf(false) }
    var offset by remember { mutableFloatStateOf(0f) }
    var threshold by remember { mutableFloatStateOf(1f) }
    var release by remember { mutableIntStateOf(0) }
    fun settle() {
        if (dragging) {
            dragging = false
            release++
        }
    }
    LaunchedEffect(dragging, release) {
        if (!dragging && offset != 0f) {
            animate(offset, 0f, animationSpec = spring(dampingRatio = 0.86f, stiffness = 550f, visibilityThreshold = 0.5f)) { value, _ ->
                if (!dragging) offset = value
            }
        }
    }

    val swipe = Modifier.pointerInput(enabled, revision) {
        if (!enabled) return@pointerInput
        try {
            detectHorizontalDragGestures(
                onDragStart = {
                    if (!reordering) {
                        offset = 0f
                        threshold = minOf(88.dp.toPx(), size.width * 0.30f)
                        dragging = true
                    }
                },
                onDragCancel = { settle() },
                onDragEnd = {
                    if (dragging) {
                        val released = offset
                        settle()
                        if (abs(released) >= threshold) {
                            feedback(PlayerHaptic.Confirm)
                            if (released < 0f) remove() else playNext()
                        }
                    }
                },
            ) { _, amount ->
                if (dragging) {
                    val previous = offset
                    offset = (offset + amount).coerceIn(-size.width.toFloat(), size.width.toFloat())
                    val wasArmed = abs(previous) >= threshold
                    val armed = abs(offset) >= threshold
                    if (armed != wasArmed) {
                        feedback(if (armed) PlayerHaptic.SwipeArmed else PlayerHaptic.SwipeCancelled)
                    }
                }
            }
        } finally {
            settle()
        }
    }
    val body = if (enabled) {
        Modifier.pointerInput(revision) {
            fun cancelReorder() {
                if (reordering) {
                    reordering = false
                    reorderCancel()
                }
            }
            try {
                detectDragGesturesAfterLongPress(
                    onDragStart = {
                        if (!dragging && reorderStart()) {
                            reordering = true
                            feedback(PlayerHaptic.SwipeArmed)
                        }
                    },
                    onDragEnd = {
                        if (reordering) {
                            reordering = false
                            reorderEnd()
                        }
                    },
                    onDragCancel = { cancelReorder() },
                ) { _, amount ->
                    if (reordering) reorder(amount.y)
                }
            } finally {
                cancelReorder()
            }
        }
    } else Modifier.cancelTapAfterMovement()

    Box(modifier.then(swipe)) {
        val reveal = offset
        if (reveal != 0f) {
            val adding = reveal > 0
            val color = if (adding) palette.success else palette.destructive
            val armed = abs(reveal) >= threshold
            Box(
                Modifier.matchParentSize().drawWithContent {
                    val left = if (adding) 0f else size.width + reveal
                    val right = if (adding) reveal else size.width
                    clipRect(left = left, right = right) { this@drawWithContent.drawContent() }
                }.clip(Radius.row).background(color.copy(alpha = if (armed) 1f else 0.20f)),
                contentAlignment = if (adding) AbsoluteAlignment.CenterLeft else AbsoluteAlignment.CenterRight,
            ) {
                Icon(
                    if (adding) Lucide.CornerDownRight else Lucide.Trash2,
                    contentDescription = null,
                    tint = if (armed) palette.background else color,
                    modifier = Modifier.padding(horizontal = 16.dp).size(22.dp),
                )
            }
        }
        val slide = Modifier.drawWithContent {
            if (offset == 0f) drawContent() else clipRect { this@drawWithContent.drawContent() }
        }.graphicsLayer { translationX = offset }
        content(slide, body)
    }
}

// Let scroll compete for every move, and prevent a moved finger from becoming a tap.
private fun Modifier.cancelTapAfterMovement() = pointerInput(Unit) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        var moved = false
        do {
            val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: break
            moved = moved || (change.position - down.position).getDistance() > viewConfiguration.touchSlop
            if (moved && !change.pressed) change.consume()
        } while (change.pressed)
    }
}
