// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import app.caimack.api.Track
import app.caimack.api.UserSettings
import app.caimack.session.Server
import java.io.File
import java.util.concurrent.Executors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

@OptIn(UnstableApi::class)
data class Offline(val download: Download, val track: Track?) {
    val done: Boolean get() = download.state == Download.STATE_COMPLETED
    val percent: Float get() = download.percentDownloaded.coerceIn(0f, 100f)
}

@OptIn(UnstableApi::class)
class Downloads(
    private val context: Context,
    private val http: OkHttpClient,
    private val server: Server,
    private val json: Json,
) {
    private val database = StandaloneDatabaseProvider(context)
    private val cache = SimpleCache(File(context.filesDir, "downloads"), NoOpCacheEvictor(), database)
    private val upstream = OkHttpDataSource.Factory(http)
    private val current = MutableStateFlow<Map<String, Offline>>(emptyMap())

    val state: StateFlow<Map<String, Offline>> = current

    val manager = DownloadManager(context, database, cache, upstream, Executors.newFixedThreadPool(2)).apply {
        maxParallelDownloads = 2
        addListener(object : DownloadManager.Listener {
            override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) {
                current.value = current.value + (download.request.id to offlineOf(download))
            }

            override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) {
                current.value = current.value - download.request.id
            }
        })
    }

    val playback: CacheDataSource.Factory = CacheDataSource.Factory()
        .setCache(cache)
        .setUpstreamDataSourceFactory(upstream)
        .setCacheWriteDataSinkFactory(null)

    init {
        val all = mutableMapOf<String, Offline>()
        manager.downloadIndex.getDownloads().use { cursor ->
            while (cursor.moveToNext()) all[cursor.download.request.id] = offlineOf(cursor.download)
        }
        current.value = all + current.value
    }

    fun completed(trackId: String): Download? = current.value[trackId]?.takeIf { it.done }?.download

    fun tracks(): List<Track> = current.value.values.filter { it.done }.mapNotNull { it.track }.sortedBy { it.title.lowercase() }

    suspend fun add(tracks: List<Track>, settings: UserSettings) {
        for (track in missing(tracks)) {
            DownloadService.sendAddDownload(context, OfflineService::class.java, request(track, settings), false)
        }
    }

    suspend fun addInBackground(tracks: List<Track>, settings: UserSettings): List<String> {
        withContext(Dispatchers.Main) { manager.resumeDownloads() }
        val fresh = missing(tracks)
        for (track in fresh) {
            val request = request(track, settings)
            withContext(Dispatchers.Main) { manager.addDownload(request) }
        }
        return fresh.map { it.id }
    }

    fun removeInBackground(trackIds: Collection<String>) = trackIds.forEach { manager.removeDownload(it) }

    suspend fun awaitIdle() = withContext(Dispatchers.Main) {
        if (manager.isIdle) return@withContext
        suspendCancellableCoroutine { continuation ->
            val listener = object : DownloadManager.Listener {
                override fun onIdle(downloadManager: DownloadManager) {
                    downloadManager.removeListener(this)
                    if (continuation.isActive) continuation.resume(Unit)
                }
            }
            manager.addListener(listener)
            continuation.invokeOnCancellation { manager.removeListener(listener) }
        }
    }

    private fun missing(tracks: List<Track>) =
        tracks.filter { current.value[it.id]?.download?.state.let { state -> state == null || state == Download.STATE_FAILED } }

    private suspend fun request(track: Track, settings: UserSettings): DownloadRequest {
        val (uri, mime) = sourceOf(track, settings)
        return DownloadRequest.Builder(track.id, uri.toUri())
            .setMimeType(mime)
            .setData(json.encodeToString(Track.serializer(), track).toByteArray())
            .build()
    }

    fun remove(trackIds: Collection<String>) = trackIds.forEach {
        DownloadService.sendRemoveDownload(context, OfflineService::class.java, it, false)
    }

    private suspend fun sourceOf(track: Track, settings: UserSettings): Pair<String, String?> {
        val original = server.resolve("api/tracks/${track.id}/stream").toString() to null
        if (settings.quality == "Original") return original

        val master = server.resolve("api/tracks/${track.id}/hls/master.m3u8")
            ?.newBuilder()?.addQueryParameter("maxQuality", if (settings.quality == "Original") "Normal" else settings.quality)?.build()
            ?: return original

        val variant = withContext(Dispatchers.IO) {
            runCatching {
                http.newCall(Request.Builder().url(master).build()).execute().use { response ->
                    if (response.code != 200) return@use null
                    response.body.string().lines()
                        .zipWithNext()
                        .filter { (info, _) -> info.startsWith("#EXT-X-STREAM-INF") }
                        .maxByOrNull { (info, _) -> BANDWIDTH.find(info)?.groupValues?.get(1)?.toLong() ?: 0 }
                        ?.let { (_, path) -> master.resolve(path) }
                }
            }.getOrNull()
        }
        return variant?.let { it.toString() to MimeTypes.APPLICATION_M3U8 } ?: original
    }

    private fun offlineOf(download: Download) = Offline(
        download,
        runCatching { json.decodeFromString(Track.serializer(), String(download.request.data)) }.getOrNull(),
    )

    private companion object {
        val BANDWIDTH = Regex("BANDWIDTH=(\\d+)")
    }
}
