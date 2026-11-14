// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

// Empirical approximation, not Spotify internals. Mirror frontend/playerBackdrop.ts.
internal object PlayerBackdropSettings {
    const val sampleEdge = 64
    const val clusters = 12
    const val iterations = 12
    const val quantizationBits = 4
    const val minimumAlpha = 128
    const val minimumShare = 0.015
    const val minimumLightness = 0.12
    const val maximumLightness = 0.94
    const val minimumChroma = 0.02
    const val saturationWeight = 0.25
    const val lightnessWeight = 0.2
    const val preferredLightness = 0.55
    const val hueContrast = 1.35
    const val familyHueRadius = 25.0
    const val familyChromaRatio = 0.75
    const val surfaceMinimum = 0.28
    const val surfaceMaximum = 0.44
    const val neutralLightness = 0.44
    const val gradientDrop = 0.09
    const val chromaGain = 1.6
    const val chromaSlope = 9.0
    const val minimumChromaGain = 0.72
    const val maximumChromaGain = 1.5
    const val gamutSafety = 0.96
    const val transitionMs = 900
    const val loadTimeoutMs = 8_000L
    const val cacheEntries = 128
}

internal data class PlayerBackdropTone(val lightness: Double, val chroma: Double, val hue: Double)
internal data class PlayerBackdropSurface(val top: Int, val bottom: Int)
private data class ColorPoint(val rgb: DoubleArray, val lab: DoubleArray, val count: Int)
private class ColorBucket(var count: Int = 0, val rgb: DoubleArray = DoubleArray(3), val lab: DoubleArray = DoubleArray(3))
private data class PlayerSwatch(val rgb: DoubleArray, val share: Double, val tone: PlayerBackdropTone)
private fun distance(a: DoubleArray, b: DoubleArray) = a.indices.sumOf { (a[it] - b[it]).pow(2) }

/** Deterministic, population-weighted k-means. No Android bitmap work or frame state here. */
internal fun playerBackdropTone(pixels: IntArray): PlayerBackdropTone? {
    val s = PlayerBackdropSettings
    val bins = sortedMapOf<Int, ColorBucket>()
    var count = 0
    val shift = 8 - s.quantizationBits
    for (pixel in pixels) {
        if ((pixel ushr 24) < s.minimumAlpha) continue
        val rgb = intArrayOf((pixel shr 16) and 255, (pixel shr 8) and 255, pixel and 255)
        val key = ((rgb[0] shr shift) shl (s.quantizationBits * 2)) or ((rgb[1] shr shift) shl s.quantizationBits) or (rgb[2] shr shift)
        val bin = bins.getOrPut(key) { ColorBucket() }
        bin.count++
        for (j in 0..2) bin.rgb[j] += rgb[j]
        count++
    }
    val points = bins.values.map { b ->
        val rgb = b.rgb.map { it / b.count }.toDoubleArray()
        ColorPoint(rgb, oklab(rgb[0], rgb[1], rgb[2]), b.count)
    }.sortedByDescending { it.count }
    if (points.isEmpty()) return null
    val centers = mutableListOf(points[0].lab)
    while (centers.size < minOf(s.clusters, points.size)) {
        var best = points[0]
        var score = 0.0
        for (point in points) {
            val candidate = centers.minOf { distance(point.lab, it) } * sqrt(point.count.toDouble())
            if (candidate > score) { best = point; score = candidate }
        }
        if (score < 1e-10) break
        centers.add(best.lab)
    }
    var buckets = emptyList<ColorBucket>()
    repeat(s.iterations) {
        buckets = centers.map { ColorBucket() }
        for (point in points) {
            var at = 0
            var closest = Double.POSITIVE_INFINITY
            centers.forEachIndexed { i, center ->
                val delta = distance(point.lab, center)
                if (delta < closest) { closest = delta; at = i }
            }
            val bucket = buckets[at]
            bucket.count += point.count
            for (j in 0..2) {
                bucket.rgb[j] += point.rgb[j] * point.count
                bucket.lab[j] += point.lab[j] * point.count
            }
        }
        buckets.forEachIndexed { i, bucket ->
            if (bucket.count > 0) centers[i] = bucket.lab.map { it / bucket.count }.toDoubleArray()
        }
    }
    val swatches = buckets.filter { it.count > 0 }.map { b ->
        val rgb = b.rgb.map { it / b.count }.toDoubleArray()
        val (l, a, blue) = oklab(rgb[0], rgb[1], rgb[2])
        PlayerSwatch(rgb, b.count.toDouble() / count, PlayerBackdropTone(l, hypot(a, blue), (Math.toDegrees(atan2(blue, a)) + 360) % 360))
    }.sortedByDescending { it.share }
    var selected: PlayerSwatch? = null
    var bestScore = 0.0
    for (swatch in swatches) {
        val t = swatch.tone
        if (swatch.share < s.minimumShare || t.lightness < s.minimumLightness || t.lightness > s.maximumLightness || t.chroma < s.minimumChroma) continue
        val saturation = minOf(t.chroma / 0.2, 1.0)
        val lightness = 1 - abs(t.lightness - s.preferredLightness) / s.preferredLightness
        val score = swatch.share * (1 - s.saturationWeight + s.saturationWeight * saturation) * (1 - s.lightnessWeight + s.lightnessWeight * lightness)
        if (score > bestScore) { selected = swatch; bestScore = score }
    }
    val swatch = selected ?: return null
    val family = swatches.filter {
        it.tone.chroma >= swatch.tone.chroma * s.familyChromaRatio &&
            abs(((it.tone.hue - swatch.tone.hue + 540) % 360) - 180) <= s.familyHueRadius
    }
    val share = family.sumOf { it.share }
    val rgb = (0..2).map { channel ->
        (family.sumOf { it.rgb[channel] * it.share } / share / 255).pow(s.hueContrast) * 255
    }
    val chroma = family.sumOf { it.tone.chroma * it.share } / share
    val (_, a, b) = oklab(rgb[0], rgb[1], rgb[2])
    return swatch.tone.copy(chroma = chroma, hue = (Math.toDegrees(atan2(b, a)) + 360) % 360)
}

