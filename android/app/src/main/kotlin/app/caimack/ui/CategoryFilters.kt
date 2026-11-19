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
    content: LazyListScope.() -> Unit,
) {
    val scroll = rememberLazyListState()
    LaunchedEffect(selection, showClear) { scroll.animateScrollToItem(0) }
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
