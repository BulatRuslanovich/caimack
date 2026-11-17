// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.sync

import android.content.ContextWrapper
import android.net.Uri
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.api.User
import app.caimack.session.Server
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalSerializationApi::class)
class SnapshotJsonDeviceTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun preservesJsonTypesEscapingAndThePublicCatalogFormat() {
        val source = """{"protocol":1,"tracks":[],"files":[],"lyrics":{"one":{"plain":"Тёплый вечер 🎵 \"live\"\n","lines":[{"at":1234,"text":"\u0410\tБ"}],"source":null},"two":null},"waveforms":{"one":{"peaks":[0,127,255],"version":4}},"extra":{"enabled":true,"disabled":false,"number":-1.25e+10,"empty":[],"nil":null}}"""
        val expected = json.decodeFromStream<JsonObject>(source.byteInputStream())
        val actual = SnapshotJson(json).read(source.byteInputStream())
        assertEquals(expected, actual)
        assertEquals(json.encodeToString(expected), json.encodeToString(actual))
        // Independent iterators and lookups must still work after exporting the map.
        repeat(2) {
            assertEquals(expected["lyrics"], actual["lyrics"])
            assertEquals(expected["waveforms"], actual["waveforms"])
        }
        for (optional in listOf("{}", "{\"lyrics\":null,\"waveforms\":{}}", "{\"waveforms\":{},\"lyrics\":{}}")) {
            assertEquals(json.decodeFromStream<JsonObject>(optional.byteInputStream()),
                SnapshotJson(json).read(optional.byteInputStream()))
        }
        val url = "https://example.invalid/api/tracks/one/lyrics".toHttpUrl()
        assertEquals(expected["lyrics"]!!.jsonObject["one"],
            OfflineCatalog.read("tracks/one/lyrics", url, buildJsonObject {}, actual)!!.value)
        assertEquals(204, OfflineCatalog.read("tracks/missing/lyrics", url, buildJsonObject {}, actual)!!.code)
        assertEquals(404, OfflineCatalog.read("tracks/missing/waveform", url, buildJsonObject {}, actual)!!.code)
        for (invalid in listOf(source.dropLast(1), "$source {}")) {
            assertTrue(runCatching { SnapshotJson(json).read(invalid.byteInputStream()) }.isFailure)
        }
    }

    @Test fun largeLibraryKeepsDetailsCompactDuringLoadExportAndRestart() = runBlocking<Unit> {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        check(base.packageName.endsWith(".uitest"))
        val prefix = "snapshot-${UUID.randomUUID()}"
        val directory = File(base.cacheDir, prefix).apply { mkdirs() }
        val isolated = object : ContextWrapper(base) {
            override fun getFilesDir() = directory
            override fun getSharedPreferences(name: String, mode: Int) =
                base.getSharedPreferences("$prefix-$name", mode)
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val preferences = PreferenceDataStoreFactory.create(scope = scope) {
            File(directory, "test.preferences_pb")
        }
        val server = Server(preferences)
        server.remember("https://example.invalid/")
        val user = User("large-user", "Большая библиотека")
        val count = 2500
        val source = File(directory, "source.json")
        val exported = File(directory, "exported.json")
        val lyric = buildJsonObject {
            put("plain", "Тёплый вечер 🎵 \"live\"\n")
            put("lines", buildJsonArray {
                repeat(160) { line -> add(buildJsonObject {
                    put("at", line * 1000)
                    put("text", "Тёплый вечер 🎵 \"live\" — строка $line")
                }) }
            })
        }
        val waveform = buildJsonObject {
            put("version", 4)
            put("peaks", JsonArray(List(240) { JsonPrimitive(it % 256) }))
        }
        try {
            // Generate the fixture on disk; the test server must not retain a giant JSON tree either.
            source.bufferedWriter().use { writer ->
                writer.write("{\"protocol\":1,\"serverId\":\"large-server\",\"user\":${json.encodeToString(user)},\"tracks\":[")
                repeat(count) { id ->
                    if (id > 0) writer.write(",")
                    writer.write("{\"id\":\"$id\",\"title\":\"Track $id\",\"artistId\":\"artist\",\"artistName\":\"Artist\",\"durationSeconds\":180}")
                }
                writer.write("],\"files\":[")
                repeat(count) { id ->
                    if (id > 0) writer.write(",")
                    writer.write("{\"id\":\"$id\"}")
                }
                writer.write("],\"lyrics\":{")
                val encodedLyric = lyric.toString()
                repeat(count) { id ->
                    if (id > 0) writer.write(",")
                    writer.write("\"$id\":$encodedLyric")
                }
                writer.write("},\"waveforms\":{")
                val encodedWaveform = waveform.toString()
                repeat(count) { id ->
                    if (id > 0) writer.write(",")
                    writer.write("\"$id\":$encodedWaveform")
                }
                writer.write("}}")
            }
            val runtime = Runtime.getRuntime()
            fun usedHeap(): Long {
                runtime.gc()
                return runtime.totalMemory() - runtime.freeMemory()
            }
            val baseline = usedHeap()
            val store = SyncStore(isolated, json, server)
            store.configure(Uri.parse("content://test/folder"), user)
            store.enable(true)
            store.accept(source.inputStream().use { SnapshotJson(json).read(it) })
            val retained = usedHeap() - baseline
            assertTrue("2500 tracks retained ${retained / (1024 * 1024)} MiB", retained < 96L * 1024 * 1024)
            assertEquals(count, store.status.value.total)
            assertEquals(lyric, store.snapshot!!["lyrics"]!!.jsonObject["2499"])
            assertEquals(waveform, store.snapshot!!["waveforms"]!!.jsonObject["0"])
            exported.outputStream().use { json.encodeToStream(store.snapshot!!, it) }
            fun digest(file: File): ByteArray {
                val hash = MessageDigest.getInstance("SHA-256")
                file.inputStream().use { input ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val length = input.read(buffer)
                        if (length == -1) break
                        hash.update(buffer, 0, length)
                    }
                }
                return hash.digest()
            }
            assertArrayEquals("Export must preserve the public catalog", digest(source), digest(exported))
            val restored = SyncStore(isolated, json, server).apply { session(user) }
            assertEquals(count, restored.status.value.total)
            assertEquals(lyric, restored.snapshot!!["lyrics"]!!.jsonObject["2499"])
            assertEquals(waveform, restored.snapshot!!["waveforms"]!!.jsonObject["0"])
            val url = "https://example.invalid/api/tracks/2499/lyrics".toHttpUrl()
            assertEquals(lyric, OfflineCatalog.read("tracks/2499/lyrics", url, buildJsonObject {}, restored.snapshot!!)!!.value)
            android.util.Log.i("SnapshotJsonTest", "2500 tracks: ${source.length()} bytes, $retained heap bytes, limit ${runtime.maxMemory()}")
        } finally {
            scope.coroutineContext.job.cancelAndJoin()
            base.deleteSharedPreferences("$prefix-library-sync")
            directory.deleteRecursively()
        }
    }
}
