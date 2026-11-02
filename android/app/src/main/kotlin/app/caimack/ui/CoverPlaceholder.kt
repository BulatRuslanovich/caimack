// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.toArgb

internal fun sleeveColor(name: String, palette: Palette): Color {
    var hash = 0L
    name.trim().lowercase().codePoints().forEach { hash = (hash * 31 + it) and 0xFFFFFFFFL }
    return palette.sleeves[(hash % palette.sleeves.size).toInt()]
}

internal fun sleeveLetter(name: String): String? = name.codePoints().toArray()
    .firstOrNull { Character.isLetterOrDigit(it) || Character.getType(it) in NUMBER_TYPES }
    ?.let { String(Character.toChars(it)).uppercase() }

private val NUMBER_TYPES = setOf(Character.LETTER_NUMBER.toInt(), Character.OTHER_NUMBER.toInt())

internal fun coverPlaceholder(name: String, palette: Palette, edge: Int = 384): Bitmap {
    val bitmap = Bitmap.createBitmap(edge, edge, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val sleeve = sleeveColor(name, palette)
    val center = edge / 2f
    canvas.drawColor(sleeve.toArgb())
    canvas.drawCircle(center, center, edge * 0.32f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = palette.border.toArgb()
        style = Paint.Style.STROKE
        strokeWidth = edge / 160f
    })
    canvas.drawCircle(center, center, edge * 0.18f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = lerp(sleeve, palette.foreground, 0.18f).toArgb()
    })
    val letter = sleeveLetter(name)
    if (letter != null) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = sleeve.toArgb()
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            textSize = edge * 0.16f
            textAlign = Paint.Align.CENTER
        }
        canvas.drawText(letter, center, center - (paint.ascent() + paint.descent()) / 2, paint)
    } else {
        canvas.drawCircle(center, center, edge * 0.04f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = sleeve.toArgb() })
    }
    return bitmap
}
