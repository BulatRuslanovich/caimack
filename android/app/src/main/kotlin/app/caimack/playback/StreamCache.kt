// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.FileDataSource
import androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSink
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.source.ClippingMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import app.caimack.sync.PlaybackSync
import app.caimack.sync.sha256
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection.HTTP_ACCEPTED
import okhttp3.Call
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

@OptIn(UnstableApi::class)
internal class StreamCache(
    private val context: Context,
    private val http: Call.Factory,
    private val owner: () -> PlaybackSync.Owner?,
    private val directory: File = File(context.cacheDir, "music-streams"),
    capacityBytes: Long = 256 * 1024 * 1024L,
) : AutoCloseable {
    private data class StreamOrigin(val owner: PlaybackSync.Owner?, val uri: Uri) {
        // The HLS master URL includes the quality cap. Each rendition has its own resource URI.
        val namespace = owner?.let { sha256("${it.address}\n${it.userId}\n$uri".toByteArray()) }
    }

    private val database = lazy { StandaloneDatabaseProvider(context) }
    private val disk = lazy {
        try {
            SimpleCache(directory, LeastRecentlyUsedCacheEvictor(capacityBytes), database.value).let { cache ->
                try {
                    cache.checkInitialization()
                    cache
                } catch (error: Cache.CacheException) {
                    cache.release()
                    throw error
                }
            }
        } catch (error: Exception) {
            Log.w("Caimack", "Music stream cache unavailable", error)
            null
        }
    }

    fun online(item: MediaItem, uri: Uri, mimeType: String?): MediaItem = item.buildUpon()
        .setUri(uri)
        .setMimeType(mimeType)
        .setStreamKeys(emptyList())
        .setCustomCacheKey(null)
        .setTag(StreamOrigin(owner(), uri))
        .build()

    fun canPreload(item: MediaItem): Boolean =
        (item.localConfiguration?.tag as? StreamOrigin)?.let { it.owner != null && it.owner == owner() } == true

    fun playbackFactory(local: DataSource.Factory, errors: LoadErrorHandlingPolicy): MediaSource.Factory {
        val offline = DefaultMediaSourceFactory(local).setLoadErrorHandlingPolicy(errors)
        return object : MediaSource.Factory by offline {
            override fun createMediaSource(mediaItem: MediaItem): MediaSource {
                val origin = mediaItem.localConfiguration?.tag as? StreamOrigin
                    ?: return offline.createMediaSource(mediaItem)
                return DefaultMediaSourceFactory(sources(origin, http))
                    .setLoadErrorHandlingPolicy(errors)
                    .createMediaSource(mediaItem)
            }
        }
    }

    fun preloadSource(item: MediaItem, calls: Call.Factory, errors: LoadErrorHandlingPolicy): MediaSource {
        val origin = item.localConfiguration?.tag as StreamOrigin
        val data = sources(origin, calls, preload = true)
        if (item.localConfiguration?.mimeType == MimeTypes.APPLICATION_M3U8) {
            return DefaultMediaSourceFactory(data).setLoadErrorHandlingPolicy(errors).createMediaSource(item)
        }
        val source = ProgressiveMediaSource.Factory(data)
            // The default 1 MiB interval can be more than a minute of compressed music.
            .setContinueLoadingCheckIntervalBytes(32 * 1024)
            .setLoadErrorHandlingPolicy(errors)
            .createMediaSource(item)
        return if (item.clippingConfiguration == MediaItem.ClippingConfiguration.UNSET) source
        else ClippingMediaSource.Builder(source).setClippingConfiguration(item.clippingConfiguration).build()
    }

    private fun sources(origin: StreamOrigin, calls: Call.Factory, preload: Boolean = false): DataSource.Factory {
        val upstream = OkHttpDataSource.Factory(calls)
        val network = DataSource.Factory {
            val source = upstream.createDataSource()
            object : DataSource by source {
                override fun open(dataSpec: DataSpec): Long {
                    checkOwner(origin)
                    val length = source.open(dataSpec)
                    if (source.responseCode == HTTP_ACCEPTED && dataSpec.uri.path.orEmpty().endsWith(".m3u8")) {
                        // Caimack sends an empty 202 while the renditions are being generated.
                        throw InvalidResponseCodeException(
                            HTTP_ACCEPTED, null, null, source.responseHeaders, dataSpec, byteArrayOf(),
                        )
                    }
                    return length
                }
            }
        }
        return DataSource.Factory {
            val direct = network.createDataSource()
            StreamDataSource(direct, origin, preload) {
                disk.value?.let { cache ->
                    CacheDataSource.Factory()
                        .setCache(cache)
                        .setFlags(if (preload) CacheDataSource.FLAG_BLOCK_ON_CACHE else 0)
                        .setUpstreamDataSourceFactory(network)
                        .setCacheWriteDataSinkFactory(CacheDataSink.Factory().setCache(cache).setFragmentSize(512 * 1024L))
                        .setCacheKeyFactory { spec -> "${origin.namespace}:${spec.uri}" }
                        .createDataSource()
                }
            }
        }
    }

    private fun checkOwner(origin: StreamOrigin) {
        if (origin.owner != null && origin.owner != owner()) throw IOException("Playback account changed")
    }

    private inner class StreamDataSource(
        private val direct: DataSource,
        private val origin: StreamOrigin,
        private val preload: Boolean,
        createCacheSource: () -> CacheDataSource?,
    ) : DataSource {
        private val listeners = mutableListOf<TransferListener>()
        private var active = direct
        private var spec: DataSpec? = null
        private var bytesRead = 0L
        private var cacheFailed = false
        private val cachedSource = lazy { createCacheSource()?.also { listeners.forEach(it::addTransferListener) } }

        override fun open(dataSpec: DataSpec): Long {
            checkOwner(origin)
            spec = dataSpec
            bytesRead = 0
            val cacheable = dataSpec.httpMethod == DataSpec.HTTP_METHOD_GET && origin.owner?.let {
                dataSpec.uri.toString().toHttpUrlOrNull()?.toString()?.startsWith(it.address.toString())
            } == true
            val source = if (cacheable && !cacheFailed) cachedSource.value else null
            if (preload && source == null) throw IOException("Music stream cache unavailable")
            active = source ?: direct
            return try {
                active.open(dataSpec)
            } catch (error: IOException) {
                useNetwork(error)
            }
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            val count = try {
                active.read(buffer, offset, length)
            } catch (error: IOException) {
                useNetwork(error)
                active.read(buffer, offset, length)
            }
            if (count > 0) bytesRead += count
            return count
        }

        private fun useNetwork(error: IOException): Long {
            if (active === direct || preload || !isCacheError(error)) throw error
            cacheFailed = true
            runCatching { active.close() }
            active = direct
            return direct.open(checkNotNull(spec).subrange(bytesRead))
        }

        override fun addTransferListener(transferListener: TransferListener) {
            direct.addTransferListener(transferListener)
            if (cachedSource.isInitialized()) cachedSource.value?.addTransferListener(transferListener)
            else listeners.add(transferListener)
        }

        override fun getUri(): Uri? = active.uri
        override fun getResponseHeaders(): Map<String, List<String>> = active.responseHeaders
        override fun close() {
            try {
                active.close()
            } catch (error: IOException) {
                if (active === direct || !isCacheError(error)) throw error
                cacheFailed = true
            }
        }

        private fun isCacheError(error: IOException) =
            error is Cache.CacheException || error is FileDataSource.FileDataSourceException
    }

    override fun close() {
        if (disk.isInitialized()) disk.value?.release()
        if (database.isInitialized()) database.value.close()
    }
}
