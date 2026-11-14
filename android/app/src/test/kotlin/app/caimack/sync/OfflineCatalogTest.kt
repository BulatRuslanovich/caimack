// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.sync

import java.net.InetAddress
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class OfflineCatalogTest {
    @Test
    fun savedCardsUseCatalogMetadataAndPreserveUnloadedPlaylistTotals() {
        val data = Json.parseToJsonElement("""{
            "tracks":[],"albums":[{"id":"a","title":"Album","artistName":"Artist","year":2024,"trackCount":10,"durationSeconds":1800}],
            "artists":[{"id":"ar","name":"Artist","trackCount":25,"albumCount":3}],
            "playlists":[{"id":"p","name":"Mix","trackCount":12,"durationSeconds":720}],
            "savedLibrary":[{"kind":"album","id":"a"},{"kind":"artist","id":"ar"},{"kind":"playlist","id":"p"}]
        }""").jsonObject
        val items = OfflineCatalog.view(data, emptyList()).objects("savedLibrary").associateBy { it.string("id") }
        assertEquals(10, items.getValue("a")["trackCount"]?.jsonPrimitive?.int)
        assertEquals(2024, items.getValue("a")["year"]?.jsonPrimitive?.int)
        assertEquals(3, items.getValue("ar")["albumCount"]?.jsonPrimitive?.int)
        assertEquals(12, items.getValue("p")["trackCount"]?.jsonPrimitive?.int)
        assertEquals(720, items.getValue("p")["durationSeconds"]?.jsonPrimitive?.int)
    }

    private val snapshot =
        Json.parseToJsonElement(
                """{
      "user":{"id":"u","username":"User"},
      "tracks":[{"id":"a","title":"Zulu","artistName":"Artist","albumId":"album","isFavorite":false,"durationSeconds":12},
                {"id":"b","title":"Alpha","artistName":"Artist","albumId":"album","isFavorite":false,"durationSeconds":24}],
      "albums":[{"id":"album","title":"Album"}],"artists":[],"genres":[],
      "playlists":[{"id":"p","name":"Server name","description":"PC description","ownerId":"u"}],
      "playlistTracks":{"p":["b","a"]},"recent":[],"lyrics":{},"waveforms":{}
    }"""
            )
            .jsonObject

    private fun action(kind: String, id: String?, payload: String) =
        SyncAction(
            kind = kind,
            entityId = id,
            payload = Json.parseToJsonElement(payload).jsonObject,
        )

    private fun read(
        path: String,
        query: String = "",
        data: JsonObject = snapshot,
        body: JsonObject = buildJsonObject {},
        method: String = "GET",
    ) =
        OfflineCatalog.read(
                path,
                "http://192.168.1.2/api/$path$query".toHttpUrl(),
                body,
                data,
                method,
            )!!
            .value
            .jsonObject

    @Test
    fun foldersReplayMovesAndDeletionWithoutRemovingSavedMusic() {
        fun organize(payload: String) = action("libraryOrganize", null, payload)
        val actions = listOf(
            action("library", "album", """{"kind":"album","value":true}"""),
            organize("""{"operation":"create","id":"parent","name":" Music "}"""),
            organize("""{"operation":"create","id":"child","name":"Albums","folderId":"parent"}"""),
            organize("""{"operation":"create","id":"leaf","name":"Nested","folderId":"child"}"""),
            organize("""{"operation":"moveItem","kind":"album","id":"album","folderId":"child"}"""),
            organize("""{"operation":"rename","id":"parent","name":"Collection"}"""),
        )
        val nested = OfflineCatalog.view(snapshot, actions)
        assertEquals("child", nested.objects("savedLibrary").single().string("folderId"))
        assertEquals("Collection", nested.objects("libraryFolders").first().string("name"))
        val deleted = OfflineCatalog.view(snapshot, actions + organize("""{"operation":"delete","id":"child"}"""))
        assertEquals("parent", deleted.objects("savedLibrary").single().string("folderId"))
        assertEquals("parent", deleted.objects("libraryFolders").first { it.string("id") == "leaf" }.string("parentId"))
        val root = OfflineCatalog.view(snapshot, actions + listOf(organize("""{"operation":"delete","id":"child"}"""), organize("""{"operation":"delete","id":"parent"}""")))
        assertEquals(JsonNull, root.objects("savedLibrary").single()["folderId"])
        assertEquals(1, root.objects("albums").size)
    }

    @Test
    fun invalidFolderMovesAreRejectedAndStaleDestinationsDoNotBreakReplay() {
        val tree = Json.parseToJsonElement("""{"libraryFolders":[{"id":"parent","name":"A"},{"id":"child","name":"B","parentId":"parent"}],"savedLibrary":[]}""").jsonObject
        val cycle = Json.parseToJsonElement("""{"operation":"moveFolder","id":"parent","folderId":"child"}""").jsonObject
        assertThrows(IllegalArgumentException::class.java) { organizeLibrary(tree, cycle, "now") }
        val absent = action("libraryOrganize", null, """{"operation":"moveFolder","id":"missing","folderId":"child"}""")
        assertEquals(tree.objects("libraryFolders"), OfflineCatalog.view(tree, listOf(absent)).objects("libraryFolders"))
    }

    @Test
    fun librarySavesReplayIndependentlyOfFavoritesAndUseUpdatedMetadata() {
        val save = action("library", "album", """{"kind":"album","value":true}""")
        val view = OfflineCatalog.view(snapshot, listOf(save, save))
        assertEquals(1, view.objects("savedLibrary").size)
        assertEquals("Album", view.objects("savedLibrary").single().string("title"))
        assertTrue(view.objects("tracks").none { it["isFavorite"]?.jsonPrimitive?.boolean == true })
        val renamed = JsonObject(snapshot + ("albums" to Json.parseToJsonElement("""[{"id":"album","title":"Renamed"}]""")))
        assertEquals("Renamed", OfflineCatalog.view(renamed, listOf(save)).objects("savedLibrary").single().string("title"))
        val remove = action("library", "album", """{"kind":"album","value":false}""")
        assertTrue(OfflineCatalog.view(snapshot, listOf(save, remove)).objects("savedLibrary").isEmpty())
    }

    @Test
    fun pendingPlaylistEditsUpdateSavedTotals() {
        val data = snapshot.with("savedLibrary" to Json.parseToJsonElement("""[{"kind":"playlist","id":"p","trackCount":2,"durationSeconds":36}]"""))
        val view = OfflineCatalog.view(data, listOf(action("playlistRemove", "p", """{"trackIds":["a"]}""")))
        val saved = view.objects("savedLibrary").single()
        assertEquals(1, saved["trackCount"]?.jsonPrimitive?.int)
        assertEquals(24, saved["durationSeconds"]?.jsonPrimitive?.int)
    }

    @Test
    fun newPlaylistsEnterLibraryAndRemovalDoesNotDeletePlaylist() {
        val create = action("playlistCreate", "new", """{"name":"New mix"}""")
        val created = OfflineCatalog.view(snapshot, listOf(create))
        assertEquals("new", created.objects("savedLibrary").single().string("id"))
        val remove = action("library", "new", """{"kind":"playlist","value":false}""")
        val removed = OfflineCatalog.view(snapshot, listOf(create, remove))
        assertTrue(removed.objects("savedLibrary").isEmpty())
        assertTrue(removed.objects("playlists").any { it.string("id") == "new" })
        val deleted = OfflineCatalog.view(snapshot, listOf(create, action("playlistDelete", "new", "{}")))
        assertTrue(deleted.objects("savedLibrary").isEmpty())
    }

    @Test
    fun pendingActionsSurviveSnapshotReplacementAndPreserveUneditedFields() {
        val edits =
            listOf(
                action("playlistUpdate", "p", """{"name":"Phone name"}"""),
                action("playlistRemove", "p", """{"trackIds":["a"]}"""),
                action("favorite", "b", """{"value":true}"""),
            )
        val view = OfflineCatalog.view(snapshot, edits)
        val playlist = read("playlists/p", data = view)
        assertEquals("Phone name", playlist.string("name"))
        assertEquals("PC description", playlist.string("description"))
        assertEquals(listOf("b"), playlist.objects("tracks").map { it.string("id") })
        assertEquals(
            listOf("b"),
            read("favorites", data = view).objects("items").map { it.string("id") },
        )
    }

    @Test
    fun paginationAndLookupUseTheSameContractAsTheServer() {
        val first = read("tracks", "?page=1&pageSize=1")
        assertEquals(2, first.getValue("total").jsonPrimitive.int)
        assertEquals("b", first.objects("items").single().string("id"))
        val body = buildJsonObject {
            put(
                "ids",
                JsonArray(listOf(JsonPrimitive("a"), JsonPrimitive("missing"), JsonPrimitive("b"))),
            )
        }
        val result =
            OfflineCatalog.read(
                    "tracks/lookup",
                    "http://192.168.1.2/api/tracks/lookup".toHttpUrl(),
                    body,
                    snapshot,
                    "POST",
                )!!
                .value
                .jsonArray
        assertEquals(listOf("a", "b"), result.map { it.jsonObject.string("id") })
        assertTrue(read("tracks", "?page=2147483647&pageSize=10000").objects("items").isEmpty())
    }

    @Test
    fun replayingConfirmedCreationDoesNotDuplicateAPlaylist() {
        val create = action("playlistCreate", "p", """{"name":"Name"}""")
        assertEquals(1, OfflineCatalog.view(snapshot, listOf(create)).objects("playlists").size)
    }

    @Test
    fun onlyLocalUnicastAddressesAreAllowedForSynchronization() {
        for (ip in
            listOf("192.168.1.1", "10.0.0.1", "172.16.1.1", "169.254.1.1", "fd12::1")) assertTrue(
            ip,
            LocalNetwork.isLocal(InetAddress.getByName(ip)),
        )
        for (ip in
            listOf(
                "8.8.8.8",
                "127.0.0.1",
                "0.0.0.0",
                "224.0.0.1",
                "100.64.0.1",
                "172.32.0.1",
                "::1",
                "2606:4700::1111",
            )) assertFalse(ip, LocalNetwork.isLocal(InetAddress.getByName(ip)))
    }
}
