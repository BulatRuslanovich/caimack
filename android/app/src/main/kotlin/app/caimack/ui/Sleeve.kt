// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp

@Composable
fun Sleeve(name: String, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current

    val sleeve = sleeveColor(name, palette)
    val letter = sleeveLetter(name)

    BoxWithConstraints(modifier.background(sleeve), contentAlignment = Alignment.Center) {
        val shown = letter?.takeIf { maxWidth >= 80.dp }
        val letterSize = with(LocalDensity.current) { (maxWidth * 0.16f).toSp() }

        Box(
            Modifier.fillMaxSize(0.64f).border(1.dp, palette.border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier.fillMaxSize(0.56f).background(lerp(sleeve, palette.foreground, 0.18f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (shown != null) {
                    Text(shown, color = sleeve, style = TextStyle(fontFamily = Unbounded, fontSize = letterSize))
                } else {
                    Box(Modifier.fillMaxSize(0.22f).background(sleeve, CircleShape))
                }
            }
        }
    }
}
