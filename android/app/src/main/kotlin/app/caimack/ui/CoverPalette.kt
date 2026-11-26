// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import kotlin.math.min

internal fun coverPaletteSeed(tone: PlayerBackdropTone): Color =
    oklch(0.66, min(tone.chroma * 1.4, 0.22), tone.hue)

/** Mirrors the sRGB blends in the web colourway so both themes keep readable surfaces. */
internal fun coverPalette(dark: Boolean, seed: Color): Palette {
    val base = paletteOf(Colorway.Cover, dark)
    fun tint(gray: Int, weight: Float): Color {
        val neutral = gray / 255f * (1f - weight)
        return Color(neutral + seed.red * weight, neutral + seed.green * weight, neutral + seed.blue * weight)
    }

    val primary = tint(if (dark) 0xFF else 0, if (dark) 0.48f else 0.47f)
    val onAccent = if (dark) Color(0xFF171717) else Color(0xFFFAFAFA)
    return base.copy(
        card = if (dark) tint(0x1B, 0.15f) else tint(0xFF, 0.08f),
        popover = if (dark) tint(0x25, 0.16f) else tint(0xFF, 0.04f),
        raised = if (dark) tint(0x2B, 0.17f) else tint(0xFF, 0.05f),
        accent = if (dark) tint(0x34, 0.20f) else tint(0xEC, 0.15f),
        foreground = if (dark) Color(0xFFF5F5F5) else Color(0xFF242424),
        muted = if (dark) Color(0xFFC9C9C9) else Color(0xFF494949),
        faint = if (dark) Color(0xFFBCBCBC) else Color(0xFF555555),
        primary = primary,
        onPrimary = onAccent,
        primarySoft = primary.copy(alpha = if (dark) 0.12f else 0.09f),
        action = tint(if (dark) 0xFF else 0, if (dark) 0.29f else 0.38f),
        onAction = onAccent,
    )
}

@Composable
internal fun rememberSettledPlayerTone(url: String?, loaded: LoadedPlayerTone?): PlayerBackdropTone? {
    var settled by remember { mutableStateOf<PlayerBackdropTone?>(null) }
    if (url != null && loaded == null) return settled
    val tone = loaded?.tone
    SideEffect { settled = tone }
    return tone
}

@Composable
internal fun rememberCoverPalette(dark: Boolean, tone: PlayerBackdropTone?): Palette {
    if (tone == null) return paletteOf(Colorway.Cover, dark)
    val target = remember(tone) { coverPaletteSeed(tone) }
    val duration = if (systemMotionEnabled()) 320 else 0
    val seed by animateColorAsState(target, tween(duration), label = "cover palette")
    return remember(dark, seed) { coverPalette(dark, seed) }
}