private fun playerLinearRgb(t: PlayerBackdropTone): DoubleArray {
    val a = t.chroma * cos(Math.toRadians(t.hue))
    val b = t.chroma * sin(Math.toRadians(t.hue))
    val x = (t.lightness + 0.3963377774 * a + 0.2158037573 * b).pow(3)
    val y = (t.lightness - 0.1055613458 * a - 0.0638541728 * b).pow(3)
    val z = (t.lightness - 0.0894841775 * a - 1.291485548 * b).pow(3)
    return doubleArrayOf(4.0767416621*x-3.3077115913*y+0.2309699292*z, -1.2684380046*x+2.6097574011*y-0.3413193965*z, -0.0041960863*x-0.7034186147*y+1.707614701*z)
}

private fun gamutChroma(tone: PlayerBackdropTone): Double {
    if (playerLinearRgb(tone).all { it in 0.0..1.0 }) return tone.chroma
    var low = 0.0
    var high = tone.chroma
    repeat(16) {
        val chroma = (low + high) / 2
        if (playerLinearRgb(tone.copy(chroma = chroma)).all { it in 0.0..1.0 }) low = chroma else high = chroma
    }
    return low * PlayerBackdropSettings.gamutSafety
}

private fun playerRgb(tone: PlayerBackdropTone): Int {
    val rgb = playerLinearRgb(tone).map { v ->
        ((if (v <= 0.0031308) v * 12.92 else 1.055 * v.pow(1 / 2.4) - 0.055).coerceIn(0.0, 1.0) * 255).roundToInt()
    }
    return (255 shl 24) or (rgb[0] shl 16) or (rgb[1] shl 8) or rgb[2]
}

internal fun playerBackdropSurface(tone: PlayerBackdropTone?): PlayerBackdropSurface {
    val s = PlayerBackdropSettings
    val lightness = tone?.lightness?.coerceIn(s.surfaceMinimum, s.surfaceMaximum) ?: s.neutralLightness
    val chroma = tone?.let { it.chroma * (s.chromaGain - s.chromaSlope * it.chroma).coerceIn(s.minimumChromaGain, s.maximumChromaGain) } ?: 0.0
    val top = PlayerBackdropTone(lightness, chroma, tone?.hue ?: 0.0)
    val bottom = top.copy(lightness = maxOf(s.surfaceMinimum, lightness - s.gradientDrop))
    val safe = minOf(gamutChroma(top), gamutChroma(bottom))
    return PlayerBackdropSurface(playerRgb(top.copy(chroma = safe)), playerRgb(bottom.copy(chroma = safe)))
}
