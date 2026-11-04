// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

private const val NOW_PLAYING_COVER = "now-playing-cover"
internal const val NOW_PLAYING_TRANSITION_MS = 440

@OptIn(ExperimentalSharedTransitionApi::class)
@Immutable
class NowPlayingTransition(val scope: SharedTransitionScope, val full: Boolean)

val LocalNowPlayingTransition = staticCompositionLocalOf<NowPlayingTransition?> { null }

val LocalFullPlayerVisibility = staticCompositionLocalOf<AnimatedVisibilityScope?> { null }

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun Modifier.nowPlayingCover(visibility: AnimatedVisibilityScope?): Modifier {
    val transition = LocalNowPlayingTransition.current ?: return this
    if (visibility == null) return this
    return with(transition.scope) {
        this@nowPlayingCover.sharedElement(
            rememberSharedContentState(NOW_PLAYING_COVER),
            visibility,
            boundsTransform = { _, _ -> tween(NOW_PLAYING_TRANSITION_MS, easing = CubicBezierEasing(0.22f, 0.7f, 0.2f, 1f)) },
        )
    }
}
