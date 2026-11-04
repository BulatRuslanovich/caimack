// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.ln1p
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

data class Spot(val x: Float, val y: Float)

data class MapView(val k: Float, val panX: Float, val panY: Float)

data class Bounds(val minX: Float, val minY: Float, val maxX: Float, val maxY: Float)

const val MIN_ZOOM = 0.8f
const val MAX_ZOOM = 40f

private const val FIT_PADDING_PX = 56f
private const val FIT_PADDING_SHARE = 0.08f
private const val MIN_FIT_SPAN = 0.05f
private const val LINK_REACH = 2.5f

fun toScreen(spot: Spot, view: MapView, base: Float) =
    Spot(spot.x * base * view.k + view.panX, spot.y * base * view.k + view.panY)

fun toMap(screen: Spot, view: MapView, base: Float) =
    Spot((screen.x - view.panX) / (base * view.k), (screen.y - view.panY) / (base * view.k))

fun zoomAt(view: MapView, factor: Float, at: Spot): MapView {
    val k = (view.k * factor).coerceIn(MIN_ZOOM, MAX_ZOOM)
    val applied = k / view.k
    return MapView(k, at.x - (at.x - view.panX) * applied, at.y - (at.y - view.panY) * applied)
}

fun centreOn(spot: Spot, k: Float, width: Float, height: Float): MapView {
    val base = min(width, height)
    return MapView(k, width / 2 - spot.x * base * k, height / 2 - spot.y * base * k)
}

fun boundsOf(spots: List<Spot>): Bounds? {
    if (spots.isEmpty()) return null
    return Bounds(spots.minOf { it.x }, spots.minOf { it.y }, spots.maxOf { it.x }, spots.maxOf { it.y })
}

fun fitView(width: Float, height: Float, bounds: Bounds?): MapView {
    val base = min(width, height)
    if (bounds == null) return MapView(1f, (width - base) / 2, (height - base) / 2)

    val spanX = max(bounds.maxX - bounds.minX, MIN_FIT_SPAN) * base
    val spanY = max(bounds.maxY - bounds.minY, MIN_FIT_SPAN) * base
    val padding = min(FIT_PADDING_PX, base * FIT_PADDING_SHARE)
    val k = min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY).coerceIn(MIN_ZOOM, MAX_ZOOM)

    return centreOn(Spot((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2), k, width, height)
}

fun gridStep(k: Float): Float = 0.1f / 2f.pow(max(0f, floor(ln(k) / ln(2f))))

fun playsLevel(plays: Int, maxPlays: Int): Float =
    if (plays <= 0 || maxPlays <= 0) 0f else (ln1p(plays.toDouble()) / ln1p(maxPlays.toDouble())).toFloat()

fun constellation(spots: List<Spot>, neighbours: Int = 2): List<Pair<Int, Int>> {
    if (spots.size < 2) return emptyList()

    val nearest = spots.mapIndexed { i, spot ->
        spots.indices
            .filter { it != i }
            .map { j -> j to (spots[j].x - spot.x).pow(2) + (spots[j].y - spot.y).pow(2) }
            .sortedBy { it.second }
            .take(neighbours)
    }

    val closest = nearest.map { it.first().second }.sorted()
    val reach = closest[closest.size / 2] * LINK_REACH * LINK_REACH

    val links = linkedSetOf<Pair<Int, Int>>()
    nearest.forEachIndexed { i, found ->
        for ((j, distance) in found) {
            if (distance <= reach) links += if (i < j) i to j else j to i
        }
    }
    return links.toList()
}
