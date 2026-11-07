// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import app.caimack.api.Paged
import app.caimack.api.Track

// A collection action must not silently operate on just the pages already scrolled.
internal suspend fun collectionTracks(load: suspend (Int) -> Paged<Track>): List<Track> {
    val tracks = linkedMapOf<String, Track>()
    var page = 1
    while (true) {
        val batch = load(page)
        check(batch.page == page) { "Unexpected collection page" }
        batch.items.forEach { tracks[it.id] = it }
        check(batch.pageSize > 0) { "Invalid collection page size" }
        if (page.toLong() * batch.pageSize >= batch.total) return tracks.values.toList()
        check(batch.items.isNotEmpty()) { "Incomplete collection" }
        page++
    }
}
