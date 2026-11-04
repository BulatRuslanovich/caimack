// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.api

import app.caimack.session.Server

class Media(private val server: Server) {
    private val versions = java.util.concurrent.ConcurrentHashMap<String, Long>()

    fun markChanged(path: String) {
        versions[path] = System.currentTimeMillis()
    }

    fun playlistCoverPath(id: String) = "api/playlists/$id/cover"
    fun cover(albumId: String?, trackId: String?, hasCover: Boolean, small: Boolean): String? = when {
        !hasCover -> null
        albumId != null -> url("api/albums/$albumId/cover", small)
        trackId != null -> url("api/tracks/$trackId/cover", small)
        else -> null
    }

    fun albumCover(album: Album, small: Boolean): String? = cover(album.id, null, album.hasCover, small)

    fun artistImage(id: String, hasImage: Boolean, small: Boolean): String? =
        if (hasImage) url("api/artists/$id/image", small) else null

    fun playlistCover(id: String, hasCover: Boolean, coverTrackId: String?, small: Boolean): String? = when {
        hasCover -> url(playlistCoverPath(id), small)
        coverTrackId != null -> url("api/tracks/$coverTrackId/cover", small)
        else -> null
    }

    private fun url(path: String, small: Boolean): String? =
        server.resolve(path)?.newBuilder()?.apply {
            if (small) addQueryParameter("size", "thumb")
            versions[path]?.let { addQueryParameter("v", it.toString()) }
        }?.build()?.toString()
}
