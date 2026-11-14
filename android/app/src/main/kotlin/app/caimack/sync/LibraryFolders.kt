// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.sync

import kotlinx.serialization.json.*

/** Shared by validation before journaling and by replay after restarting offline. */
internal fun organizeLibrary(data: JsonObject, change: JsonObject, at: String): JsonObject {
    var folders = data.objects("libraryFolders")
    var items = data.objects("savedLibrary")
    val id = change.string("id")
    require(id.isNotBlank()) { "Missing library identifier" }
    val target = change["folderId"]?.jsonPrimitive?.contentOrNull
    val folder = folders.find { it.string("id") == id }
    fun name(): JsonPrimitive {
        val value = change.string("name").trim()
        require(value.codePointCount(0, value.length) in 1..200) { "Folder name must contain 1 to 200 characters" }
        return JsonPrimitive(value)
    }
    fun destination(moving: String? = null) {
        var cursor = target
        val seen = mutableSetOf<String>()
        while (cursor != null) {
            require(cursor != moving && seen.add(cursor)) { "A folder cannot contain itself" }
            val parent = folders.find { it.string("id") == cursor }
            require(parent != null) { "Folder is unavailable offline" }
            cursor = parent["parentId"]?.jsonPrimitive?.contentOrNull
        }
    }
    when (change.string("operation")) {
        "create" -> {
            require(folder == null) { "Folder already exists" }
            destination(id)
            folders = folders + buildJsonObject {
                put("id", id); put("name", name()); put("parentId", target); put("createdAt", at)
            }
        }
        "rename" -> {
            require(folder != null) { "Folder is unavailable offline" }
            val name = name()
            folders = folders.map { if (it.string("id") == id) it.with("name" to name) else it }
        }
        "moveFolder" -> {
            require(folder != null) { "Folder is unavailable offline" }
            destination(id)
            folders = folders.map { if (it.string("id") == id) it.with("parentId" to JsonPrimitive(target)) else it }
        }
        "delete" -> if (folder != null) {
            val up = folder["parentId"] ?: JsonNull
            folders = folders.filterNot { it.string("id") == id }.map {
                if (it.string("parentId") == id) it.with("parentId" to up) else it
            }
            items = items.map { if (it.string("folderId") == id) it.with("folderId" to up) else it }
        }
        "moveItem" -> {
            val kind = change.string("kind")
            require(kind in listOf("album", "artist", "playlist")) { "Unknown library item" }
            require(items.any { it.string("id") == id && it.string("kind") == kind }) { "Item is not in your library" }
            destination()
            items = items.map {
                if (it.string("id") == id && it.string("kind") == kind) it.with("folderId" to JsonPrimitive(target)) else it
            }
        }
        else -> throw IllegalArgumentException("Unknown library operation")
    }
    return data.with("libraryFolders" to JsonArray(folders), "savedLibrary" to JsonArray(items))
}
