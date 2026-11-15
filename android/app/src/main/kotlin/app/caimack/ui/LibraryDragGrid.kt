// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitLongPressOrCancellation
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

internal fun orderedLibraryKeys(defaults: List<String>, saved: List<String>): List<String> {
    val present = defaults.toSet()
    return (saved.filter { it in present } + defaults).distinct()
}

internal fun mergeVisibleLibraryOrder(full: List<String>, visible: List<String>): List<String> {
    val changed = visible.toSet()
    val next = visible.iterator()
    return full.map { if (it in changed) next.next() else it }
}

@Composable
internal fun LibraryDragGrid(
    keys: List<String>, grid: Boolean, enabled: Boolean, scopeKey: String,
    canDrop: (String, String) -> Boolean,
    onOrder: suspend (List<String>) -> Unit, onFolder: suspend (String, String) -> Unit,
    empty: @Composable () -> Unit = {},
    content: @Composable (String) -> Unit,
) {
    val state = rememberLazyGridState()
    val density = LocalLibraryDensity.current
    val pixels = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val palette = LocalPalette.current
    val scope = rememberCoroutineScope()
    val latestKeys by rememberUpdatedState(keys)
    val latestOrder by rememberUpdatedState(onOrder)
    val latestFolder by rememberUpdatedState(onFolder)
    val latestDrop by rememberUpdatedState(canDrop)
    var active by remember(scopeKey) { mutableStateOf<String?>(null) }
    var pendingKeys by remember(scopeKey) { mutableStateOf<List<String>?>(null) }
    var landed by remember(scopeKey) { mutableStateOf<String?>(null) }
    val shown = pendingKeys ?: keys
    var pointer by remember { mutableStateOf(Offset.Zero) }
    var grab by remember { mutableStateOf(Offset.Zero) }
    var dragSize by remember { mutableStateOf(IntSize.Zero) }
    var destination by remember { mutableStateOf<String?>(null) }
    var edgeTarget by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    val lift by animateFloatAsState(if (active != null) 1f else 0f, tween(120), label = "library-lift")
    fun reset() { active = null; destination = null; edgeTarget = null }
    fun target() {
        val moving = active ?: return
        edgeTarget = null
        val hit = state.layoutInfo.visibleItemsInfo.firstOrNull {
            pointer.x >= it.offset.x && pointer.x <= it.offset.x + it.size.width &&
                pointer.y >= it.offset.y && pointer.y <= it.offset.y + it.size.height
        } ?: run { destination = null; return }
        val key = hit.key as? String ?: return
        if (key == moving) { destination = null; return }
        val edge = minOf(with(pixels) { 12.dp.toPx() }, hit.size.height * .2f)
        val central = key == "up" || (pointer.y > hit.offset.y + edge && pointer.y < hit.offset.y + hit.size.height - edge)
        if (central && latestDrop(moving, key)) {
            destination = key
        } else {
            destination = null
            if (key.startsWith("folder:")) {
                edgeTarget = key to (pointer.y > hit.offset.y + hit.size.height / 2)
                return
            }
            val from = latestKeys.indexOf(moving)
            val to = latestKeys.indexOf(key)
            if (from >= 0 && to >= 0 && key != "up") {
                // Keep hit targets stationary during the gesture; animate placement on release.
                edgeTarget = key to (from < to)
            }
        }
    }
    val currentTarget by rememberUpdatedState(::target)
    LaunchedEffect(active) {
        if (active == null) return@LaunchedEffect
        val edge = with(pixels) { 64.dp.toPx() }
        while (active != null) {
            val height = state.layoutInfo.viewportSize.height
            val speed = when {
                pointer.y < edge -> -((edge - pointer.y) / edge).coerceIn(0f, 1f) * 22f
                pointer.y > height - edge -> ((pointer.y - height + edge) / edge).coerceIn(0f, 1f) * 22f
                else -> 0f
            }
            if (speed != 0f) { state.scrollBy(speed); currentTarget() }
            delay(16)
        }
    }
    LaunchedEffect(scopeKey, enabled) { reset() }
    LaunchedEffect(scopeKey) { state.scrollToItem(0) }
    Box(Modifier.fillMaxSize().testTag("library-drag-grid").pointerInput(enabled, scopeKey, pendingKeys != null) {
        if (!enabled || pendingKeys != null) return@pointerInput
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val held = awaitLongPressOrCancellation(down.id) ?: return@awaitEachGesture
            val at = held.position
            val hit = state.layoutInfo.visibleItemsInfo.firstOrNull {
                at.x >= it.offset.x && at.x <= it.offset.x + it.size.width &&
                    at.y >= it.offset.y && at.y <= it.offset.y + it.size.height
            }
            val key = hit?.key as? String
            if (hit == null || key !in latestKeys || key == "up") return@awaitEachGesture
            landed = null; active = key; pointer = at; dragSize = hit.size
            grab = at - Offset(hit.offset.x.toFloat(), hit.offset.y.toFloat())
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            try {
                while (true) {
                    // Once held, own the gesture before the child grid can scroll.
                    // Before activation normal taps and scrolling are left untouched.
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                    // Compose sends an already-consumed release when Android cancels touch.
                    if (change.isConsumed) break
                    change.consume()
                    pointer = change.position
                    if (!change.pressed) {
                        val folder = destination
                        var order = latestKeys
                        edgeTarget?.let { (target, after) ->
                            order = order.filter { it != key }.toMutableList().apply {
                                val index = indexOf(target)
                                if (index >= 0) add(index + if (after) 1 else 0, key!!)
                                else add(key!!)
                            }
                        }
                        if (folder != null || order != latestKeys) {
                            landed = key
                            pendingKeys = if (folder != null) latestKeys.filter { it != key } else order
                            scope.launch {
                                try {
                                    if (folder != null) latestFolder(key!!, folder)
                                    else latestOrder(order.filter { it != "up" })
                                } finally { pendingKeys = null }
                            }
                        }
                        break
                    }
                    target()
                }
            } finally { reset() }
        }
    }) {
        LazyVerticalGrid(
            columns = if (grid) GridCells.Adaptive(density.cardWidth) else GridCells.Fixed(1),
            state = state, modifier = Modifier.fillMaxSize(),
            contentPadding = playerContentPadding(start = if (grid) 16.dp else 0.dp, end = if (grid) 16.dp else 0.dp, bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(if (grid) density.gap else 0.dp),
            verticalArrangement = Arrangement.spacedBy(if (grid) 20.dp else 0.dp),
        ) {
            items(shown, key = { it }, span = { if (it == "up") GridItemSpan(maxLineSpan) else GridItemSpan(1) }) { key ->
                Box(Modifier.animateItem(fadeOutSpec = null, placementSpec = if (landed == key) null else spring(stiffness = 350f)).testTag("library-entry:$key")
                    .alpha(if (active == key) 0f else 1f)
                    .drawWithContent {
                        drawContent()
                        edgeTarget?.takeIf { it.first == key }?.let { (_, after) ->
                            val y = if (after) size.height - 2.dp.toPx() else 2.dp.toPx()
                            drawLine(palette.primary, Offset(0f, y), Offset(size.width, y), strokeWidth = 3.dp.toPx())
                        }
                    }
                    .then(if (destination == key) Modifier.border(2.dp, palette.primary, Radius.hero).background(palette.primarySoft, Radius.hero) else Modifier)) {
                    content(key)
                }
            }
            if (keys.none { it != "up" && it != "downloads" && it != "favorites" }) item(span = { GridItemSpan(maxLineSpan) }) { empty() }
        }
        active?.let { key ->
            Box(Modifier.offset { IntOffset((pointer.x - grab.x).roundToInt(), (pointer.y - grab.y).roundToInt()) }
                .size(with(pixels) { dragSize.width.toDp() }, with(pixels) { dragSize.height.toDp() })
                .testTag("library-drag-overlay:$key").zIndex(2f)) {
                Box(Modifier.matchParentSize().padding(horizontal = if (grid) 0.dp else 8.dp)
                    .testTag("library-drag-highlight:$key")
                    .graphicsLayer { alpha = lift; shadowElevation = 18.dp.toPx(); shape = Radius.hero }
                    .background(palette.primarySoft, Radius.hero).border(2.dp, palette.primary, Radius.hero))
                content(key)
            }
        }
    }
}
