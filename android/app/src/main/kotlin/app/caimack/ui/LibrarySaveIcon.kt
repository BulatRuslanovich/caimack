// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Keep one mark on screen while its strokes become a check, rather than swapping icons. */
@Composable
internal fun LibrarySaveIcon(saved: Boolean, label: String) {
    val palette = LocalPalette.current
    val motion = systemMotionEnabled()
    val progress by animateFloatAsState(if (saved) 1f else 0f, tween(320), label = "library check")
    val bounce = remember { Animatable(1f) }
    val ripple = remember { Animatable(1f) }
    val previous = remember { mutableStateOf(saved) }
    LaunchedEffect(saved) {
        val changed = previous.value != saved
        previous.value = saved
        if (changed && motion) {
            if (saved) launch {
                ripple.snapTo(0f)
                ripple.animateTo(1f, tween(540))
            }
            bounce.animateTo(0.82f, tween(80))
            bounce.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = 500f))
        } else {
            bounce.snapTo(1f)
            ripple.snapTo(1f)
        }
    }
    Canvas(Modifier.size(24.dp).semantics { contentDescription = label }) {
        val unit = size.minDimension / 24f
        val color = lerp(palette.muted, palette.primary, progress)
        if (saved && ripple.value < 1f) {
            drawCircle(palette.primary.copy(alpha = (1f - ripple.value) * 0.5f),
                radius = (9f + 3f * ripple.value) * unit, style = Stroke(unit))
        }
        scale(bounce.value) {
            drawCircle(palette.primary.copy(alpha = progress), radius = 9f * unit)
            drawCircle(color, radius = 9f * unit, style = Stroke(2f * unit))
            val ink = lerp(palette.muted, palette.onPrimary, progress)
            fun point(x: Float, y: Float) = Offset(x * unit, y * unit)
            if (progress < 1f) drawLine(
                ink.copy(alpha = 1f - progress), point(12f, 8f), point(12f, 16f),
                strokeWidth = 2f * unit, cap = StrokeCap.Round,
            )
            val mark = Path().apply {
                moveTo((8f - progress) * unit, 12f * unit)
                lineTo((12f - 1.5f * progress) * unit, (12f + 3.5f * progress) * unit)
                lineTo((16f + progress) * unit, (12f - 3f * progress) * unit)
            }
            drawPath(mark, ink, style = Stroke(2f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}
