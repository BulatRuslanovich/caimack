// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.audiobooks

import android.net.Uri
import android.util.AtomicFile
import android.util.Log
import androidx.core.net.toUri
import androidx.core.util.readText
import androidx.core.util.writeText
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import retrofit2.HttpException

internal data class AudiobookAccount(val server: HttpUrl, val user: String) {
    fun endpoint(vararg segments: String): HttpUrl = server.newBuilder()
        .addPathSegments("api/audiobooks").apply { segments.forEach { addPathSegment(it) } }.build()
}

data class AudiobookCatalog(
    val books: List<Audiobook> = emptyList(),
    val downloaded: Set<String> = emptySet(),
    val downloading: Map<String, Float> = emptyMap(),
    val failedDownloads: Set<String> = emptySet(),
    val ready: Boolean = false,
    val online: Boolean = true,
)

@Serializable
private data class AudiobookCache(
    val books: List<Audiobook> = emptyList(),
    val downloads: Map<String, List<String>> = emptyMap(),
    val pendingProgress: Map<String, AudiobookProgress> = emptyMap(),
    val pendingSaves: Map<String, Boolean> = emptyMap(),
)

@Serializable
private data class AudiobookStatus(
    val progress: Map<String, AudiobookProgress>,
    val saved: Set<String>,
    val pendingProgress: Map<String, AudiobookProgress>,
    val pendingSaves: Map<String, Boolean>,
)

