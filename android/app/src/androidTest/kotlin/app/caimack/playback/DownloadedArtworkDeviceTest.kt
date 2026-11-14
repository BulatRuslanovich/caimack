// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URI
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class DownloadedArtworkDeviceTest {
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
