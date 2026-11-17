// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.content.ContentValues
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Build
import android.provider.MediaStore
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Track
import app.caimack.api.UserSettings
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import mockwebserver3.*
import okio.Buffer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

@androidx.annotation.OptIn(UnstableApi::class)
class TrackDownloadUiTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val container get() = (context.applicationContext as CaimackApp).container

    private fun withTrack(holdResponse: Boolean = false, test: (Track, ByteArray, List<String>, CountDownLatch) -> Unit) {
        check(context.packageName.endsWith(".uitest")) { "Download fixtures require the isolated test package" }
        val track = Track("single-download-${System.nanoTime()}", "Тепло твоих рук", "artist", "Электрические сны", durationSeconds = 2)
        val samples = 16_000
        val audio = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + samples * 2); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(8000); putInt(16000); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(samples * 2)
            repeat(samples) { putShort(0) }
        }.array()
        val release = CountDownLatch(if (holdResponse) 1 else 0)
        val requests = CopyOnWriteArrayList<String>()
        val web = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests += "${request.method} ${request.url.encodedPath}"
                    if (request.url.encodedPath == "/api/tracks/${track.id}/stream") {
                        release.await(20, TimeUnit.SECONDS)
                        return MockResponse.Builder().code(200).addHeader("Content-Type", "audio/wav")
                            .body(Buffer().write(audio)).build()
                    }
                    return MockResponse.Builder().code(204).build()
                }
            }
            start()
        }
        val oldServer = container.server.url.value
        val oldLocalHttp = container.connectionPreferences.allowLocalHttp.value
        val oldSettings = container.settings.value
        container.connectionPreferences.setAllowLocalHttp(true)
        if (Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, "android.permission.POST_NOTIFICATIONS")
        if (Build.VERSION.SDK_INT >= 37) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, "android.permission.ACCESS_LOCAL_NETWORK")
        runBlocking { container.server.remember(web.url("/").toString()) }
        container.settings.value = UserSettings(quality = "Original")
        val localized = context.createConfigurationContext(Configuration(context.resources.configuration).apply {
            setLocale(Locale.forLanguageTag("ru"))
        })
        var open by mutableStateOf(true)
        compose.setContent {
            CompositionLocalProvider(LocalContainer provides container, LocalContext provides localized, LocalResources provides localized.resources) {
                CaimackTheme(dark = true) {
                    if (open) TrackSheet(track) { open = false }
                    else Button(onClick = { open = true }) { Text("Open actions") }
                }
            }
        }
        try {
            compose.onNodeWithText("Скачать").assertIsDisplayed()
            test(track, audio, requests, release)
        } finally {
            release.countDown()
            compose.runOnIdle { container.downloads.remove(listOf(track.id)) }
            compose.waitUntil(10_000) { track.id !in container.downloads.state.value }
            container.settings.value = oldSettings
            container.connectionPreferences.setAllowLocalHttp(oldLocalHttp)
            runBlocking {
                if (oldServer != null) container.server.remember(oldServer.toString())
                else {
                    container.preferences.edit { it.remove(stringPreferencesKey("server")) }
                    container.server.restore()
                }
            }
            web.close()
        }
    }

    @Test fun downloadsOnlyTheSelectedTrackAndRemovesItsLocalCopy() = withTrack { track, audio, requests, _ ->
        capture("track-download-menu")
        compose.onNodeWithText("Скачать").performClick()
        compose.waitUntil(15_000) { container.downloads.completed(track.id) != null }
        val download = checkNotNull(container.downloads.completed(track.id))
        assertEquals(audio.size.toLong(), download.bytesDownloaded)
        val streamRequests = requests.filter { it.endsWith("/stream") }
        assertEquals(listOf("GET /api/tracks/${track.id}/stream"), streamRequests)

        // Reading the finished item must use the persisted cache without another stream request.
        val cached = ByteArrayOutputStream()
        container.downloads.playback.createDataSource().let { source ->
            try {
                source.open(DataSpec(download.request.uri))
                val buffer = ByteArray(4096)
                while (true) {
                    val count = source.read(buffer, 0, buffer.size)
                    if (count == -1) break
                    cached.write(buffer, 0, count)
                }
            } finally { source.close() }
        }
        assertArrayEquals(audio, cached.toByteArray())
        assertEquals(streamRequests, requests.filter { it.endsWith("/stream") })

        compose.onNodeWithText("Open actions").performClick()
        compose.onNodeWithText("Удалить загрузку").assertIsDisplayed().performClick()
        compose.waitUntil(10_000) { track.id !in container.downloads.state.value }
        assertFalse(requests.any { it.startsWith("DELETE ") })
        compose.onNodeWithText("Open actions").performClick()
        compose.onNodeWithText("Скачать").assertIsDisplayed()
    }

    @Test fun cancelsAnInProgressDownloadFromTheSameTrackMenu() = withTrack(holdResponse = true) { track, _, requests, release ->
        compose.onNodeWithText("Скачать").performClick()
        compose.waitUntil(10_000) { track.id in container.downloads.state.value && requests.any { it.endsWith("/stream") } }
        compose.onNodeWithText("Open actions").performClick()
        compose.onNodeWithText("Отменить загрузку").assertIsDisplayed().performClick()
        compose.waitUntil(10_000) { track.id !in container.downloads.state.value }
        release.countDown()
        compose.onNodeWithText("Open actions").performClick()
        compose.onNodeWithText("Скачать").assertIsDisplayed()
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        instrumentation.waitForIdleSync()
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "$name.png")
            put(MediaStore.Downloads.MIME_TYPE, "image/png")
            put(MediaStore.Downloads.RELATIVE_PATH, "Download/CaimackReview/downloads")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = checkNotNull(context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        context.contentResolver.openOutputStream(uri)!!.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
    }
}
