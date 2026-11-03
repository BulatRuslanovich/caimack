// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

enum class LibraryDensity(
    val key: String,
    val cardWidth: Dp,
    val shelfWidth: Dp,
    val gap: Dp,
    val rowPadding: Dp,
    val coverSize: Dp,
) {
    Compact("compact", 112.dp, 104.dp, 10.dp, 4.dp, 36.dp),
    Comfortable("comfortable", 140.dp, 132.dp, 12.dp, 6.dp, 40.dp),
    Spacious("spacious", 176.dp, 160.dp, 16.dp, 10.dp, 48.dp);

    companion object {
        fun of(key: String?) = entries.firstOrNull { it.key == key } ?: Comfortable
    }
}

val LocalLibraryDensity = staticCompositionLocalOf { LibraryDensity.Comfortable }
