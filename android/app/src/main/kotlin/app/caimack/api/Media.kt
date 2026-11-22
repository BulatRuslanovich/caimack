// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.api

import app.caimack.session.Server

class Media(private val server: Server, private val changed: (String) -> Unit = {},
    private val local: (String, String?) -> String? = { _, _ -> null }) {
    private val versions = java.util.concurrent.ConcurrentHashMap<String, Long>()

    fun markChanged(path: String) {
        versions[path] = System.currentTimeMillis()
        changed(path)
    }

    fun playlistCoverPath(id: String) = "api/playlists/$id/cover"
    fun cover(albumId: String?, trackId: String?, hasCover: Boolean, small: Boolean, revision: String? = null): String? = when {
        !hasCover -> null
        revision != null && trackId != null -> url("api/tracks/$trackId/cover", small, revision)
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

    private fun url(path: String, small: Boolean, revision: String? = null): String? =
        local(path, revision) ?: server.resolve(path)?.newBuilder()?.apply {
            if (small) addQueryParameter("size", "thumb")
            (revision ?: versions[path]?.toString())?.let { addQueryParameter("v", it) }
        }?.build()?.toString()
}
