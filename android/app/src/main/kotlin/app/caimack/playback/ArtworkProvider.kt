// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import app.caimack.CaimackApp
import app.caimack.session.SessionState
import app.caimack.ui.coverPlaceholder
import java.io.File
import java.io.FileNotFoundException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request

class ArtworkProvider : ContentProvider() {
    override fun onCreate() = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val context = context ?: throw FileNotFoundException(uri.toString())
        if (mode != "r") throw FileNotFoundException("Artwork is read-only")
        if (uri.path == "/placeholder") return placeholder(uri)
        if (uri.pathSegments.firstOrNull() == "synced") {
            val name = uri.pathSegments.getOrNull(1)
                ?.takeIf { uri.pathSegments.size == 2 && it.startsWith("asset-") }
                ?: throw FileNotFoundException(uri.toString())
            val folder = File(context.filesDir, "library-sync").canonicalFile
            val file = File(folder, name).canonicalFile
            if (file.parentFile != folder || file.name != name) throw FileNotFoundException(uri.toString())
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        }
        val path = uri.path?.let { ARTWORK.find(it)?.value } ?: throw FileNotFoundException(uri.toString())
        val size = uri.getQueryParameter(SIZE)?.takeIf { it in SIZES }
        val folder = File(context.cacheDir, "artwork")
        val file = File(folder, "${path.replace('/', '-')}.${size ?: "full"}")
        if (file.canonicalFile.parentFile != folder.canonicalFile) throw FileNotFoundException(uri.toString())

        if (!file.exists()) {
            val container = (context.applicationContext as CaimackApp).container
            runBlocking { withTimeoutOrNull(SESSION_WAIT_MS) { container.session.state.first { it !is SessionState.Restoring } } }
            val url = container.server.resolve(path)?.newBuilder()?.apply { size?.let { addQueryParameter(SIZE, it) } }?.build()
                ?: throw FileNotFoundException(path)
            container.http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) throw FileNotFoundException(path)
                folder.mkdirs()
                val partial = File(file.path + ".part")
                partial.outputStream().use { response.body.byteStream().copyTo(it) }
                partial.renameTo(file)
            }
        }

        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    private fun placeholder(uri: Uri): ParcelFileDescriptor {
        val context = context ?: throw FileNotFoundException(uri.toString())
        val name = uri.getQueryParameter("name").orEmpty().take(512).ifBlank { "Caimack" }
        val appearance = (context.applicationContext as CaimackApp).container.appearance
        val palette = appearance.palette()
        val key = java.security.MessageDigest.getInstance("SHA-256")
            .digest("$name:${appearance.colorway.value.key}:${palette.dark}".toByteArray())
            .joinToString("") { "%02x".format(it) }
        val folder = File(context.cacheDir, "artwork").apply { mkdirs() }
        val file = File(folder, "placeholder-$key.png")
        synchronized(placeholderLock) {
            if (!file.exists()) {
                val bitmap = coverPlaceholder(name, palette)
                val partial = File(file.path + ".part")
                try {
                    partial.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                    if (!partial.renameTo(file)) throw FileNotFoundException("Could not cache placeholder artwork")
                } finally {
                    bitmap.recycle()
                    partial.delete()
                }
            }
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String = "image/*"

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    companion object {
        const val AUTHORITY = "app.caimack.artwork"

        private const val SIZE = "size"
        private val SIZES = setOf("thumb", "large")
        private const val SESSION_WAIT_MS = 10_000L
        private val placeholderLock = Any()

        fun uriFor(url: String?, fallbackName: String? = null): Uri? = url?.toHttpUrlOrNull()?.let { http ->
            Uri.Builder()
                .scheme("content")
                .authority(AUTHORITY)
                .encodedPath(http.encodedPath)
                .apply { http.queryParameter(SIZE)?.let { appendQueryParameter(SIZE, it) } }
                .build()
        } ?: url?.let(Uri::parse)?.takeIf { it.scheme == "file" }?.path?.let { path ->
            val file = File(path)
            // SyncStore.asset returns private files. Expose only synchronized assets through
            // our provider so System UI and media browsers can read them without file:// access.
            file.takeIf { it.parentFile?.name == "library-sync" && it.name.startsWith("asset-") }?.let {
                Uri.Builder().scheme("content").authority(AUTHORITY)
                    .appendPath("synced").appendPath(it.name).build()
            }
        } ?: fallbackName?.let { name ->
            Uri.Builder().scheme("content").authority(AUTHORITY).path("/placeholder")
                .appendQueryParameter("name", name).build()
        }

        private val ARTWORK = Regex("api/(albums|tracks|playlists|artists)/[0-9a-fA-F-]+/(cover|image)$")
    }
}
