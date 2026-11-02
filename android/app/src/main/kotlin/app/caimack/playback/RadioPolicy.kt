// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

object RadioPolicy {
    fun exclusions(order: List<Int>, current: Int, retained: Set<Int>): List<Int> =
        order.drop((order.indexOf(current) - 2).coerceAtLeast(0)).filter { it in retained }

    fun reactsTo(type: String, listenedSeconds: Int?): Boolean =
        type in setOf("trackCompleted", "trackSkipped", "trackLiked", "trackUnliked", "trackReplayed", "trackAddedToQueue") ||
            (type == "trackPlayed" && (listenedSeconds ?: 0) >= 60)

    // Return indices so the service can preserve MediaItems and their buffers.
    fun retained(order: List<Int>, current: Int, generated: (Int) -> Boolean): Set<Int> {
        val position = order.indexOf(current)
        if (position < 0) return order.toSet()
        return order.take(position + 2).toSet() + order.filter { !generated(it) }
    }
}
