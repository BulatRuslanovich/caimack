// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import app.caimack.R
import java.io.File
import kotlin.math.max

enum class ShareFormat(val width: Int, val height: Int) {
    Story(1080, 1920),
    Square(1080, 1080),
}

data class ShareCardInput(
    val title: String,
    val artist: String,
    val album: String?,
    val cover: Bitmap?,
    val lyric: String?,
    val peaks: List<Int>,
    val progress: Float,
    val caption: String,
)

fun wrapLines(measure: (String) -> Float, text: String, maxWidth: Float, maxLines: Int): List<String> {
    val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val lines = mutableListOf<String>()
    var line = ""

    for (word in words) {
        val candidate = if (line.isEmpty()) word else "$line $word"
        if (measure(candidate) <= maxWidth || line.isEmpty()) {
            line = candidate
            continue
        }
        lines += line
        line = word
    }
    if (line.isNotEmpty()) lines += line
    if (lines.size <= maxLines) return lines

    val kept = lines.take(maxLines).toMutableList()
    var last = kept[maxLines - 1] + "…"
    while (last.length > 1 && measure(last) > maxWidth) last = last.dropLast(2).trimEnd() + "…"
    kept[maxLines - 1] = last
    return kept
}

fun renderShareCard(context: Context, input: ShareCardInput, format: ShareFormat, palette: Palette): Bitmap {
    val width = format.width
    val height = format.height
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val background = palette.background.toArgb()

    val display = ResourcesCompat.getFont(context, R.font.unbounded_medium) ?: Typeface.DEFAULT_BOLD
    val sans = ResourcesCompat.getFont(context, R.font.onest_variable) ?: Typeface.DEFAULT

    canvas.drawColor(background)
    input.cover?.let { blurredBackdrop(canvas, it, width, height) }

    canvas.drawRect(
        0f, 0f, width.toFloat(), height.toFloat(),
        Paint().apply {
            shader = LinearGradient(
                0f, 0f, 0f, height.toFloat(),
                intArrayOf(withAlpha(background, 0.45f), withAlpha(background, 0.62f), withAlpha(background, 0.92f)),
                floatArrayOf(0f, 0.55f, 1f),
                Shader.TileMode.CLAMP,
            )
        },
    )

    val story = format == ShareFormat.Story
    val margin = 96f
    val cover = if (story) 640f else 420f
    val coverX = margin
    val coverY = if (story) 300f else margin + 20

    drawVinyl(canvas, coverX + cover * 0.82f, coverY + cover / 2, cover * 0.47f, input.cover, palette)

    val jacket = RectF(coverX, coverY, coverX + cover, coverY + cover)
    canvas.drawRoundRect(
        jacket, 18f, 18f,
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = background
            setShadowLayer(60f, 0f, 24f, 0x80000000.toInt())
        },
    )
    canvas.save()
    canvas.clipPath(android.graphics.Path().apply { addRoundRect(jacket, 18f, 18f, android.graphics.Path.Direction.CW) })
    if (input.cover != null) {
        canvas.drawBitmap(input.cover, coverCrop(input.cover), jacket, Paint(Paint.FILTER_BITMAP_FLAG))
    } else {
        canvas.drawRect(jacket, Paint().apply { color = withAlpha(palette.muted.toArgb(), 0.3f) })
    }
    canvas.restore()

    val textX = margin
    val textWidth = width - margin * 2
    var cursor = if (story) coverY + cover + 150 else coverY + cover + 110

    val title = text(display, if (story) 84f else 64f, palette.foreground.toArgb())
    wrapLines({ title.measureText(it) }, input.title, textWidth, 2).forEach {
        canvas.drawText(it, textX, cursor, title)
        cursor += title.textSize * 1.12f
    }

    val byline = text(sans, if (story) 42f else 34f, palette.muted.toArgb(), weight = 500)
    wrapLines({ byline.measureText(it) }, listOfNotNull(input.artist, input.album).joinToString(" — "), textWidth, 2).forEach {
        canvas.drawText(it, textX, cursor, byline)
        cursor += if (story) 54f else 44f
    }

    if (input.lyric != null && story) {
        cursor += 70
        val lyric = text(display, 52f, palette.primary.toArgb())
        wrapLines({ lyric.measureText(it) }, "“${input.lyric}”", textWidth, 3).forEach {
            canvas.drawText(it, textX, cursor, lyric)
            cursor += 66
        }
    }

    if (input.peaks.isNotEmpty()) {
        val waveHeight = if (story) 120f else 80f
        val waveY = if (story) height - 330f else height - 250f
        val bar = textWidth / input.peaks.size
        val played = Paint().apply { color = palette.primary.toArgb() }
        val rest = Paint().apply { color = withAlpha(palette.foreground.toArgb(), 0.28f) }
        input.peaks.forEachIndexed { index, peak ->
            val h = max(0.06f, peak / 255f) * waveHeight
            val x = textX + index * bar
            canvas.drawRect(
                x + bar * 0.18f, waveY + (waveHeight - h) / 2, x + bar * 0.82f, waveY + (waveHeight + h) / 2,
                if ((index + 0.5f) / input.peaks.size <= input.progress) played else rest,
            )
        }
    }

    canvas.drawText("Caimack", textX, height - 96f, text(display, 34f, palette.foreground.toArgb()))
    val caption = text(sans, 30f, palette.muted.toArgb(), weight = 500).apply { textAlign = Paint.Align.RIGHT }
    canvas.drawText(input.caption, width - margin, height - 96f, caption)

    return bitmap
}

