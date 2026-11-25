// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import android.os.Handler
import android.os.Looper
import mockwebserver3.Dispatcher
import mockwebserver3.RecordedRequest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class DownloadedArtworkDeviceTest {
    @Test fun mainThreadReadsLocalCoverDuringStalledRefresh() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "artwork-anr-${System.nanoTime()}")
        val cache = DownloadedArtwork(directory)
        val client = OkHttpClient()
        val worker = Executors.newSingleThreadExecutor()
        val requestStarted = CountDownLatch(1)
        val releaseResponse = CountDownLatch(1)
        MockWebServer().use { web ->
            web.start()
            val server = web.url("/").toString()
            try {
                web.enqueue(MockResponse.Builder().addHeader("Content-Type", "image/png").body("cover").build())
                cache.cache(server, listOf("cached"), client)
                val expected = requireNotNull(cache.asset(server, "cached"))
                web.dispatcher = object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        requestStarted.countDown()
                        releaseResponse.await(8, TimeUnit.SECONDS)
                        return MockResponse.Builder().code(503).build()
                    }
                }
                val refresh = worker.submit { cache.cache(server, listOf("slow"), client) }
                assertTrue(requestStarted.await(3, TimeUnit.SECONDS))
                val read = java.util.concurrent.FutureTask { cache.asset(server, "cached") }
                Handler(Looper.getMainLooper()).post(read)
                assertEquals(expected, read.get(1, TimeUnit.SECONDS))
                assertFalse(refresh.isDone)
                releaseResponse.countDown()
                refresh.get(3, TimeUnit.SECONDS)
            } finally {
                releaseResponse.countDown()
                worker.shutdown()
                worker.awaitTermination(8, TimeUnit.SECONDS)
                directory.deleteRecursively()
            }
        }
    }

    @Test fun downloadedArtworkDecodesAfterTheServerIsStopped() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "artwork-test-${System.nanoTime()}")
        val web = MockWebServer()
        val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
        val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        bitmap.recycle()
        web.start()
        val server = web.url("/").toString()
        val paths = listOf("api/albums/test/cover", "api/artists/test/image")
        try {
            paths.forEach { web.enqueue(MockResponse.Builder().addHeader("Content-Type", "image/png").body(Buffer().write(bytes)).build()) }
            DownloadedArtwork(directory).cache(server, paths, OkHttpClient())
            assertEquals(2, web.requestCount)
            web.close()
            val restored = DownloadedArtwork(directory)
            paths.forEach { path ->
                val file = File(URI(restored.asset(server, path)!!))
                val decoded = BitmapFactory.decodeFile(file.path)
                assertNotNull(decoded)
                assertEquals(Color.RED, decoded.getPixel(1, 1))
                decoded.recycle()
            }
        } finally { runCatching { web.close() }; directory.deleteRecursively() }
    }
}
