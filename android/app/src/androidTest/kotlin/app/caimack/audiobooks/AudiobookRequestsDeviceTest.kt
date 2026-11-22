// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.audiobooks

import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.ConnectDevice
import app.caimack.api.ConnectSnapshot
import app.caimack.api.User
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockResponseBody
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.BufferedSink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AudiobookRequestsDeviceTest {
    @Test fun idleAudiobooksUseConnectEventsWithoutPolling() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(context.packageName.endsWith(".uitest"))
        val container = (context.applicationContext as CaimackApp).container
        val originalLocalHttp = container.connectionPreferences.allowLocalHttp.value
        val user = User("test-audiobooks", "Audiobook test")
        val enabled = AtomicBoolean(false)
        val running = AtomicBoolean(true)
        val events = LinkedBlockingQueue<Boolean>()
        val flagRequests = AtomicInteger()
        val catalogRequests = AtomicInteger()
        val heartbeats = AtomicInteger()
        val snapshot = container.json.encodeToString(ConnectSnapshot(
            epoch = "audiobook-test", version = 1,
            devices = listOf(ConnectDevice(container.deviceId, "Phone", "test-connection", "android")),
        ))
        fun json(body: String) = MockResponse.Builder().code(200)
            .addHeader("Content-Type", "application/json").body(body).build()

        MockWebServer().use { web ->
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                    "/api/auth/login", "/api/auth/me" -> json(container.json.encodeToString(user))
                    "/api/config" -> json("""{"recommendationsEnabled":false}""")
                    "/api/me/settings" -> json("""{"quality":"Original"}""")
                    "/api/sync/identity" -> json("""{"serverId":"audiobook-test","userId":"test-audiobooks"}""")
                    "/api/playback/connect/state" -> json(snapshot)
                    "/api/experiments/audiobooks" -> {
                        flagRequests.incrementAndGet()
                        json("""{"enabled":${enabled.get()}}""")
                    }
                    "/api/audiobooks" -> {
                        catalogRequests.incrementAndGet()
                        json("[]")
                    }
                    "/api/playback/connect/heartbeat" -> {
                        heartbeats.incrementAndGet()
                        MockResponse.Builder().code(204).build()
                    }
                    "/api/playback/connect/events" -> MockResponse.Builder().code(200)
                        .addHeader("Content-Type", "text/event-stream")
                        .body(object : MockResponseBody {
                            override val contentLength = Long.MAX_VALUE
                            override fun writeTo(sink: BufferedSink) {
                                sink.writeUtf8("event: snapshot\ndata: $snapshot\n\n").flush()
                                if (request.url.queryParameter("audiobookExperiment") == "true") {
                                    sink.writeUtf8("event: audiobook-experiment\ndata: ${enabled.get()}\n\n").flush()
                                }
                                while (running.get()) {
                                    val value = events.poll(2, TimeUnit.SECONDS)
                                    if (!running.get()) break
                                    val message = if (value == null) ": keep-alive\n\n"
                                    else "event: audiobook-experiment\ndata: $value\n\n"
                                    sink.writeUtf8(message).flush()
                                }
                            }
                        }).build()
                    else -> MockResponse.Builder().code(204).build()
                }
            }
            web.start()
            container.connectionPreferences.setAllowLocalHttp(true)
            try {
                assertNull(container.session.login(web.url("/").toString(), user.username, "fixture"))
                withTimeout(10_000) { container.connect.state.first { it.connected } }
                delay(750)
                val initialFlagRequests = flagRequests.get()
                delay(5_000)
                assertEquals(initialFlagRequests, flagRequests.get())
                assertEquals(0, catalogRequests.get())

                enabled.set(true)
                events.offer(true)
                withTimeout(10_000) {
                    container.audiobooksEnabled.first { it }
                    container.audiobookStore.state.first { it.ready && it.online }
                }
                val initialCatalogRequests = catalogRequests.get()
                assertEquals(1, initialCatalogRequests)
                delay(32_000)
                assertEquals(initialCatalogRequests, catalogRequests.get())
                assertEquals(initialFlagRequests, flagRequests.get())
                assertTrue(heartbeats.get() > 0)

                enabled.set(false)
                events.offer(false)
                withTimeout(10_000) { container.audiobooksEnabled.first { !it } }
                assertEquals(initialCatalogRequests, catalogRequests.get())
            } finally {
                container.session.logout()
                container.connectionPreferences.setAllowLocalHttp(originalLocalHttp)
                running.set(false)
                events.offer(false)
            }
        }
    }
}
