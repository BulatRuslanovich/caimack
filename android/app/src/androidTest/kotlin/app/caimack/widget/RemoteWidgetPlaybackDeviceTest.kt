// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.widget

import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetHostView
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.media.session.MediaController
import android.media.session.MediaController.PlaybackInfo
import android.media.session.MediaSessionManager
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.media3.common.Player
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockResponseBody
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import okio.BufferedSink
import okio.Buffer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Real Connect SSE -> selected player -> both system-hosted widgets, without local audio. */
class RemoteWidgetPlaybackDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val container get() = (context.applicationContext as CaimackApp).container
    private val web = MockWebServer()
    private val running = AtomicBoolean(true)
    private val streamAvailable = AtomicBoolean(true)
    private val events = LinkedBlockingQueue<String>()
    private val commands = LinkedBlockingQueue<ConnectRequest>()
    private val snapshot = AtomicReference(ConnectSnapshot())
    private val songs = listOf(
        Track("remote-one", "First remote song", "artist", "Remote artist", durationSeconds = 180),
        Track("remote-two", "Second remote song", "artist", "Remote artist", durationSeconds = 240),
    )
    private val originalLocalHttp = container.connectionPreferences.allowLocalHttp.value
    private val host = AppWidgetHost(context, 7302)
    private val ids = mutableListOf<Int>()
    private val widgets = mutableListOf<AppWidgetHostView>()
    private var systemController: MediaController? = null

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()
    private fun event(value: ConnectSnapshot) = "event: snapshot\ndata: ${container.json.encodeToString(value)}\n\n"

    private fun audio(): ByteArray {
        val size = 40 * 8000 * 2
        return ByteBuffer.allocate(44 + size).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray())
            putInt(36 + size)
            put("WAVEfmt ".toByteArray())
            putInt(16)
            putShort(1)
            putShort(1)
            putInt(8000)
            putInt(16000)
            putShort(2)
            putShort(16)
            put("data".toByteArray())
            putInt(size)
        }.array()
    }

    private fun publish(change: (ConnectState) -> ConnectState): ConnectSnapshot {
        val next = snapshot.updateAndGet { previous ->
            previous.copy(version = previous.version + 1,
                playback = change(checkNotNull(previous.playback)).copy(reportedAt = "report-${previous.version + 1}"))
        }
        events.offer(event(next))
        return next
    }

    @Before fun start() = runBlocking {
        assertTrue("Protect the real application and its widgets", context.packageName.endsWith(".uitest"))
        snapshot.set(ConnectSnapshot("widget-test", 1, listOf(
            ConnectDevice(container.deviceId, "Phone", "phone-connection", "android"),
            ConnectDevice("desktop", "Other device", "desktop-connection"),
        ), ConnectState(deviceId = "desktop", reportedAt = "report-1", trackIds = songs.map { it.id },
            order = songs.indices.toList(), positionSeconds = 12.0, isPlaying = true)))
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/api/auth/login", "/api/auth/me" -> json(container.json.encodeToString(User("widget-test", "Widget test")))
                "/api/config" -> json("{\"recommendationsEnabled\":false}")
                "/api/me/settings" -> json("{\"quality\":\"Original\"}")
                "/api/home/feed" -> json("{\"blocks\":[]}")
                "/api/sync/identity" -> json("{\"serverId\":\"widget-server\",\"userId\":\"widget-test\"}")
                "/api/sync/actions" -> MockResponse.Builder().code(503).build()
                "/api/tracks/lookup" -> json(container.json.encodeToString(songs))
                "/api/tracks/${songs[0].id}/stream", "/api/tracks/${songs[1].id}/stream" -> if (!streamAvailable.get()) MockResponse.Builder().code(503).build()
                else MockResponse.Builder()
                    .code(200).addHeader("Content-Type", "audio/wav").body(Buffer().write(audio())).build()
                "/api/playback/connect/events" -> if (!streamAvailable.get()) MockResponse.Builder().code(503).build()
                else MockResponse.Builder().code(200)
                    .addHeader("Content-Type", "text/event-stream")
                    .onResponseEnd(SocketEffect.CloseSocket())
                    .body(object : MockResponseBody {
                        override val contentLength = Long.MAX_VALUE
                        override fun writeTo(sink: BufferedSink) {
                            sink.writeUtf8(event(snapshot.get())).flush()
                            while (running.get()) {
                                val next = events.take()
                                if (next.isEmpty()) break
                                sink.writeUtf8(next).flush()
                            }
                        }
                    }).build()
                "/api/playback/connect/commands" -> {
                    val command = container.json.decodeFromString<ConnectRequest>(checkNotNull(request.body).utf8())
                    commands.offer(command)
                    json(container.json.encodeToString(publish { state -> when (val action = command.command) {
                        ConnectCommand.Next -> state.copy(index = 1, positionSeconds = 0.0)
                        ConnectCommand.Previous -> state.copy(index = 0, positionSeconds = 0.0)
                        is ConnectCommand.SetPlaying -> state.copy(isPlaying = action.playing)
                        else -> state
                    } }))
                }
                "/api/playback/connect/state" -> json(container.json.encodeToString(snapshot.get()))
                "/api/playlists", "/api/playlists/public", "/api/genres" -> json("[]")
                else -> MockResponse.Builder().code(204).build()
            }
        }
        web.start()
        container.connectionPreferences.setAllowLocalHttp(true)
        check(container.session.login(web.url("/").toString(), "Widget test", "fixture") == null)
        instrumentation.uiAutomation.adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET")
        instrumentation.runOnMainSync {
            val manager = AppWidgetManager.getInstance(context)
            val root = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            compose.activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            compose.activity.setContentView(root)
            host.startListening()
            val density = context.resources.displayMetrics.density
            listOf(Triple(NowPlayingWidget::class.java, 340, 160), Triple(RecordWidget::class.java, 170, 170)).forEach { (provider, width, height) ->
                val options = Bundle().apply {
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, width)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, width)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, height)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, height)
                }
                val id = host.allocateAppWidgetId().also { ids += it }
                assertTrue(manager.bindAppWidgetIdIfAllowed(id, ComponentName(context, provider), options))
                val view = host.createView(context, id, manager.getAppWidgetInfo(id))
                root.addView(view, LinearLayout.LayoutParams((width * density).toInt(), (height * density).toInt()))
                widgets += view
            }
        }
        instrumentation.uiAutomation.dropShellPermissionIdentity()
    }

    @After fun stop() {
        instrumentation.runOnMainSync {
            container.downloads.removeInBackground(songs.map { it.id }.filter { it in container.downloads.state.value })
        }
        instrumentation.runOnMainSync { host.stopListening(); ids.forEach(host::deleteAppWidgetId) }
        instrumentation.uiAutomation.dropShellPermissionIdentity()
        runBlocking { container.session.logout() }
        running.set(false)
        events.offer("")
        container.connectionPreferences.setAllowLocalHttp(originalLocalHttp)
        web.close()
    }

    private fun await(check: () -> Boolean) = compose.waitUntil(10_000) {
        var result = false
        instrumentation.runOnMainSync { result = check() }
        result
    }

    private fun awaitTrack(track: Track, playing: Boolean) {
        try {
            await {
                widgets.all { it.findViewById<TextView>(R.id.widget_title)?.text == track.title } &&
                    widgets[0].findViewById<View>(R.id.widget_primary)?.contentDescription ==
                    context.getString(if (playing) R.string.widget_pause else R.string.widget_play)
            }
        } catch (failure: Throwable) {
            throw AssertionError("Expected ${track.title}, playing=$playing; output=${container.connect.state.value.selectedId}; " +
                "stored=${context.getSharedPreferences("widget", 0).all}; " +
                "views=${widgets.map { it.findViewById<TextView>(R.id.widget_title)?.text }}; " +
                "button=${widgets[0].findViewById<View>(R.id.widget_primary)?.contentDescription}", failure)
        }
    }

    private fun click(widget: Int, id: Int) = instrumentation.runOnMainSync { widgets[widget].findViewById<View>(id).performClick() }

    private fun systemPlaybackType(): Int? {
        if (systemController == null) {
            val automation = instrumentation.uiAutomation
            automation.adoptShellPermissionIdentity("android.permission.MEDIA_CONTENT_CONTROL")
            try {
                systemController = context.getSystemService(MediaSessionManager::class.java).getActiveSessions(null)
                    .firstOrNull { it.packageName == context.packageName }
            } finally {
                automation.dropShellPermissionIdentity()
            }
        }
        return systemController?.playbackInfo?.playbackType
    }

    @Test fun rendererDisappearanceRestoresSystemVolumeToPhone() {
        publish { it.copy(isPlaying = false) }
        awaitTrack(songs[0], playing = false)
        await { systemPlaybackType() == PlaybackInfo.PLAYBACK_TYPE_REMOTE }

        val withoutDesktop = snapshot.updateAndGet { it.copy(version = it.version + 1, devices = it.devices.filter { device -> device.id != "desktop" }) }
        // The server retains the previous renderer's playback snapshot after it unregisters.
        events.offer(event(withoutDesktop))
        await {
            val state = container.connect.state.value
            state.connected && state.selectedId == null && state.playback == null && systemPlaybackType() == PlaybackInfo.PLAYBACK_TYPE_LOCAL
        }
        awaitTrack(songs[0], playing = false)
    }

    @Test fun lostConnectionResumesDownloadedTrackAndDoesNotReselectDesktop() {
        runBlocking { container.downloads.addInBackground(listOf(songs[1]), UserSettings(quality = "Original")) }
        compose.waitUntil(15_000) { container.locallyAvailable(songs[1].id) }
        publish { it.copy(index = 1, positionSeconds = 12.0, shuffle = true, repeat = "all", order = listOf(1, 0)) }
        awaitTrack(songs[1], playing = true)
        await { systemPlaybackType() == PlaybackInfo.PLAYBACK_TYPE_REMOTE }

        streamAvailable.set(false)
        events.offer("")
        await { container.connect.state.value.selectedId == null && systemPlaybackType() == PlaybackInfo.PLAYBACK_TYPE_LOCAL }
        try {
            await {
                val local = container.player.localState
                local.playing && !local.buffering && local.queue.map { it.id } == listOf(songs[1].id) && local.index == 0 && local.shuffle &&
                    local.repeat == Player.REPEAT_MODE_ALL && container.player.localPosition in 12_000L..20_000L
            }
        } catch (failure: ComposeTimeoutException) {
            var observed = ""
            instrumentation.runOnMainSync {
                observed = "${container.player.localState} at ${container.player.localPosition}ms"
            }
            throw AssertionError("Expected downloaded track to resume on the phone. Observed $observed", failure)
        }
        awaitTrack(songs[1], playing = true)

        streamAvailable.set(true)
        await { container.connect.state.value.connected }
        assertNull(container.connect.state.value.selectedId)
        assertEquals(PlaybackInfo.PLAYBACK_TYPE_LOCAL, systemPlaybackType())
    }

    @Test fun briefTransportInterruptionKeepsReachableRenderer() {
        awaitTrack(songs[0], playing = true)
        await { systemPlaybackType() == PlaybackInfo.PLAYBACK_TYPE_REMOTE }
        events.offer("")
        await { !container.connect.state.value.connected }
        await { container.connect.state.value.connected }
        assertEquals("desktop", container.connect.state.value.selectedId)
        assertEquals(PlaybackInfo.PLAYBACK_TYPE_REMOTE, systemPlaybackType())
    }

    @Test fun remoteTracksProgressAndControlsReachBothWidgetsAndReturnToLocal() {
        awaitTrack(songs[0], playing = true)
        assertFalse("The phone must stay silent while observing another output", container.player.localState.playing)
        assertEquals("desktop", container.connect.state.value.selectedId)
        click(0, R.id.widget_secondary)
        awaitTrack(songs[1], playing = true)
        assertEquals("desktop", commands.last().deviceId)
        assertEquals(ConnectCommand.Next, commands.last().command)
        click(1, R.id.widget_previous)
        awaitTrack(songs[0], playing = true)
        assertEquals(ConnectCommand.Previous, commands.last().command)
        click(0, R.id.widget_primary)
        awaitTrack(songs[0], playing = false)
        assertEquals(ConnectCommand.SetPlaying(false), commands.last().command)

        // A change made on the other device must arrive without opening the app UI.
        publish { it.copy(index = 1, isPlaying = true, positionSeconds = 60.0) }
        awaitTrack(songs[1], playing = true)
        await { widgets[0].findViewById<ProgressBar>(R.id.widget_progress)?.progress in 250..270 }
        click(0, R.id.widget_like)
        await { context.getSharedPreferences("widget", 0).getBoolean("liked", false) }
        awaitTrack(songs[1], playing = true)

        publish { it.copy(isPlaying = false) }
        awaitTrack(songs[1], playing = false)
        instrumentation.runOnMainSync {
            // Returning to an empty local renderer must also update the selected output.
            // Clearing the remote queue first avoids transferring or playing any audio here.
            publish { it.copy(trackIds = emptyList(), order = emptyList(), index = 0) }
        }
        await { container.player.state.value.current == null }
        runBlocking(Dispatchers.Main) { container.connect.select(null) }
        val local = Track("local", "Local song", "artist", "Local artist", durationSeconds = 120)
        instrumentation.runOnMainSync {
            container.player.loadRemote(listOf(local), ConnectCommand.Play(listOf(local.id), 0, 0.0, false, false, "off"))
        }
        awaitTrack(local, playing = false)
        assertNull(container.connect.state.value.selectedId)
    }
}
