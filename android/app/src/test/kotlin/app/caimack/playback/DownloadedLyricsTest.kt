// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.CaimackApi
import app.caimack.api.LyricLine
import app.caimack.api.LyricWord
import app.caimack.api.Lyrics
import app.caimack.api.LyricsAttribution
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class DownloadedLyricsTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val web = MockWebServer()
    private lateinit var directory: File
    private lateinit var api: CaimackApi
    private var owner: String? = "server-one|alice"
    private var downloaded = setOf("song")
    private var now = 1_000_000L
    private var online = true
    private var fetches = 0
    private val rich = Lyrics(
        plain = "Hello world",
        lines = listOf(LyricLine(100, "Hello world", 900,
            listOf(LyricWord(100, 400, "Hello "), LyricWord(400, 900, "world")))),
        source = "Provider", provider = "Unison",
        attribution = LyricsAttribution("https://unison.betterlyrics.org/song", "Contributor"),
    )

    @Before fun start() {
        directory = Files.createTempDirectory("downloaded-lyrics").toFile()
        web.start()
        api = Retrofit.Builder().baseUrl(web.url("/"))
            .client(OkHttpClient.Builder().callTimeout(2, TimeUnit.SECONDS).build())
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(CaimackApi::class.java)
    }

    @After fun stop() {
        runCatching { web.close() }
        directory.deleteRecursively()
    }

    private fun cache(fetch: suspend (String) -> Response<Lyrics> = { id ->
        fetches++
        if (!online) throw IOException("Offline")
        api.lyrics(id)
    }) = DownloadedLyrics(directory, json, { owner }, { downloaded }, fetch, { now })

    private fun respond(lyrics: Lyrics) {
        web.enqueue(MockResponse.Builder().body(json.encodeToString(lyrics)).build())
    }

    @Test fun `downloads prefetch rich lyrics without opening the player and retain them after restart offline`() = runBlocking {
        respond(rich)
        cache().refresh(listOf("song", "song"))
        assertEquals("/api/tracks/song/lyrics", web.takeRequest().url.encodedPath)
        assertEquals(1, web.requestCount)
        web.close()
        // A new instance uses only persisted files, including word timing and credits.
        assertEquals(rich, cache().load("song", offline = true))
        assertEquals(1, fetches)
    }

    @Test fun `plain lyrics survive restart and a missing text is retried on the next refresh`() = runBlocking {
        web.enqueue(MockResponse.Builder().code(204).build())
        cache().refresh(listOf("song"))
        assertEquals(Lyrics(), cache().load("song", offline = true))
        now += 15_000
        val plain = Lyrics(plain = "Newly discovered text")
        respond(plain)
        cache().refresh(listOf("song"))
        online = false
        assertEquals(plain, cache().load("song", offline = true))
        assertEquals(2, fetches)
    }

    @Test fun `downloaded collection lyrics are refreshed without repeated requests for fresh texts`() = runBlocking {
        downloaded = setOf("song", "other")
        respond(rich)
        respond(Lyrics(plain = "Other text"))
        val store = cache()
        store.refresh(listOf("song", "other"))
        store.refresh(listOf("song", "other"))
        assertEquals(2, fetches)
        now += TimeUnit.HOURS.toMillis(1)
        val replacement = rich.copy(plain = "Edited text", source = "Manual")
        respond(replacement)
        respond(Lyrics(plain = "Other text"))
        store.refresh(listOf("song", "other"))
        assertEquals(replacement, cache().load("song", offline = true))
        assertEquals(4, fetches)
    }

    @Test fun `line timing is provisional until word timing is saved for offline karaoke`() = runBlocking {
        val linesOnly = rich.copy(lines = rich.lines.map { it.copy(words = emptyList()) })
        respond(linesOnly)
        val store = cache()
        assertTrue(store.refresh(listOf("song")))
        assertEquals(linesOnly, cache().load("song", offline = true))
        assertTrue(store.refresh(listOf("song")))
        assertEquals(1, fetches)
        now += 15_000
        respond(rich)
        assertFalse(store.refresh(listOf("song")))
        online = false
        val offline = cache().load("song", offline = true)
        assertEquals(rich, offline)
        val word = offline.lines.single().words.first()
        assertEquals(0.5f, app.caimack.ui.lyricWordProgress(word, 250), 0.001f)
        assertEquals(2, fetches)
    }

    @Test fun `partially timed lyrics keep retrying but blank lines and manual lyrics do not`() = runBlocking {
        val partial = rich.copy(lines = rich.lines + LyricLine(1000, "Later line"))
        respond(partial)
        val store = cache()
        assertTrue(store.refresh(listOf("song")))
        now += 15_000
        respond(rich.copy(lines = rich.lines + LyricLine(1000, "")))
        assertFalse(store.refresh(listOf("song")))
        now += TimeUnit.HOURS.toMillis(1)
        respond(Lyrics(plain = "User text", source = "Manual"))
        assertFalse(store.refresh(listOf("song")))
    }

    @Test fun `empty responses wait for the retry interval`() = runBlocking {
        web.enqueue(MockResponse.Builder().code(204).build())
        val store = cache()
        repeat(5) { assertTrue(store.refresh(listOf("song"))) }
        assertEquals(1, fetches)
        now += 15_000
        respond(rich)
        assertFalse(store.refresh(listOf("song")))
    }

    @Test fun `connection failures and server errors preserve lyrics but authorization failures are not hidden`() = runBlocking {
        respond(rich)
        cache().refresh(listOf("song"))
        val store = cache()
        web.enqueue(MockResponse.Builder().code(503).build())
        assertEquals(rich, store.load("song"))
        web.enqueue(MockResponse.Builder().code(401).build())
        try { store.load("song"); fail("An expired session must not be hidden") }
        catch (error: HttpException) { assertEquals(401, error.code()) }
        online = false
        assertEquals(rich, store.load("song"))
        assertEquals(rich, cache().load("song", offline = true))
    }

    @Test fun `lyrics never cross account or server boundaries or remain accessible after download removal`() = runBlocking {
        respond(rich)
        val store = cache()
        store.refresh(listOf("song"))
        online = false
        for (other in listOf("server-one|bob", "server-two|alice", null)) {
            owner = other
            try { store.load("song", offline = true); fail("Lyrics leaked to $other") }
            catch (_: IOException) { }
        }
        owner = "server-one|alice"
        assertEquals(rich, store.load("song", offline = true))
        downloaded = emptySet()
        store.refresh(emptyList())
        downloaded = setOf("song")
        try { cache().load("song", offline = true); fail("Removed download kept its lyrics") }
        catch (_: IOException) { }
    }

    @Test fun `account switches during requests do not write lyrics to either account`() = runBlocking {
        val store = cache {
            owner = "server-one|bob"
            Response.success(rich)
        }
        try { store.load("song"); fail("Stale account response was accepted") }
        catch (_: IOException) { }
        online = false
        for (account in listOf("server-one|alice", "server-one|bob")) {
            owner = account
            try { cache().load("song", offline = true); fail("Stale response was persisted") }
            catch (_: IOException) { }
        }
    }

    @Test fun `offline backfill stops after one failed request and keeps existing text`() = runBlocking {
        respond(rich)
        cache().refresh(listOf("song"))
        downloaded = setOf("song", "other")
        now += TimeUnit.HOURS.toMillis(1)
        online = false
        cache().refresh(listOf("song", "other"))
        assertEquals(2, fetches)
        assertEquals(rich, cache().load("song", offline = true))
    }

    @Test fun `a malformed lyric response does not block other tracks or replace saved lyrics`() = runBlocking {
        respond(rich)
        cache().refresh(listOf("song"))
        now += TimeUnit.HOURS.toMillis(1)
        downloaded = setOf("song", "other")
        web.enqueue(MockResponse.Builder().body("invalid json").build())
        respond(Lyrics(plain = "Other text"))
        cache().refresh(listOf("song", "other"))
        assertEquals(rich, cache().load("song", offline = true))
        assertEquals("Other text", cache().load("other", offline = true).plain)
    }

    @Test fun `cancelling metadata refresh cancels the request`() = runBlocking {
        val store = cache { throw CancellationException("Cancelled") }
        try { store.refresh(listOf("song")); fail("Cancellation was swallowed") }
        catch (_: CancellationException) { }
    }
}
