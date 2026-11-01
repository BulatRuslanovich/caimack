// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import app.caimack.api.CaimackApi
import app.caimack.api.PlaylistDetail
import app.caimack.api.Track
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.MediaType.Companion.toMediaType
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class PlaylistTrackActionsTest {
    private val web = MockWebServer()
    private val json = Json { ignoreUnknownKeys = true }
    private val actions by lazy {
        web.start()
        PlaylistTrackActions(Retrofit.Builder().baseUrl(web.url("/"))
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(CaimackApi::class.java))
    }

    private fun track(id: String) = Track(id, id, "artist", "Artist", durationSeconds = 60)
    private fun tracks(vararg ids: String) = ids.map(::track)
    private fun response(code: Int) = MockResponse.Builder().code(code).build()
    private fun playlist(vararg ids: String) = MockResponse.Builder().code(200)
        .addHeader("Content-Type", "application/json")
        .body(json.encodeToString(PlaylistDetail("playlist", "Playlist", tracks = tracks(*ids)))).build()

    @After
    fun close() { web.close() }

    @Test
    fun `undo restores the original position while keeping newly added tracks`() = runBlocking {
        web.enqueue(response(204))
        web.enqueue(playlist("a", "c", "new", "b"))
        web.enqueue(response(204))

        val restored = actions.restore("playlist", "b", listOf("a", "b", "c"))

        assertEquals(listOf("a", "b", "c", "new"), restored.tracks.map { it.id })
        assertEquals("POST", web.takeRequest().method)
        assertEquals("GET", web.takeRequest().method)
        assertEquals("/api/playlists/playlist/tracks/order", web.takeRequest().url.encodedPath)
    }

    @Test
    fun `undo restores the first track before surviving successors`() {
        assertEquals(listOf("a", "c"), restoreTrackOrder(tracks("c", "a"), "a", listOf("a", "b", "c")).map { it.id })
    }

    @Test
    fun `undo preserves another users current ordering`() {
        assertEquals(listOf("c", "a", "b"), restoreTrackOrder(tracks("c", "a", "b"), "b", listOf("a", "b", "c")).map { it.id })
    }

    @Test
    fun `an unsuccessful delete is reported as a failure`() = runBlocking {
        web.enqueue(response(403))
        val failure = runCatching { actions.remove("playlist", "a") }.exceptionOrNull()
        assertEquals(403, (failure as HttpException).code())
    }

    @Test
    fun `undo cannot report success when restoring the order fails`() = runBlocking {
        web.enqueue(response(204))
        web.enqueue(playlist("a", "c", "b"))
        web.enqueue(response(500))
        assertFalse(runCatching { actions.restore("playlist", "b", listOf("a", "b", "c")) }.isSuccess)
    }

    @Test
    fun `undo does not reorder a track that is already in place`() = runBlocking {
        web.enqueue(response(204))
        web.enqueue(playlist("a", "b", "c"))
        actions.restore("playlist", "b", listOf("a", "b", "c"))
        assertEquals(2, web.requestCount)
    }
}
