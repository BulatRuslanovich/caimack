// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable
fun Toggle(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val palette = LocalPalette.current
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        colors = SwitchDefaults.colors(
            checkedTrackColor = palette.primary,
            checkedThumbColor = palette.onPrimary,
            uncheckedTrackColor = palette.raised,
            uncheckedBorderColor = palette.controlBorder,
            uncheckedThumbColor = palette.muted,
        ),
    )
}
@Composable
fun NowPlayingBars(color: Color, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "now-playing")
    val bars = NOW_PLAYING_RHYTHM.map { (period, rest) ->
        transition.animateFloat(
            initialValue = 0.25f,
            targetValue = rest,
            animationSpec = infiniteRepeatable(tween(period, easing = LinearEasing), RepeatMode.Reverse),
            label = "bar",
        )
    }
    Canvas(modifier.size(width = 14.dp, height = 12.dp)) {
        val width = 3.dp.toPx()
        val gap = (size.width - width * bars.size) / (bars.size - 1)
        bars.forEachIndexed { index, bar ->
            val height = size.height * bar.value
            drawRoundRect(
                color,
                topLeft = Offset(index * (width + gap), size.height - height),
                size = Size(width, height),
                cornerRadius = CornerRadius(1.dp.toPx()),
            )
        }
    }
}
private val NOW_PLAYING_RHYTHM = listOf(900 to 0.55f, 700 to 1f, 1100 to 0.75f)
@Composable
fun BufferingRing(buffering: Boolean, modifier: Modifier = Modifier) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(buffering) {
        shown = false
        if (buffering) {
            delay(BUFFERING_DELAY_MS)
            shown = true
        }
    }
    if (shown) CircularProgressIndicator(modifier, color = LocalPalette.current.primary, strokeWidth = 2.dp, trackColor = Color.Transparent)
}
private const val BUFFERING_DELAY_MS = 300L
@Composable
fun Tabs(
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(horizontal = 16.dp),
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val palette = LocalPalette.current
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind {
                val line = 1.dp.toPx()
                drawRect(palette.border, topLeft = Offset(0f, size.height - line), size = Size(size.width, line))
            }
            .padding(contentPadding),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).horizontalScroll(rememberScrollState()).selectableGroup(),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
            content = content,
        )
        trailing?.invoke()
    }
}
@Composable
fun Tab(label: String, active: Boolean, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Box(
        Modifier
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .selectable(selected = active, role = Role.Tab, onClick = onClick)
            .drawBehind {
                if (!active) return@drawBehind
                val line = 2.dp.toPx()
                drawRect(palette.primary, topLeft = Offset(0f, size.height - line), size = Size(size.width, line))
            }
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = Type.small.copy(fontWeight = FontWeight.Medium),
            color = if (active) palette.foreground else palette.muted,
            textAlign = TextAlign.Center, maxLines = 1)
    }
}
@Composable
fun Chip(
    label: String,
    active: Boolean,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val palette = LocalPalette.current
    val tint = if (active) palette.primary else palette.muted
    Row(
        modifier
            .heightIn(min = 48.dp)
            .clip(CircleShape)
            .background(if (active) palette.primarySoft else palette.raised)
            .then(if (active) Modifier.border(1.dp, palette.primary, CircleShape) else Modifier)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))
        Text(label, style = Type.small.copy(fontWeight = FontWeight.Medium), color = tint)
    }
}
