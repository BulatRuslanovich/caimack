// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.DatabaseProvider
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.DefaultDownloadIndex
import androidx.media3.exoplayer.offline.DefaultDownloaderFactory
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.Downloader
import androidx.media3.exoplayer.scheduler.Requirements
import app.caimack.R
import app.caimack.api.Track
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.OkHttpClient

internal data class LibraryAudio(val track: Track, val url: HttpUrl, val version: String, val size: Long)

/** Uses the standard Media3 cache and downloader, with a queue controlled by the LAN sync job. */
@OptIn(UnstableApi::class)
internal class LibraryDownloads(
    private val context: Context,
    database: DatabaseProvider,
    cache: Cache,
    executor: Executor,
    private val json: Json,
) {
    private data class Connection(val client: OkHttpClient, val active: () -> Boolean)

    @Volatile private var connection: Connection? = null
    private val index = DefaultDownloadIndex(database, "Library")
    private val byTrack = ConcurrentHashMap<String, List<Offline>>()
    private val changes = MutableStateFlow(0L)
    val revision = changes.asStateFlow()

    init {
        index.getDownloads().use { cursor ->
            while (cursor.moveToNext()) remember(cursor.download)
        }
    }

    private val managerDelegate = lazy {
        val upstream = OkHttpDataSource.Factory { request ->
            val lan = connection?.takeIf { it.active() } ?: throw IOException("Library sync stopped")
            lan.client.newCall(request)
        }
        val cacheSources = CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(upstream)
        val downloaders = DefaultDownloaderFactory(cacheSources, executor)
        DownloadManager(context, index) { request ->
            object : Downloader {
                @Volatile private var downloader = downloaders.createDownloader(request)
                @Volatile private var canceled = false

                override fun download(progressListener: Downloader.ProgressListener?) {
                    if (canceled) throw InterruptedException()
                    downloader.download(progressListener)
                    if (canceled) throw InterruptedException()
                    try {
                        verify(cacheSources, request)
                    } catch (error: IOException) {
                        downloader.remove()
                        // After discarding the cache, a fresh writer must start at byte zero.
                        downloader = downloaders.createDownloader(request)
                        throw error
                    }
                }

                override fun cancel() {
                    canceled = true
                    downloader.cancel()
                }

                override fun remove() = downloader.remove()
            }
        }.apply {
            // Media3's default requires validated Internet. The job supplies a bound Wi-Fi/Ethernet client.
            requirements = Requirements(0)
            maxParallelDownloads = 2
            addListener(object : DownloadManager.Listener {
                override fun onDownloadChanged(manager: DownloadManager, download: Download, error: Exception?) {
                    remember(download)
                    changes.value++
                }

                override fun onDownloadRemoved(manager: DownloadManager, download: Download) {
                    val id = trackId(download.request)
                    byTrack.computeIfPresent(id) { _, entries ->
                        entries.filterNot { it.download.request.id == download.request.id }.takeIf { it.isNotEmpty() }
                    }
                    changes.value++
                }
            })
        }
    }
    private val manager by managerDelegate

    fun release() {
        if (managerDelegate.isInitialized()) manager.release()
    }

    private fun trackId(request: DownloadRequest) = request.id.substringAfter(':').substringBeforeLast(':')

    private fun verify(sources: CacheDataSource.Factory, request: DownloadRequest) {
        val source = sources.createDataSourceForRemovingDownload()
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            source.open(DataSpec.Builder().setUri(request.uri).setKey(request.customCacheKey).build())
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                if (Thread.interrupted()) throw InterruptedException()
                val count = source.read(buffer, 0, buffer.size)
                if (count == -1) break
                digest.update(buffer, 0, count)
            }
        } finally {
            source.close()
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != request.id.substringAfterLast(':')) throw IOException("Downloaded audio checksum mismatch")
    }

    private fun remember(download: Download) {
        val track = runCatching { json.decodeFromString<Track>(download.request.data.decodeToString()) }.getOrNull() ?: return
        val entry = Offline(download, track)
        byTrack.compute(track.id) { _, entries ->
            entries.orEmpty().filterNot { it.download.request.id == download.request.id } + entry
        }
    }

    private fun Offline.belongsTo(owner: String) = download.request.id.startsWith("$owner:")

    fun entries(owner: String): List<Offline> = byTrack.values.flatten().filter { it.belongsTo(owner) }

    fun completed(owner: String, trackId: String): Offline? = byTrack[trackId].orEmpty()
        .filter { it.done && it.belongsTo(owner) }.maxByOrNull { it.download.updateTimeMs }

    fun remove(owner: String, trackIds: Collection<String>) {
        trackIds.forEach { trackId ->
            byTrack[trackId].orEmpty().filter { it.belongsTo(owner) }.forEach { manager.removeDownload(it.download.request.id) }
        }
    }

    suspend fun sync(
        owner: String,
        files: List<LibraryAudio>,
        client: OkHttpClient,
        active: () -> Boolean,
        progress: (completed: Int, bytes: Long, totalBytes: Long) -> Unit,
    ) {
        val wanted = files.associateBy { "$owner:${it.track.id}:${it.version}" }
        val trackIds = files.mapTo(hashSetOf()) { it.track.id }
        val totalBytes = files.sumOf { it.size }
        withContext(Dispatchers.Main) {
            if (!active()) throw CancellationException("Library sync stopped")
            val manager = manager
            awaitIdle(manager)
            // A process may have stopped with queued work for another account or an older snapshot.
            manager.currentDownloads.filter { it.stopReason == Download.STOP_REASON_NONE }
                .forEach { manager.setStopReason(it.request.id, WAITING_FOR_SYNC) }

            val previous = entries(owner).groupBy { it.track!!.id }
            fun removeOtherVersions(trackId: String, keep: String) {
                previous[trackId].orEmpty().filter { it.download.request.id != keep }
                    .forEach { manager.removeDownload(it.download.request.id) }
            }
            fun entry(id: String, file: LibraryAudio) = byTrack[file.track.id].orEmpty()
                .firstOrNull { it.download.request.id == id }

            previous.filterKeys { it !in trackIds }.values.flatten()
                .forEach { manager.removeDownload(it.download.request.id) }

            var completed = 0
            var bytes = 0L
            val pending = wanted.filter { (id, file) ->
                if (entry(id, file)?.done == true) {
                    completed++
                    bytes += file.size
                    removeOtherVersions(file.track.id, id)
                    false
                } else {
                    // Keep the last complete version playable while replacing it.
                    previous[file.track.id].orEmpty().filter { !it.done && it.download.request.id != id }
                        .forEach { manager.removeDownload(it.download.request.id) }
                    true
                }
            }
            progress(completed, bytes, totalBytes)

            var failed = 0
            connection = Connection(client, active)
            try {
                for (batch in pending.entries.chunked(BATCH_SIZE)) {
                    if (!active()) throw CancellationException("Library sync stopped")
                    batch.forEach { (id, file) ->
                        manager.addDownload(
                            DownloadRequest.Builder(id, file.url.toString().toUri())
                                .setCustomCacheKey("library:$id")
                                .setData(json.encodeToString(file.track).encodeToByteArray())
                                .build(),
                        )
                    }
                    manager.resumeDownloads()
                    while (withTimeoutOrNull(500) { awaitIdle(manager); true } != true) {
                        if (!active()) throw CancellationException("Library sync stopped")
                        val finished = batch.count { (id, file) -> entry(id, file)?.done == true }
                        val transferred = batch.sumOf { (id, file) ->
                            entry(id, file)?.download?.bytesDownloaded?.coerceIn(0L, file.size) ?: 0L
                        }
                        progress(completed + finished, bytes + transferred, totalBytes)
                    }
                    if (!active()) throw CancellationException("Library sync stopped")
                    batch.forEach { (id, file) ->
                        if (entry(id, file)?.done == true) {
                            completed++
                            bytes += file.size
                            removeOtherVersions(file.track.id, id)
                        } else failed++
                    }
                    progress(completed, bytes, totalBytes)
                }
                awaitIdle(manager)
            } finally {
                manager.pauseDownloads()
                connection = null
            }
            if (failed > 0) throw IOException(context.getString(R.string.sync_audio_failed, failed))
        }
    }

    private companion object {
        const val BATCH_SIZE = 24
        const val WAITING_FOR_SYNC = 1
    }
}
