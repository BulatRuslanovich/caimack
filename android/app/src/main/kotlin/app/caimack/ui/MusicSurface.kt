// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** The same quiet, edged cabinet used by the web player and controls. */
internal fun Modifier.musicSurface(palette: Palette): Modifier =
    shadow(12.dp, Radius.hero, clip = false,
        ambientColor = Color.Black.copy(alpha = 0.12f),
        spotColor = Color.Black.copy(alpha = 0.16f))
        .clip(Radius.hero)
        .background(palette.cabinet)
        .border(1.dp, palette.cabinetEdge, Radius.hero)
