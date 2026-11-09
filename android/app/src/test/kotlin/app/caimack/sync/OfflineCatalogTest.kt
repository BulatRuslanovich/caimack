// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.sync

import java.net.InetAddress
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class OfflineCatalogTest {
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
