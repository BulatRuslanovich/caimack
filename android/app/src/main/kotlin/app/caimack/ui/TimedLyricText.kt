// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.style.ResolvedTextDirection
import app.caimack.api.LyricLine
import app.caimack.api.LyricWord

internal fun lyricWordProgress(word: LyricWord, positionMs: Long): Float = when {
    positionMs < word.at -> 0f
    word.end <= word.at || positionMs >= word.end -> 1f
    else -> ((positionMs - word.at).toDouble() / (word.end - word.at)).toFloat().coerceIn(0f, 1f)
}

@Composable
internal fun TimedLyricText(
    line: LyricLine,
    positionMs: () -> Long,
    style: TextStyle,
    foreground: Color,
    upcoming: Color,
    modifier: Modifier = Modifier,
) {
    var layout by remember(line) { mutableStateOf<TextLayoutResult?>(null) }
    // Read the frame clock in drawing, keeping the rest of the lyrics out of recomposition.
    Text(
        line.text.ifBlank { "♪" },
        style = style,
        color = upcoming,
        onTextLayout = { layout = it },
        modifier = modifier.drawWithContent {
            drawContent()
            val measured = layout ?: return@drawWithContent
            if (line.words.isEmpty()) return@drawWithContent
            val path = Path()
            var offset = 0
            for (word in line.words) {
                val stop = (offset + word.text.length).coerceAtMost(line.text.length)
                val progress = lyricWordProgress(word, positionMs())
                // Glyph boxes retain normal wrapping, whitespace, ligatures and syllable joins.
                val boxes = (offset until stop).map { it to measured.getBoundingBox(it) }.distinctBy { it.second }
                var remaining = boxes.sumOf { it.second.width.toDouble() }.toFloat() * progress
                boxes.forEach { (character, box) ->
                    val width = remaining.coerceIn(0f, box.width.coerceAtLeast(0f))
                    if (width > 0f) {
                        val rtl = measured.getBidiRunDirection(character) == ResolvedTextDirection.Rtl
                        path.addRect(if (rtl) Rect(box.right - width, box.top, box.right, box.bottom)
                            else Rect(box.left, box.top, box.left + width, box.bottom))
                    }
                    remaining -= box.width
                }
                offset = stop
            }
            clipPath(path) { drawText(measured, color = foreground) }
        },
    )
}