internal class AudiobookStore(
    private val directory: File,
    private val json: Json,
    private val http: OkHttpClient,
    private val api: AudiobookApi,
    private val scope: CoroutineScope,
    private val currentAccount: () -> AudiobookAccount?,
    accounts: Flow<AudiobookAccount?>,
) {
    private val lock = Mutex()
    private val refreshLock = Mutex()
    private val requests = Channel<Unit>(Channel.CONFLATED)
    private val catalogRequested = AtomicBoolean(false)
    private val current = MutableStateFlow(AudiobookCatalog())
    val state = current.asStateFlow()

    private var loaded: AudiobookAccount? = null
    private var cache = AudiobookCache()
    private var metadata = AudiobookCache()
    private var status: AudiobookStatus? = null
    private val downloadJobs = mutableSetOf<Pair<AudiobookAccount, String>>()

    init {
        scope.launch {
            accounts.collectLatest { account ->
                lock.withLock { load(account) }
                if (account == null) return@collectLatest
                var lastFullRefresh = 0L
                var initial = true
                while (true) {
                    val now = android.os.SystemClock.elapsedRealtime()
                    val requested = catalogRequested.getAndSet(false)
                    val full = initial || requested || now - lastFullRefresh >= CATALOG_INTERVAL_MS
                    refresh(account, full)
                    if (full) lastFullRefresh = now
                    initial = false
                    // Retry offline progress even when the same Wi-Fi connection remains up.
                    withTimeoutOrNull((CATALOG_INTERVAL_MS - (android.os.SystemClock.elapsedRealtime() - lastFullRefresh)).coerceAtLeast(1)) {
                        requests.receive()
                    }
                }
            }
        }
    }

    fun requestRefresh() {
        catalogRequested.set(true)
        requests.trySend(Unit)
    }

    suspend fun refreshForPlayback(account: AudiobookAccount, id: String) {
        withTimeoutOrNull(1800) { refresh(account, false, id) }
    }

    fun remote(account: AudiobookAccount, path: String): HttpUrl =
        account.server.newBuilder().addEncodedPathSegments(path.trimStart('/')).build()

    fun cover(book: Audiobook): String? {
        val account = currentAccount() ?: return null
        val local = File(bookDirectory(account, book.id), "cover")
        return if (local.isFile) local.toUri().toString() else book.coverUrl?.let { remote(account, it).toString() }
    }

    fun audio(account: AudiobookAccount, book: Audiobook, chapter: AudiobookChapter): Uri {
        val local = chapterFile(bookDirectory(account, book.id), chapter)
        return if (local.isFile && local.length() == chapter.sizeBytes) local.toUri()
        else remote(account, chapter.streamUrl).toString().toUri()
    }

    suspend fun checkpoint(account: AudiobookAccount, id: String, progress: AudiobookProgress) = withContext(Dispatchers.IO) {
        lock.withLock {
            if (currentAccount() != account) return@withLock
            load(account)
            val known = state.value.books.firstOrNull { it.id == id }?.progress
            if (known != null && (known.updatedAtMs >= progress.updatedAtMs ||
                known.chapterId == progress.chapterId && known.positionMs == progress.positionMs && known.completed == progress.completed)) {
                return@withLock
            }
            persist(account, cache.copy(pendingProgress = cache.pendingProgress + (id to progress)))
            requests.trySend(Unit)
        }
    }

    fun setSaved(id: String, saved: Boolean) {
        val account = currentAccount() ?: return
        scope.launch {
            try {
                lock.withLock {
                    if (currentAccount() != account) return@withLock
                    load(account)
                    persist(account, cache.copy(pendingSaves = cache.pendingSaves + (id to saved)))
                    requests.trySend(Unit)
                }
            } catch (error: IOException) {
                Log.w("Caimack", "Could not save audiobook library change", error)
            }
        }
    }

    fun download(book: Audiobook) {
        val account = currentAccount() ?: return
        scope.launch {
            val key = account to book.id
            val started = lock.withLock {
                if (currentAccount() != account || !downloadJobs.add(key)) return@withLock false
                load(account)
                current.update { it.copy(downloading = it.downloading + (book.id to 0f), failedDownloads = it.failedDownloads - book.id) }
                true
            }
            if (!started) return@launch

            val target = bookDirectory(account, book.id)
            val staging = File(target.parentFile, target.name + ".pending")
            try {
                staging.deleteRecursively()
                if (!staging.mkdirs()) throw IOException("Could not create audiobook download directory")
                val total = book.chapters.sumOf { it.sizeBytes }.coerceAtLeast(1L)
                var bytes = 0L
                var lastPercent = 0
                for (chapter in book.chapters) {
                    if (currentAccount() != account) throw IOException("Audiobook account changed")
                    fetch(account, chapter.streamUrl, chapterFile(staging, chapter)) { amount ->
                        if (currentAccount() != account) throw IOException("Audiobook account changed")
                        bytes += amount
                        val percent = ((bytes.toDouble() / total) * 100).toInt().coerceIn(0, 100)
                        if (percent != lastPercent) {
                            lastPercent = percent
                            current.update { it.copy(downloading = it.downloading + (book.id to percent / 100f)) }
                        }
                    }
                    if (chapterFile(staging, chapter).length() != chapter.sizeBytes) throw IOException("Incomplete audiobook chapter")
                }
                book.coverUrl?.let { path ->
                    try { fetch(account, path, File(staging, "cover")) {} }
                    catch (_: IOException) { File(staging, "cover").delete() }
                }
                lock.withLock {
                    if (currentAccount() != account) return@withLock
                    target.deleteRecursively()
                    if (!staging.renameTo(target)) throw IOException("Could not install audiobook download")
                    val books = if (cache.books.any { it.id == book.id }) cache.books else cache.books + book
                    persist(account, cache.copy(books = books, downloads = cache.downloads + (book.id to book.chapters.map { it.id })))
                }
            } catch (error: IOException) {
                Log.w("Caimack", "Could not download audiobook", error)
                if (currentAccount() == account) current.update { it.copy(failedDownloads = it.failedDownloads + book.id) }
            } finally {
                staging.deleteRecursively()
                lock.withLock {
                    downloadJobs.remove(key)
                    if (currentAccount() == account) current.update { it.copy(downloading = it.downloading - book.id) }
                }
            }
        }
    }

    fun removeDownload(id: String) {
        val account = currentAccount() ?: return
        scope.launch {
            try {
                lock.withLock {
                    if (currentAccount() != account || (account to id) in downloadJobs) return@withLock
                    load(account)
                    bookDirectory(account, id).deleteRecursively()
                    persist(account, cache.copy(downloads = cache.downloads - id))
                }
            } catch (error: IOException) {
                Log.w("Caimack", "Could not remove audiobook download", error)
            }
        }
    }

    private suspend fun refresh(account: AudiobookAccount, full: Boolean, bookId: String? = null) = refreshLock.withLock refresh@ {
        if (currentAccount() != account) return@refresh
        val pending = lock.withLock { load(account); cache }
        try {
            for ((id, progress) in pending.pendingProgress) {
                val winning = absentIfGone { api.progress(account.endpoint(id, "progress"), progress) } ?: continue
                lock.withLock {
                    if (currentAccount() == account && cache.pendingProgress[id] == progress) {
                        persist(account, cache.copy(pendingProgress = cache.pendingProgress - id,
                            books = cache.books.map { if (it.id == id) it.copy(progress = winning) else it }))
                    }
                }
            }
            for ((id, saved) in pending.pendingSaves) {
                absentIfGone {
                    if (saved) api.save(account.endpoint(id, "saved")) else api.unsave(account.endpoint(id, "saved"))
                } ?: continue
                lock.withLock {
                    if (currentAccount() == account && cache.pendingSaves[id] == saved) {
                        persist(account, cache.copy(pendingSaves = cache.pendingSaves - id,
                            books = cache.books.map { if (it.id == id) it.copy(saved = saved) else it }))
                    }
                }
            }
            if (!full) {
                if (bookId != null) {
                    val book = absentIfGone { api.book(account.endpoint(bookId)) }
                    lock.withLock {
                        if (book != null && currentAccount() == account) {
                            persist(account, cache.copy(books = cache.books.map { if (it.id == bookId) book else it }))
                        }
                    }
                }
                return@refresh
            }
            val books = api.catalog(account.endpoint())
            lock.withLock {
                if (currentAccount() != account) return@withLock
                val freshIds = books.mapTo(hashSetOf()) { it.id }
                val retained = cache.books.filter { it.id !in freshIds && it.id in cache.downloads }
                persist(account, cache.copy(books = books + retained))
                current.update { it.copy(ready = true, online = true) }
            }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (currentAccount() == account) current.update { it.copy(ready = true, online = false) }
        }
    }

    private suspend fun <T> absentIfGone(request: suspend () -> T): T? {
        return try { request() } catch (error: HttpException) { if (error.code() == 404) null else throw error }
    }

    private fun load(account: AudiobookAccount?) {
        if (loaded == account) return
        loaded = account
        metadata = account?.let { read<AudiobookCache>(cacheFile(it)) } ?: AudiobookCache()
        status = account?.let { read<AudiobookStatus>(statusFile(it)) }
        cache = status?.let { saved ->
            metadata.copy(
                books = metadata.books.map { it.copy(progress = saved.progress[it.id], saved = it.id in saved.saved) },
                pendingProgress = saved.pendingProgress, pendingSaves = saved.pendingSaves,
            )
        } ?: metadata
        current.value = AudiobookCatalog()
        publish()
    }

    private fun persist(account: AudiobookAccount, updated: AudiobookCache) {
        if (updated == cache) return
        val nextMetadata = AudiobookCache(updated.books.map { it.copy(progress = null, saved = false) }, updated.downloads)
        val nextStatus = AudiobookStatus(
            updated.books.mapNotNull { book -> book.progress?.let { book.id to it } }.toMap(),
            updated.books.filter { it.saved }.mapTo(hashSetOf()) { it.id },
            updated.pendingProgress,
            updated.pendingSaves,
        )
        if (nextStatus != status) {
            statusFile(account).writeText(json.encodeToString(nextStatus))
            status = nextStatus
        }
        if (nextMetadata != metadata) {
            cacheFile(account).writeText(json.encodeToString(nextMetadata))
            metadata = nextMetadata
        }
        cache = updated
        publish()
    }

    private fun publish() {
        val books = cache.books.map { book ->
            val pending = cache.pendingProgress[book.id]
            book.copy(
                progress = pending?.takeIf { it.updatedAtMs >= (book.progress?.updatedAtMs ?: 0) } ?: book.progress,
                saved = cache.pendingSaves[book.id] ?: book.saved,
            )
        }
        val downloaded = books.filter { cache.downloads[it.id] == it.chapters.map(AudiobookChapter::id) }.mapTo(hashSetOf()) { it.id }
        current.update { it.copy(books = books, downloaded = downloaded) }
    }

    private fun fetch(account: AudiobookAccount, path: String, file: File, onBytes: (Int) -> Unit) {
        http.newCall(Request.Builder().url(remote(account, path)).build()).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Audiobook download failed with HTTP ${response.code}")
            response.body.byteStream().use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count == -1) break
                        output.write(buffer, 0, count)
                        onBytes(count)
                    }
                }
            }
        }
    }

    private fun accountDirectory(account: AudiobookAccount) = File(directory, sha256("${account.server}|${account.user}"))
    private fun cacheFile(account: AudiobookAccount) = AtomicFile(File(accountDirectory(account), "catalog.json"))
    private fun statusFile(account: AudiobookAccount) = AtomicFile(File(accountDirectory(account), "listening.json"))
    private fun bookDirectory(account: AudiobookAccount, id: String) = File(accountDirectory(account), sha256(id))
    private fun chapterFile(parent: File, chapter: AudiobookChapter) = File(parent, sha256(chapter.id))

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    private inline fun <reified T> read(file: AtomicFile): T? =
        runCatching { json.decodeFromString<T>(file.readText()) }.getOrNull()

    private companion object {
        const val CATALOG_INTERVAL_MS = 30_000L
    }
}
