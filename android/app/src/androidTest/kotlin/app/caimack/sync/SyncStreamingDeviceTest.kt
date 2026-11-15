// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.sync

import android.content.ContextWrapper
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.DocumentsContract
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.api.User
import app.caimack.session.Server
import java.io.File
import java.net.Inet4Address
import java.net.InetAddress
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import mockwebserver3.*
import okhttp3.OkHttpClient
import okio.BufferedSink
import org.junit.Assert.*
import org.junit.Test

class SyncStreamingDeviceTest {
    private suspend fun withSync(test: suspend (SyncStore, LibrarySync, MusicFolder, AtomicReference<() -> MockResponse>, AtomicInteger) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val target = instrumentation.targetContext
        check(target.packageName.endsWith(".uitest"))
        if (Build.VERSION.SDK_INT >= 37) instrumentation.uiAutomation.grantRuntimePermission(target.packageName, "android.permission.ACCESS_LOCAL_NETWORK")
        val connectivity = target.getSystemService(ConnectivityManager::class.java)
        @Suppress("DEPRECATION")
        val network = connectivity.allNetworks.first { network ->
            connectivity.getNetworkCapabilities(network)?.let {
                !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                    (it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || it.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
            } == true
        }
        val address = connectivity.getLinkProperties(network)!!.linkAddresses.first {
            it.address is Inet4Address && it.address.isSiteLocalAddress
        }.address.hostAddress!!
        val prefix = "stream-${UUID.randomUUID()}"
        val privateDir = File(target.cacheDir, prefix).apply { mkdirs() }
        val isolated = object : ContextWrapper(target) {
            override fun getFilesDir() = privateDir
            override fun getSharedPreferences(name: String, mode: Int) = target.getSharedPreferences("$prefix-$name", mode)
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val prefs = PreferenceDataStoreFactory.create(scope = scope) { File(privateDir, "server.preferences_pb") }
        val server = Server(prefs)
        val json = Json { ignoreUnknownKeys = true }
        val user = User("stream-user", "Проверка памяти")
        lateinit var store: SyncStore
        val vectorVersion = "v1"
        val vectorResponse = AtomicReference<() -> MockResponse>({ MockResponse.Builder().body("{\"protocol\":1,\"items\":[]}").build() })
        val requests = AtomicInteger()
        val web = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                    "/api/sync/snapshot" -> MockResponse.Builder().body(buildJsonObject {
                        put("protocol", 1); put("serverId", "stream-server")
                        put("user", json.encodeToJsonElement(user)); put("vectorVersion", vectorVersion)
                        put("tracks", JsonArray(emptyList())); put("files", JsonArray(emptyList()))
                        put("assets", JsonArray(emptyList()))
                    }.toString()).build()
                    "/api/sync/vectors" -> { requests.incrementAndGet(); vectorResponse.get().invoke() }
                    else -> MockResponse.Builder().code(404).build()
                }
            }
            start(InetAddress.getByName("0.0.0.0"), 0)
        }
        server.remember(web.url("/").newBuilder().host(address).build().toString())
        store = SyncStore(isolated, json, server)
        instrumentation.uiAutomation.adoptShellPermissionIdentity("android.permission.MANAGE_DOCUMENTS")
        val tree = DocumentsContract.buildTreeDocumentUri(FixtureDocumentsProvider.AUTHORITY, "root")
        val all = MusicFolder(isolated, tree)
        val caseFolder = all.directory(all.root, prefix)
        val caseTree = DocumentsContract.buildTreeDocumentUri(FixtureDocumentsProvider.AUTHORITY, DocumentsContract.getDocumentId(caseFolder))
        val folder = MusicFolder(isolated, caseTree)
        store.configure(caseTree, user)
        store.enable(true)
        val sync = LibrarySync(isolated, store, server) { OkHttpClient() }
        try {
            test(store, sync, folder, vectorResponse, requests)
            // The export's recorded version must survive a process restart too.
            val restored = SyncStore(isolated, json, server).apply { session(user) }
            assertEquals(store.index, restored.index)
            assertEquals(store.snapshot, restored.snapshot)
        } finally {
            sync.pause()
            web.close()
            scope.coroutineContext.job.cancelAndJoin()
            all.delete(caseFolder)
            target.deleteSharedPreferences("$prefix-library-sync")
            privateDir.deleteRecursively()
            instrumentation.uiAutomation.dropShellPermissionIdentity()
        }
    }

    @Test fun exportsMoreThan100MbOfVectorsWithBoundedMemoryAndSkipsAnUnchangedVersion() = runBlocking {
        withSync { store, sync, folder, response, requests ->
            val prefix = "{\"protocol\":1,\"items\":[".toByteArray()
            val row = ("{\"trackId\":\"vector-track\",\"dimension\":1024,\"vector\":[" +
                List(1024) { "0.123456789" }.joinToString(",") + "]}").toByteArray()
            val comma = byteArrayOf(','.code.toByte())
            val suffix = "]}".toByteArray()
            val rows = 10_000
            val length = prefix.size.toLong() + row.size.toLong() * rows + rows - 1 + suffix.size
            assertTrue(length > 100L * 1024 * 1024)
            fun payload(write: (ByteArray) -> Unit) {
                write(prefix)
                repeat(rows) { if (it > 0) write(comma); write(row) }
                write(suffix)
            }
            val expected = MessageDigest.getInstance("SHA-256").apply { payload { update(it) } }.digest()
            response.set {
                MockResponse.Builder().body(object : MockResponseBody {
                    override val contentLength = length
                    override fun writeTo(sink: BufferedSink) { payload { sink.write(it); sink.emitCompleteSegments() } }
                }).build()
            }
            sync.run()
            assertNotEquals(store.status.value.message, 0L, store.status.value.lastSync)
            assertEquals("v1", store.index.vectorVersion)
            val vectors = android.net.Uri.parse(store.index.exports.getValue("vectors"))
            assertEquals(length, folder.size(vectors))
            val actual = MessageDigest.getInstance("SHA-256")
            folder.input(vectors).use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count == -1) break
                    actual.update(buffer, 0, count)
                }
            }
            assertArrayEquals(expected, actual.digest())
            sync.run()
            assertEquals("An unchanged vectors export must not be fetched again", 1, requests.get())
        }
    }

    @Test fun interruptedVectorTransferKeepsTheCompleteExportAndRetriesAfterResume() = runBlocking {
        withSync { store, sync, folder, response, requests ->
            sync.run()
            val old = store.index.exports.getValue("vectors")
            val original = folder.input(android.net.Uri.parse(old)).use { it.readBytes() }
            // Simulate a newer server version while retaining the complete local export.
            store.updateIndex { it.copy(vectorVersion = "old-version") }
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            response.set {
                MockResponse.Builder().body(object : MockResponseBody {
                    override val contentLength = 100_000L
                    override fun writeTo(sink: BufferedSink) {
                        sink.writeUtf8("{\"items\":["); sink.flush(); started.countDown()
                        release.await(10, TimeUnit.SECONDS)
                    }
                }).build()
            }
            try {
                val task = async(Dispatchers.IO) { sync.run() }
                assertTrue(started.await(10, TimeUnit.SECONDS))
                withTimeout(10_000) { while (store.index.garbage.isEmpty()) delay(10) }
                sync.pause()
                release.countDown()
                try { task.await() } catch (_: CancellationException) { }
                assertEquals(old, store.index.exports["vectors"])
                assertEquals("old-version", store.index.vectorVersion)
                assertArrayEquals(original, folder.input(android.net.Uri.parse(old)).use { it.readBytes() })
                assertFalse(store.status.value.running)
                response.set { MockResponse.Builder().body("{\"protocol\":1,\"items\":[{\"trackId\":\"new\"}]}").build() }
                store.paused = false
                sync.run()
                assertEquals("v1", store.index.vectorVersion)
                assertTrue(store.index.garbage.isEmpty())
                assertTrue(folder.input(android.net.Uri.parse(store.index.exports.getValue("vectors"))).bufferedReader().use { it.readText() }.contains("new"))
                assertEquals(3, requests.get())
            } finally { release.countDown() }
        }
    }
}