private fun text(typeface: Typeface, size: Float, color: Int, weight: Int? = null) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.typeface = typeface
    textSize = size
    this.color = color
    weight?.let { fontVariationSettings = "'wght' $it" }
}

private fun withAlpha(color: Int, alpha: Float) = (color and 0x00FFFFFF) or ((alpha * 255).toInt() shl 24)

internal fun coverCrop(image: Bitmap): Rect {
    val edge = minOf(image.width, image.height)
    val left = (image.width - edge) / 2
    val top = (image.height - edge) / 2
    return Rect(left, top, left + edge, top + edge)
}

private fun blurredBackdrop(canvas: Canvas, image: Bitmap, width: Int, height: Int) {
    var small = image
    while (small.width > 64) small = Bitmap.createScaledBitmap(small, small.width / 2, max(1, small.height / 2), true)
    var blurred = boxBlur(Bitmap.createScaledBitmap(small, 32, max(1, 32 * height / width), true), passes = 3)
    while (blurred.width * 3 < width) {
        blurred = Bitmap.createScaledBitmap(blurred, blurred.width * 3, blurred.height * 3, true)
    }
    canvas.drawBitmap(
        blurred,
        null,
        RectF(-width * 0.05f, -height * 0.05f, width * 1.05f, height * 1.05f),
        Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG),
    )
}

private fun boxBlur(source: Bitmap, passes: Int): Bitmap {
    val w = source.width
    val h = source.height
    var pixels = IntArray(w * h).also { source.getPixels(it, 0, w, 0, 0, w, h) }

    repeat(passes) {
        val next = IntArray(w * h)
        for (y in 0 until h) {
            for (x in 0 until w) {
                var r = 0
                var g = 0
                var b = 0
                var count = 0
                for (dy in -1..1) {
                    for (dx in -1..1) {
                        val px = (x + dx).coerceIn(0, w - 1)
                        val py = (y + dy).coerceIn(0, h - 1)
                        val color = pixels[py * w + px]
                        r += color shr 16 and 0xFF
                        g += color shr 8 and 0xFF
                        b += color and 0xFF
                        count++
                    }
                }
                next[y * w + x] = (0xFF shl 24) or (r / count shl 16) or (g / count shl 8) or (b / count)
            }
        }
        pixels = next
    }

    return Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
}

internal fun drawVinyl(canvas: Canvas, centreX: Float, centreY: Float, radius: Float, image: Bitmap?, palette: Palette) {
    canvas.drawCircle(
        centreX, centreY, radius,
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFF121010.toInt()
            setShadowLayer(40f, 0f, 0f, 0x8C000000.toInt())
        },
    )

    val groove = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1.2f
    }
    var ring = radius * 0.36f
    while (ring < radius * 0.97f) {
        groove.color = if (ring % 15 < 5) 0x0DFFFFFF else 0x59000000
        canvas.drawCircle(centreX, centreY, ring, groove)
        ring += 5
    }

    val label = radius * 0.33f
    val area = RectF(centreX - label, centreY - label, centreX + label, centreY + label)
    canvas.save()
    canvas.clipPath(android.graphics.Path().apply { addCircle(centreX, centreY, label, android.graphics.Path.Direction.CW) })
    if (image != null) canvas.drawBitmap(image, coverCrop(image), area, Paint(Paint.FILTER_BITMAP_FLAG))
    else canvas.drawCircle(centreX, centreY, label, Paint().apply { color = palette.primary.toArgb() })
    canvas.restore()

    canvas.drawCircle(centreX, centreY, label * 0.12f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = palette.background.toArgb() })
}

private fun fileName(title: String, artist: String) = "$title — $artist".replace(Regex("[\\\\/:*?\"<>|]"), "_") + ".png"

fun shareCard(context: Context, card: Bitmap, title: String, artist: String) {
    val folder = File(context.cacheDir, "share").apply { mkdirs() }
    folder.listFiles()?.forEach { it.delete() }
    val file = File(folder, fileName(title, artist))
    file.outputStream().use { card.compress(Bitmap.CompressFormat.PNG, 100, it) }

    val uri = FileProvider.getUriForFile(context, "${context.packageName}.share", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

fun saveCard(context: Context, card: Bitmap, title: String, artist: String): Boolean {
    val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, fileName(title, artist))
        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Caimack")
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
    return resolver.openOutputStream(uri)?.use { card.compress(Bitmap.CompressFormat.PNG, 100, it) } ?: false
}
