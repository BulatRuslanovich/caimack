// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

internal val LocalMiniPlayerInset = staticCompositionLocalOf { 0.dp }

/** Scroll padding, rather than viewport padding, keeps the last item above the floating player. */
@Composable
internal fun playerContentPadding(
    start: Dp = 0.dp,
    top: Dp = 0.dp,
    end: Dp = 0.dp,
    bottom: Dp = 0.dp,
): PaddingValues = PaddingValues(start, top, end, bottom + LocalMiniPlayerInset.current)

@Composable
internal fun PlayerScaffold(
    modifier: Modifier = Modifier,
    topBar: @Composable () -> Unit = {},
    bottomBar: @Composable () -> Unit,
    miniPlayer: @Composable () -> Unit,
    snackbarHost: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    var playerHeight by remember { mutableIntStateOf(0) }
    val playerInset = with(LocalDensity.current) { playerHeight.toDp() }
    val direction = LocalLayoutDirection.current

    Scaffold(
        modifier = modifier,
        containerColor = LocalPalette.current.background,
        contentWindowInsets = WindowInsets(0),
        topBar = topBar,
        bottomBar = {
            Column {
                Box(Modifier.onSizeChanged { playerHeight = it.height }) { miniPlayer() }
                bottomBar()
            }
        },
        snackbarHost = snackbarHost,
    ) { padding ->
        // Keep the navigation bar inset, but let the viewport draw through the player's
        // transparent margins and rounded corners. Snackbars still clear both bars.
        val viewportPadding = PaddingValues(
            start = padding.calculateStartPadding(direction),
            top = padding.calculateTopPadding(),
            end = padding.calculateEndPadding(direction),
            bottom = (padding.calculateBottomPadding() - playerInset).coerceAtLeast(0.dp),
        )
        CompositionLocalProvider(LocalMiniPlayerInset provides playerInset) {
            content(viewportPadding)
        }
    }
}
