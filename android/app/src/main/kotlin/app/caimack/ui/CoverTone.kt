// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.util.LruCache
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import coil3.SingletonImageLoader
import coil3.PlatformContext
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.size.Scale
import coil3.toBitmap
import kotlin.math.atan2
import kotlin.math.cbrt
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

@Immutable
data class CoverTone(val hue: Double, val chroma: Double)

const val TONE_SAMPLE_EDGE = 24

private const val HUE_BINS = 12
private const val MIN_ALPHA = 128
private const val MIN_LIGHTNESS = 0.12
private const val MAX_LIGHTNESS = 0.97
private const val GREY_CHROMA = 0.02
private const val NEUTRAL_CHROMA = 0.025
private const val MAX_CHROMA = 0.3

private fun linear(channel: Int): Double {
    val c = channel / 255.0
    return if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
}

private fun gamma(channel: Double): Float {
    val c = channel.coerceIn(0.0, 1.0)
    return (if (c <= 0.0031308) c * 12.92 else 1.055 * c.pow(1 / 2.4) - 0.055).toFloat()
}

fun oklab(r: Int, g: Int, b: Int): DoubleArray {
    val lr = linear(r)
    val lg = linear(g)
    val lb = linear(b)

    val l = cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    val m = cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    val s = cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)

    return doubleArrayOf(
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    )
}

fun oklch(lightness: Double, chroma: Double, hue: Double, alpha: Float = 1f): Color {
    val radians = Math.toRadians(hue)
    val a = chroma * cos(radians)
    val b = chroma * sin(radians)

    val l = (lightness + 0.3963377774 * a + 0.2158037573 * b).pow(3)
    val m = (lightness - 0.1055613458 * a - 0.0638541728 * b).pow(3)
    val s = (lightness - 0.0894841775 * a - 1.291485548 * b).pow(3)

    return Color(
        red = gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        green = gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        blue = gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
        alpha = alpha,
    )
}

private fun round(value: Double, digits: Int): Double {
    val scale = 10.0.pow(digits)
    return (value * scale).roundToInt() / scale
}

fun coverTone(pixels: IntArray): CoverTone? {
    val weight = DoubleArray(HUE_BINS)
    val sumA = DoubleArray(HUE_BINS)
    val sumB = DoubleArray(HUE_BINS)
    val count = DoubleArray(HUE_BINS)
    var opaque = 0
    var total = 0.0

    for (pixel in pixels) {
        if ((pixel ushr 24) < MIN_ALPHA) continue
        opaque++

        val (l, a, b) = oklab((pixel shr 16) and 0xFF, (pixel shr 8) and 0xFF, pixel and 0xFF)
        if (l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue

        val chroma = hypot(a, b)
        if (chroma < GREY_CHROMA) continue

        val hue = Math.toDegrees(atan2(b, a)) + 360
        val bin = floor(hue / (360.0 / HUE_BINS)).toInt() % HUE_BINS
        weight[bin] += chroma
        sumA[bin] += a * chroma
        sumB[bin] += b * chroma
        count[bin]++
        total += chroma
    }

    if (opaque == 0 || total / opaque < NEUTRAL_CHROMA) return null

    var top = 0
    for (bin in 1 until HUE_BINS) if (weight[bin] > weight[top]) top = bin

    var a = 0.0
    var b = 0.0
    var chromaSum = 0.0
    var pixelsInTop = 0.0
    for (offset in -1..1) {
        val bin = (top + offset + HUE_BINS) % HUE_BINS
        a += sumA[bin]
        b += sumB[bin]
        chromaSum += weight[bin]
        pixelsInTop += count[bin]
    }

    val hue = (Math.toDegrees(atan2(b, a)) + 360) % 360
    val chroma = min(MAX_CHROMA, chromaSum / pixelsInTop)

    return CoverTone(round(hue, 1), round(chroma, 3))
}

fun CoverTone.color(palette: Palette, colorway: Colorway, alpha: Float = 1f): Color {
    val lightness = if (palette.dark) 0.56 else 0.74
    val ceiling = if (palette.dark) 0.16 else 0.11
    val strength = if (colorway == Colorway.Graphite || colorway == Colorway.Studio) 0.5 else 1.0
    return oklch(lightness, min(chroma * 1.5, ceiling) * strength, hue, alpha)
}

val LocalNowPlayingTone = staticCompositionLocalOf { Color.Unspecified }

private val tones by lazy { LruCache<String, Optional>(400) }

private class Optional(val tone: CoverTone?)

private suspend fun loadTone(context: PlatformContext, url: String): CoverTone? {
    tones.get(url)?.let { return it.tone }

    val request = ImageRequest.Builder(context)
        .data(url)
        .size(TONE_SAMPLE_EDGE)
        .scale(Scale.FILL)
        .allowHardware(false)
        .build()
    val result = SingletonImageLoader.get(context).execute(request) as? SuccessResult
    val tone = result?.let {
        val bitmap = it.image.toBitmap()
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        coverTone(pixels)
    }
    tones.put(url, Optional(tone))
    return tone
}

@Composable
fun rememberCoverTone(url: String?): CoverTone? {
    val context = LocalPlatformContext.current
    val tone by produceState(url?.let { tones.get(it) }?.tone, url) {
        value = url?.let { loadTone(context, it) }
    }
    return tone
}

val LocalColorway = staticCompositionLocalOf { Colorway.Coffee }
val LocalToneEnabled = staticCompositionLocalOf { true }

@Composable
fun rememberToneColor(url: String?): Color = animatedTone(rememberCoverTone(url?.takeIf { LocalToneEnabled.current }))

@Composable
fun rememberVividToneColor(urls: List<String?>): Color {
    val context = LocalPlatformContext.current
    val enabled = LocalToneEnabled.current
    val tone by produceState<CoverTone?>(null, urls, enabled) {
        value = if (!enabled) null else urls.filterNotNull().mapNotNull { loadTone(context, it) }.maxByOrNull { it.chroma }
    }
    return animatedTone(tone)
}

@Composable
private fun animatedTone(tone: CoverTone?): Color {
    val target = tone?.color(LocalPalette.current, LocalColorway.current) ?: Color.Transparent
    return animateColorAsState(target, tween(400), label = "tone").value
}
