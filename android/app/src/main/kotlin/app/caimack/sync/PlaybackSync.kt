// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.sync

import app.caimack.api.CaimackApi
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okio.Buffer
import retrofit2.HttpException

/** Activity from individual downloads uses the sync protocol without a library snapshot. */
internal class PlaybackSync(
    private val directory: File,
    private val json: Json,
    private val api: CaimackApi,
    private val owner: () -> Owner?,
) {
    data class Owner(val address: HttpUrl, val userId: String) {
        val key get() = "$address|$userId"
        fun url(path: String): HttpUrl = address.newBuilder().addPathSegments(path).build()
    }

    @Serializable
    private data class Journal(
        val serverId: String? = null,
        val pending: List<SyncAction> = emptyList(),
        val acknowledged: List<SyncAction> = emptyList(),
        val rejected: List<JsonObject> = emptyList(),
    )

    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val sending = Mutex()
    private var loadedFor: String? = null
    private var journal = Journal()
    private var favorites = emptyMap<String, Boolean>()

    private fun install(key: String, value: Journal): Journal {
        loadedFor = key
        journal = value
        favorites = (value.acknowledged.asSequence() + value.pending.asSequence())
            .filter { it.kind == "favorite" }
            .associate { it.entityId.orEmpty() to it.payload.getValue("value").jsonPrimitive.boolean }
        return value
    }

    private fun file(key: String) = File(directory, sha256(key.encodeToByteArray()) + ".json")

    private fun read(key: String): Journal {
        if (key != loadedFor) {
            val path = file(key)
            install(key, if (path.isFile) json.decodeFromString<Journal>(path.readText()) else Journal())
        }
        return journal
    }

    private fun save(key: String, value: Journal) {
        val target = file(key)
        directory.mkdirs()
        val temporary = File.createTempFile("activity-", ".part", directory)
        try {
            temporary.outputStream().use { it.write(json.encodeToString(value).encodeToByteArray()); it.fd.sync() }
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally {
            temporary.delete()
        }
        install(key, value)
    }

    @Synchronized
    fun enqueue(account: Owner, action: SyncAction): Boolean {
        if (account != owner()) return false
        val current = read(account.key)
        save(account.key, current.copy(pending = current.pending + action))
        request()
        return true
    }

    @Synchronized
    fun edits(key: String): List<SyncAction> {
        val current = read(key)
        return (current.acknowledged + current.pending).filter { it.kind in visibleKinds }
    }

    @Synchronized
    fun confirmed(key: String): List<SyncAction> = read(key).acknowledged

    @Synchronized
    fun favorite(key: String, trackId: String): Boolean? {
        read(key)
        return favorites[trackId]
    }

    @Synchronized
    fun observed(key: String, ids: Set<String>) {
        val current = read(key)
        val remaining = current.acknowledged.filterNot { it.id in ids }
        if (remaining != current.acknowledged) save(key, current.copy(acknowledged = remaining))
    }

    fun request() { wake.trySend(Unit) }

    fun start(scope: CoroutineScope) = scope.launch {
        for (event in wake) {
            var waitMs = 2_000L
            while (!flush()) {
                withTimeoutOrNull(waitMs) { wake.receive() }
                waitMs = (waitMs * 2).coerceAtMost(60_000L)
            }
        }
    }

    suspend fun flush(): Boolean = sending.withLock {
        val account = owner() ?: return@withLock true
        try {
            val current = synchronized(this) { read(account.key) }
            val serverId = current.serverId ?: run {
                val identity = api.syncIdentity(account.url("api/sync/identity"))
                if (identity.string("userId") != account.userId || owner() != account) return@withLock true
                val id = identity.string("serverId").ifBlank { throw IOException("Missing sync server identity") }
                synchronized(this) { save(account.key, read(account.key).copy(serverId = id)) }
                id
            }
            while (owner() == account) {
                val batch = synchronized(this) { read(account.key).pending.take(100) }
                if (batch.isEmpty()) return@withLock true
                val payload = buildJsonObject {
                    put("serverId", serverId)
                    put("userId", account.userId)
                    put("actions", json.encodeToJsonElement(batch))
                }
                val result = api.syncActions(account.url("api/sync/actions"), payload).objects("results")
                acknowledge(account.key, batch, result)
            }
            true
        } catch (_: IOException) {
            !hasPending(account)
        } catch (error: HttpException) {
            // A different database or obsolete API cannot confirm these actions.
            error.code() in listOf(401, 403, 404, 409) || !hasPending(account)
        } catch (_: SerializationException) {
            true
        }
    }

    @Synchronized
    private fun hasPending(account: Owner): Boolean = account == owner() && read(account.key).pending.isNotEmpty()

    @Synchronized
    private fun acknowledge(key: String, batch: List<SyncAction>, results: List<JsonObject>) {
        val ids = batch.mapTo(hashSetOf()) { it.id }
        val replies = results.associateBy { it.string("id") }
        if (results.size != ids.size || replies.keys != ids ||
            replies.values.any { it.string("status") !in setOf("applied", "rejected") }
        ) throw IOException("Incomplete sync acknowledgement")
        val current = read(key)
        val acknowledged = batch.filter { it.kind in visibleKinds && replies.getValue(it.id).string("status") == "applied" }
        val rejected = batch.mapNotNull { action ->
            replies.getValue(action.id).takeIf { it.string("status") == "rejected" }
                ?.with("action" to json.encodeToJsonElement(action))
        }
        save(key, current.copy(
            pending = current.pending.filterNot { it.id in ids },
            acknowledged = (current.acknowledged + acknowledged).asReversed()
                .distinctBy { it.kind to (it.entityId ?: it.payload.string("trackId")) }.take(200).asReversed(),
            rejected = current.rejected + rejected,
        ))
    }

    val interceptor = Interceptor { chain ->
        val request = chain.request()
        val account = owner() ?: return@Interceptor chain.proceed(request)
        if (!request.url.toString().startsWith(account.address.toString()) || request.header("X-Caimack-Sync") != null)
            return@Interceptor chain.proceed(request)
        val path = request.url.encodedPath.removePrefix(account.address.encodedPath).removePrefix("api/")
        val action = OfflineCatalog.preference(request.method, path) {
            val body = Buffer()
            request.body?.writeTo(body) ?: throw IOException("Missing activity payload")
            json.parseToJsonElement(body.readUtf8()).jsonObject
        } ?: return@Interceptor chain.proceed(request)
        if (!enqueue(account, action)) throw IOException("Account changed while saving activity")
        OfflineCatalog.response(request, OfflineCatalog.preferenceResult(action))
    }

    private companion object {
        val visibleKinds = setOf("favorite", "history")
    }
}
