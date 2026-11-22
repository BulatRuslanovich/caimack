// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.sync

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import app.caimack.R
import app.caimack.api.Lyrics
import app.caimack.api.Track
import app.caimack.api.User
import app.caimack.session.Server
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.Serializable
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.*

internal fun JsonObject.string(key: String): String =
    (get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

internal fun JsonObject.objects(key: String): List<JsonObject> =
    (get(key) as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

internal fun JsonObject.with(vararg values: Pair<String, JsonElement>): JsonObject =
    JsonObject(this + values)

internal fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

@Serializable
data class SyncAction(
    val id: String = UUID.randomUUID().toString(),
    val kind: String,
    val entityId: String? = null,
    val occurredAt: String = Instant.now().toString(),
    val payload: JsonObject,
)

@Serializable
data class SyncedFile(
    val uri: String,
    val relativePath: String,
    val audioVersion: String,
    val fileHash: String,
    val prefixBytes: Long,
    val suffixBytes: Long,
    val payloadSize: Long,
    val metadataKey: String = "",
    val companions: List<String> = emptyList(),
) {
    val sizeBytes: Long get() = prefixBytes + payloadSize + suffixBytes
}

@Serializable
data class FileIndex(
    val files: Map<String, SyncedFile> = emptyMap(),
    val assets: Map<String, String> = emptyMap(),
    val vectorVersion: String = "",
)

data class SyncStatus(
    val enabled: Boolean = false,
    val running: Boolean = false,
    val completed: Int = 0,
    val total: Int = 0,
    val bytes: Long = 0,
    val totalBytes: Long = 0,
    val pending: Int = 0,
    val rejected: Int = 0,
    val message: String? = null,
    val lastSync: Long = 0,
)

/** Private metadata and action log. The old document index is used during migration. */
@OptIn(ExperimentalSerializationApi::class)
class SyncStore(private val context: Context, val json: Json, private val server: Server) {
    val catalogRevision = MutableStateFlow(0L)
    val artworkRevision = MutableStateFlow(0L)
    private var tracksRevision = -1L
    private var cachedAvailability = emptySet<String>()
    private var cachedTracks = emptyList<Track>()
    private var sourceRevision = 0L
    private var viewRevision = -1L
    private var projectedCatalog: JsonObject? = null
    private var decodedRevision = -1L
    private var decodedTracks = emptyList<Track>()
    private fun catalogChanged(metadata: Boolean = false) {
        if (metadata) sourceRevision++
        catalogRevision.update { it + 1 }
    }
    private val prefs = context.getSharedPreferences("library-sync", Context.MODE_PRIVATE)
    val directory = File(context.filesDir, "library-sync").apply { mkdirs() }
    private val snapshotFile = AtomicFile(File(directory, "snapshot.json"))
    private val indexFile = AtomicFile(File(directory, "files.json"))
    internal val vectorFile = AtomicFile(File(directory, "vectors.json"))
    private val actionsFile = AtomicFile(File(directory, "actions.json"))
    private val confirmedFile = AtomicFile(File(directory, "confirmed.json"))
    private val rejectedFile = AtomicFile(File(directory, "rejected.json"))
    @Volatile
    var snapshot: JsonObject? =
        if (snapshotFile.baseFile.exists() || File(snapshotFile.baseFile.path + ".bak").exists())
            snapshotFile.openRead().use { SnapshotJson(json).read(it) }
        else null
        private set

    @Volatile
    var index: FileIndex =
        read(indexFile) ?: FileIndex()
        private set

    private var actions: List<SyncAction> =
        read(actionsFile) ?: emptyList()
    private var confirmed: List<SyncAction> =
        read(confirmedFile) ?: emptyList()
    private var rejected: List<JsonObject> =
        read(rejectedFile) ?: emptyList()
    @Volatile private var signedIn: String? = null
    @Volatile private var ownerKey: String? = boundAddress?.let { address ->
        boundUser?.let { owner(address, it) }
    }
    val status =
        MutableStateFlow(
            SyncStatus(
                enabled = enabled,
                pending = actions.size,
                rejected = rejected.size,
                completed = index.files.size,
                total = snapshot?.objects("tracks")?.size ?: 0,
                lastSync = prefs.getLong("lastSync", 0),
            )
        )
    val enabled
        get() = prefs.getBoolean("enabled", false)

    var paused: Boolean
        get() = prefs.getBoolean("paused", false)
        set(value) {
            prefs.edit().putBoolean("paused", value).commit()
        }

    val boundAddress
        get() = prefs.getString("address", null)

    val boundUser
        get() = prefs.getString("user", null)

    internal val downloadOwner: String?
        get() = ownerKey.takeIf {
            signedIn != null && signedIn == boundUser && server.url.value?.toString() == boundAddress &&
                !prefs.getBoolean("signedOut", false)
        }

    val active: Boolean get() = enabled && downloadOwner != null

    var offlineQueue: Boolean
        get() = prefs.getBoolean("offlineQueue", false)
        set(value) {
            prefs.edit().putBoolean("offlineQueue", value).apply()
        }

    fun session(user: User?) {
        if (signedIn == user?.id) return
        signedIn = user?.id
        catalogChanged()
    }

    fun offlineUser(): User? {
        if (
            !enabled ||
                server.url.value?.toString() != boundAddress ||
                prefs.getBoolean("signedOut", false)
        )
            return null
        return snapshot?.get("user")?.let { json.decodeFromJsonElement<User>(it) }
    }

    fun logout() {
        signedIn = null
        prefs.edit().putBoolean("signedOut", true).commit()
        catalogChanged()
    }

    fun login(user: User) {
        signedIn = user.id
        prefs.edit().putBoolean("signedOut", false).commit()
        catalogChanged()
    }

    @Synchronized
    fun configure(user: User) {
        val address = server.url.value?.toString() ?: throw IOException("No server address")
        if (boundUser != user.id || boundAddress != address) {
            check(!status.value.running) { context.getString(R.string.sync_change_while_running) }
            if (actions.isNotEmpty())
                throw IOException(context.getString(R.string.sync_pending_before_change))
            val archive =
                File(directory, "archive-${System.currentTimeMillis()}").apply { mkdirs() }
            listOf(
                    snapshotFile,
                    indexFile,
                    actionsFile,
                    confirmedFile,
                    rejectedFile,
                    AtomicFile(File(directory, "transfer.json")),
                    AtomicFile(File(directory, "creating.json")),
                )
                .forEach { file ->
                    if (file.baseFile.exists())
                        file.baseFile.copyTo(File(archive, file.baseFile.name))
                    file.delete()
                }
            vectorFile.delete()
            snapshot = null
            index = FileIndex()
            actions = emptyList()
            confirmed = emptyList()
            rejected = emptyList()
        }
        prefs
            .edit()
            .remove("folder")
            .putString("address", address)
            .putString("user", user.id)
            .putBoolean("signedOut", false)
            .commit()
        ownerKey = owner(address, user.id)
        signedIn = user.id
        catalogChanged(metadata = true)
        status.value =
            status.value.copy(
                completed = index.files.size,
                total = snapshot?.objects("tracks")?.size ?: 0,
            )
    }

    fun enable(value: Boolean) {
        if (value && downloadOwner == null)
            throw IOException(context.getString(R.string.sync_sign_in_again))
        prefs.edit().putBoolean("enabled", value).commit()
        catalogChanged()
        status.value = status.value.copy(enabled = value, message = null)
    }

    @Synchronized
    fun enqueue(action: SyncAction): Boolean {
        if (!active || snapshot == null) return false
        val updated = actions + action
        write(
            actionsFile,
            updated,
        ) // persist before acknowledging optimistic UI
        actions = updated
        catalogChanged(metadata = true)
        status.value = status.value.copy(pending = actions.size)
        return true
    }

    @Synchronized fun pending(): List<SyncAction> = actions.toList()

    @Synchronized fun edits(): List<SyncAction> = (confirmed + actions).distinctBy { it.id }

    @Synchronized
    fun rejectionMessages(): String =
        rejected.takeLast(5).joinToString("\n") { it.string("message") }

    @Synchronized
    fun acknowledge(results: List<JsonObject>) {
        val accepted = results.map { it.string("id") }.toSet()
        val failures =
            results
                .filter { it.string("status") == "rejected" }
                .map { result ->
                    result.with(
                        "action" to
                            (actions
                                .find { it.id == result.string("id") }
                                ?.let { json.encodeToJsonElement(it) } ?: JsonNull)
                    )
                }
        // Write failures first. Replaying after a crash is harmless and retains
        // the reason for a rejected edit instead of silently dropping it.
        rejected = (rejected + failures).distinctBy { it.string("id") }
        write(rejectedFile, rejected)
        confirmed =
            (confirmed +
                    actions.filter { action ->
                        results.any {
                            it.string("id") == action.id && it.string("status") == "applied"
                        }
                    })
                .distinctBy { it.id }
        write(confirmedFile, confirmed)
        val updated = actions.filter { it.id !in accepted }
        write(actionsFile, updated)
        actions = updated
        catalogChanged(metadata = true)
        status.value = status.value.copy(pending = actions.size, rejected = rejected.size)
    }

    @Synchronized
    fun accept(value: JsonObject) {
        require(value["protocol"]?.jsonPrimitive?.int == 1) { "Unsupported sync protocol" }
        require(value["user"]?.jsonObject?.string("id") == boundUser) { "Different sync account" }
        val prior = snapshot?.string("serverId")
        require(prior.isNullOrEmpty() || prior == value.string("serverId")) {
            "Different sync server"
        }
        require(
            value.string("serverId").isNotEmpty() &&
                value["tracks"] is JsonArray &&
                value["files"] is JsonArray
        ) {
            "Incomplete library manifest"
        }
        val tracks = value.objects("tracks").map { it.string("id") }.toSet()
        val files = value.objects("files").map { it.string("id") }.toSet()
        require(
            tracks == files &&
                "" !in tracks &&
                tracks.size == value.getValue("tracks").jsonArray.size &&
                files.size == value.getValue("files").jsonArray.size
        ) {
            "Incomplete library manifest"
        }
        write(snapshotFile, value)
        snapshot = value
        confirmedFile.delete()
        confirmed = emptyList()
        catalogChanged(metadata = true)
        status.value = status.value.copy(total = tracks.size)
    }

    @Synchronized
    fun updateIndex(transform: (FileIndex) -> FileIndex) {
        val before = index
        val next = transform(before)
        if (next == before) return
        write(indexFile, next)
        index = next
        if (next.files != before.files) catalogChanged()
    }

    fun finish() {
        val now = System.currentTimeMillis()
        prefs.edit().putLong("lastSync", now).commit()
        status.value = status.value.copy(lastSync = now, message = null)
    }

    fun reportAvailable(count: Int) {
        if (active) status.update { if (it.running) it else it.copy(completed = count) }
    }

    fun audio(id: String): Uri? = if (active) index.files[id]?.uri?.let(Uri::parse) else null

    @Synchronized
    internal fun catalogView(): JsonObject? {
        if (!active) return null
        if (viewRevision != sourceRevision) {
            projectedCatalog = snapshot?.let { OfflineCatalog.view(it, edits()) }
            viewRevision = sourceRevision
        }
        return projectedCatalog
    }

    /** The legacy index keeps previously exported audio playable while local downloads are prepared. */
    @Synchronized fun audioBytes(): Long = if (active) index.files.values.sumOf { it.sizeBytes } else 0L

    @Synchronized fun tracks(available: Set<String> = emptySet()): List<Track> {
        if (!active) return emptyList()
        val revision = catalogRevision.value
        if (tracksRevision != revision || cachedAvailability != available) {
            if (decodedRevision != sourceRevision) {
                decodedTracks = catalogView()?.get("tracks")?.let { json.decodeFromJsonElement<List<Track>>(it) }.orEmpty()
                decodedRevision = sourceRevision
            }
            cachedTracks = decodedTracks.filter { track -> track.id in index.files || track.id in available }
            cachedAvailability = available
            tracksRevision = revision
        }
        return cachedTracks
    }

    fun lyrics(id: String): Lyrics? = if (downloadOwner != null) {
        (snapshot?.get("lyrics") as? JsonObject)?.get(id)?.let { json.decodeFromJsonElement<Lyrics>(it) }
    } else null

    internal fun assetFile(path: String, version: String) = File(directory, "asset-${sha256(path.toByteArray())}-$version")

    fun asset(path: String): String? {
        if (downloadOwner == null) return null
        val resolved =
            if (path.startsWith("api/tracks/")) {
                val track =
                    snapshot?.objects("tracks")?.find {
                        it.string("id") == path.split('/').getOrNull(2)
                    }
                "api/albums/${track?.string("albumId")}/cover"
            } else path
        val version = index.assets[resolved] ?: return null
        return assetFile(resolved, version)
            .takeIf { it.isFile }
            ?.toURI()
            ?.toString()
    }

    private fun owner(address: String, user: String) = sha256("$address\n$user".toByteArray())

    private inline fun <reified T> read(file: AtomicFile): T? =
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) null
        else file.openRead().use { json.decodeFromStream<T>(it) }

    private inline fun <reified T> write(file: AtomicFile, value: T) {
        val stream = file.startWrite()
        try {
            json.encodeToStream(value, stream)
            file.finishWrite(stream)
        } catch (error: Throwable) {
            file.failWrite(stream)
            throw error
        }
    }
}
