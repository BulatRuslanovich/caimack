// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract as Documents
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** Works with removable storage too; never turns a SAF URI into a guessed path. */
class MusicFolder(context: Context, tree: Uri) {
    private val resolver = context.contentResolver
    val root: Uri = Documents.buildDocumentUriUsingTree(tree, Documents.getTreeDocumentId(tree))
    private val children = mutableMapOf<String, MutableMap<String, Uri>>()

    fun children(parent: Uri): MutableMap<String, Uri> =
        children.getOrPut(parent.toString()) {
            val result = mutableMapOf<String, Uri>()
            val query =
                Documents.buildChildDocumentsUriUsingTree(parent, Documents.getDocumentId(parent))
            resolver
                .query(
                    query,
                    arrayOf(
                        Documents.Document.COLUMN_DOCUMENT_ID,
                        Documents.Document.COLUMN_DISPLAY_NAME,
                    ),
                    null,
                    null,
                    null,
                )
                ?.use { cursor ->
                    while (cursor.moveToNext()) result[cursor.getString(1)] =
                        Documents.buildDocumentUriUsingTree(parent, cursor.getString(0))
                } ?: throw IOException("Cannot list the music folder")
            result
        }

    fun directory(parent: Uri, name: String): Uri =
        children(parent)[name] ?: create(parent, name, Documents.Document.MIME_TYPE_DIR)

    fun create(parent: Uri, name: String, mime: String): Uri {
        if (children(parent).containsKey(name))
            throw IOException("A file named $name already exists")
        val exactMime =
            when {
                name.endsWith(".lrc") -> "application/octet-stream"
                name.endsWith(".m3u8") -> "application/vnd.apple.mpegurl"
                else -> mime
            }
        val uri =
            Documents.createDocument(resolver, parent, exactMime, name)
                ?: throw IOException("Cannot create $name")
        children(parent)[name] = uri
        return uri
    }

    fun input(uri: Uri): InputStream =
        resolver.openInputStream(uri) ?: throw IOException("Cannot read $uri")

    fun output(uri: Uri, append: Boolean = false): OutputStream =
        resolver.openOutputStream(uri, if (append) "wa" else "wt")
            ?: throw IOException("Cannot write $uri")

    fun size(uri: Uri): Long =
        resolver.query(uri, arrayOf(Documents.Document.COLUMN_SIZE), null, null, null)?.use {
            if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else -1
        } ?: -1

    fun exists(uri: Uri): Boolean =
        try {
            resolver
                .query(uri, arrayOf(Documents.Document.COLUMN_DOCUMENT_ID), null, null, null)
                ?.use { it.moveToFirst() } == true
        } catch (_: java.io.FileNotFoundException) {
            false
        } catch (_: IllegalArgumentException) {
            false
        } // ExternalStorageProvider wraps a missing document this way.

    fun delete(uri: Uri) {
        if (!exists(uri)) {
            children.values.forEach { map -> map.entries.removeAll { it.value == uri } }
            return
        }
        if (!Documents.isChildDocument(resolver, root, uri))
            throw IOException("Refusing to remove a file outside the selected tree")
        if (!Documents.deleteDocument(resolver, uri))
            throw IOException("Cannot remove an old synchronized file")
        children.values.forEach { map -> map.entries.removeAll { it.value == uri } }
    }

    fun rename(uri: Uri, name: String): Uri {
        val next =
            Documents.renameDocument(resolver, uri, name)
                ?: throw IOException("Cannot rename a synchronized file")
        children.clear()
        return next
    }

    companion object {
        fun safeName(text: String): String =
            text.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), " ").trim(' ', '.').take(80).ifEmpty {
                "Unknown"
            }
    }
}
