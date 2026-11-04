// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import app.caimack.session.Server
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okio.BufferedSource

class ExclusiveSession(
    http: OkHttpClient,
    private val server: Server,
    private val deviceId: String,
    private val deviceName: String,
    private val scope: CoroutineScope,
    private val onClaimed: () -> Unit,
    private val onDisplaced: (byDevice: String?) -> Unit,
) {
    private val client = http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var job: Job? = null
    @Volatile private var call: Call? = null

    fun hold() {
        if (job?.isActive == true) return
        job = scope.launch(Dispatchers.IO) {
            var attempt = 0
            while (isActive) {
                val url = server.resolve("api/playback/session")?.newBuilder()
                    ?.addQueryParameter("deviceId", deviceId)
                    ?.addQueryParameter("deviceName", deviceName)
                    ?.build() ?: return@launch
                var displacedBy: String? = null
                val displaced = try {
                    val current = client.newCall(Request.Builder().url(url).header("Accept", "text/event-stream").build())
                    call = current
                    if (!isActive) current.cancel()
                    current.execute().use { response ->
                        if (!response.isSuccessful) return@use false
                        attempt = 0
                        watch(response.body.source()) { displacedBy = it }
                    }
                } catch (_: IOException) {
                    false
                }

                if (displaced) {
                    withContext(Dispatchers.Main) { onDisplaced(displacedBy) }
                    return@launch
                }
                val pause = RECONNECT_DELAYS_MS.getOrNull(attempt++) ?: return@launch
                delay(pause)
            }
        }
    }

    fun release() {
        call?.cancel()
        call = null
        job?.cancel()
        job = null
    }

    private fun watch(source: BufferedSource, onTakeover: (String?) -> Unit): Boolean {
        var event: String? = null
        for (line in generateSequence { source.readUtf8Line() }) {
            when {
                line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                line.startsWith("data:") && event == "displaced" -> onTakeover(takeoverName(line.removePrefix("data:")))
                line.isBlank() && event == "displaced" -> return true
                line.isBlank() && event == "claimed" -> scope.launch(Dispatchers.Main) { onClaimed() }
            }
            if (line.isBlank()) event = null
        }
        return false
    }

    private fun takeoverName(data: String): String? = runCatching {
        Json.parseToJsonElement(data.trim()).jsonObject["deviceName"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
    }.getOrNull()

    private companion object {
        val RECONNECT_DELAYS_MS = listOf(1_000L, 3_000L, 8_000L)
    }
}
