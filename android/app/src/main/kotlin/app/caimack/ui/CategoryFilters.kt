// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.layout
import kotlin.math.roundToInt
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.caimack.R

@Composable
internal fun CategoryFilterRow(
    selection: Any?,
    showClear: Boolean,
    onClear: () -> Unit,
    scroll: LazyListState = rememberLazyListState(),
    autoReset: Boolean = true,
    content: LazyListScope.() -> Unit,
) {
    if (autoReset) LaunchedEffect(selection, showClear) { scroll.animateScrollToItem(0) }
    LazyRow(
        state = scroll,
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showClear) item(key = "clear") {
            IconButton(onClick = onClear, modifier = categoryAnimation()) {
                Icon(Lucide.X, stringResource(R.string.collection_clear_filter), tint = LocalPalette.current.muted)
            }
        }
        content()
    }
}

@Composable
internal fun LazyItemScope.CategoryFilter(
    label: Int,
    active: Boolean,
    modifier: Modifier = categoryAnimation(),
    onClick: () -> Unit,
) {
    val palette = LocalPalette.current
    FilterChip(
        modifier = modifier,
        selected = active,
        onClick = onClick,
        label = { Text(stringResource(label)) },
        shape = CircleShape,
        border = null,
        colors = FilterChipDefaults.filterChipColors(
            containerColor = palette.raised, labelColor = palette.foreground,
            selectedContainerColor = palette.selection, selectedLabelColor = palette.primary,
        ),
    )
}

private fun LazyItemScope.categoryAnimation() = Modifier.animateItem(
    fadeInSpec = tween(220),
    placementSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow),
    fadeOutSpec = tween(140),
)

@Composable
internal fun LazyItemScope.HomeCategory(
    label: Int,
    selected: Boolean,
    downloaded: Boolean,
    expansion: Float,
    downloadEmphasis: Float,
    select: () -> Unit,
    toggleDownloads: () -> Unit,
) {
    val palette = LocalPalette.current
    val categoryTint = lerp(palette.raised, palette.selection, expansion)
    val downloadTint = lerp(palette.raised, categoryTint, downloadEmphasis)
    Row(
        categoryAnimation().drawBehind {
            val height = FilterChipDefaults.Height.toPx()
            drawRoundRect(
                brush = Brush.horizontalGradient(
                    0f to categoryTint, .42f to categoryTint, .66f to downloadTint, 1f to downloadTint,
                ),
                topLeft = Offset(0f, (size.height - height) / 2),
                size = Size(size.width, height),
                cornerRadius = CornerRadius(height / 2),
            )
        },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HomeSegment(label, selected, lerp(palette.foreground, palette.primary, expansion), select)
        if (selected || expansion > 0f) {
            Box(Modifier.clipToBounds().layout { measurable, constraints ->
                val child = measurable.measure(constraints)
                layout((child.width * expansion).roundToInt(), child.height) { child.placeRelative(0, 0) }
            }) {
                HomeSegment(R.string.collection_downloaded, downloaded,
                    lerp(palette.foreground, palette.primary, downloadEmphasis).copy(alpha = expansion),
                    toggleDownloads)
            }
        }
    }
}

@Composable
private fun HomeSegment(label: Int, selected: Boolean, color: Color, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(stringResource(label), maxLines = 1) },
        shape = CircleShape,
        border = null,
        colors = FilterChipDefaults.filterChipColors(
            containerColor = Color.Transparent, selectedContainerColor = Color.Transparent,
            labelColor = color, selectedLabelColor = color,
        ),
    )
}
