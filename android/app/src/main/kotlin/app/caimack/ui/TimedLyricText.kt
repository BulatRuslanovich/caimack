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
import androidx.compose.ui.draw.drawWithCache
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
    val measured = layout
    val geometry = remember(line, measured) {
        // Geometry belongs to the text layout, not the playback clock or recomposition.
        var offset = 0
        if (measured == null) emptyList() else line.words.map { word ->
            val stop = (offset + word.text.length).coerceAtMost(line.text.length)
            val boxes = (offset until stop).map { character ->
                val box = measured.getBoundingBox(character)
                box to (measured.getBidiRunDirection(character) == ResolvedTextDirection.Rtl)
            }.distinctBy { it.first }
            offset = stop
            WordGeometry(word, boxes, boxes.sumOf { it.first.width.toDouble() }.toFloat(),
                Path().apply { boxes.forEach { addRect(it.first) } })
        }
    }
    // Read the frame clock in drawing, keeping the rest of the lyrics out of recomposition.
    Text(
        line.text.ifBlank { "♪" },
        style = style,
        color = upcoming,
        onTextLayout = { layout = it },
        modifier = modifier.drawWithCache {
            val path = Path()
            onDrawWithContent {
                drawContent()
                if (measured == null || geometry.isEmpty()) return@onDrawWithContent
                val position = positionMs()
                path.reset()
                for (word in geometry) {
                    val progress = lyricWordProgress(word.word, position)
                    if (progress == 0f) continue
                    if (progress == 1f) { path.addPath(word.full); continue }
                    var remaining = word.width * progress
                    for ((box, rtl) in word.boxes) {
                        val width = remaining.coerceIn(0f, box.width.coerceAtLeast(0f))
                        if (width > 0f) path.addRect(if (rtl) Rect(box.right - width, box.top, box.right, box.bottom)
                            else Rect(box.left, box.top, box.left + width, box.bottom))
                        remaining -= box.width
                    }
                }
                clipPath(path) { drawText(measured, color = foreground) }
            }
        },
    )
}

private class WordGeometry(val word: LyricWord, val boxes: List<Pair<Rect, Boolean>>, val width: Float, val full: Path)
