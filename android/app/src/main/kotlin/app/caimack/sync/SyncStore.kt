// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import app.caimack.api.User
import app.caimack.session.Server
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable
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
)

@Serializable
data class FileIndex(
    val files: Map<String, SyncedFile> = emptyMap(),
    val assets: Map<String, String> = emptyMap(),
    val vectorVersion: String = "",
    val exports: Map<String, String> = emptyMap(),
    val garbage: List<String> = emptyList(),
)

data class SyncStatus(
    val enabled: Boolean = false,
    val folder: String? = null,
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

/**
 * Private index plus a durable account-scoped action log. Public music is kept in the user's SAF
 * folder; no cache eviction policy can remove it.
 */
class SyncStore(private val context: Context, val json: Json, private val server: Server) {
    private val prefs = context.getSharedPreferences("library-sync", Context.MODE_PRIVATE)
    val directory = File(context.filesDir, "library-sync").apply { mkdirs() }
    private val snapshotFile = AtomicFile(File(directory, "snapshot.json"))
    private val indexFile = AtomicFile(File(directory, "files.json"))
    private val actionsFile = AtomicFile(File(directory, "actions.json"))
    private val confirmedFile = AtomicFile(File(directory, "confirmed.json"))
    private val rejectedFile = AtomicFile(File(directory, "rejected.json"))
    @Volatile
    var snapshot: JsonObject? = read(snapshotFile)?.let { json.parseToJsonElement(it).jsonObject }
        private set

    @Volatile
    var index: FileIndex =
        read(indexFile)?.let { json.decodeFromString<FileIndex>(it) } ?: FileIndex()
        private set

    private var actions: List<SyncAction> =
        read(actionsFile)?.let { json.decodeFromString<List<SyncAction>>(it) } ?: emptyList()
    private var confirmed: List<SyncAction> =
        read(confirmedFile)?.let { json.decodeFromString<List<SyncAction>>(it) } ?: emptyList()
    private var rejected: List<JsonObject> =
        read(rejectedFile)?.let { json.decodeFromString<List<JsonObject>>(it) } ?: emptyList()
    @Volatile private var signedIn: String? = null
    val status =
        MutableStateFlow(
            SyncStatus(
                enabled = enabled,
                folder = folder,
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

    val folder
        get() = prefs.getString("folder", null)

    val boundAddress
        get() = prefs.getString("address", null)

    val boundUser
        get() = prefs.getString("user", null)

    val active
        get() =
            enabled &&
                signedIn != null &&
                signedIn == boundUser &&
                server.url.value?.toString() == boundAddress

    var offlineQueue: Boolean
        get() = prefs.getBoolean("offlineQueue", false)
        set(value) {
            prefs.edit().putBoolean("offlineQueue", value).apply()
        }

    fun session(user: User?) {
        signedIn = user?.id
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
    }

    fun login(user: User) {
        signedIn = user.id
        prefs.edit().putBoolean("signedOut", false).commit()
    }

    @Synchronized
    fun configure(uri: Uri, user: User) {
        val address = server.url.value?.toString() ?: throw IOException("No server address")
        // A different account/folder starts a new manifest, never claims the old
        // account's files. Keep its private log so pending actions are not lost.
        if (boundUser != user.id || boundAddress != address || folder != uri.toString()) {
            if (actions.isNotEmpty())
                throw IOException(
                    context.getString(app.caimack.R.string.sync_pending_before_change)
                )
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
            snapshot = null
            index = FileIndex()
            actions = emptyList()
            confirmed = emptyList()
            rejected = emptyList()
        }
        prefs
            .edit()
            .putString("folder", uri.toString())
            .putString("address", address)
            .putString("user", user.id)
            .putBoolean("signedOut", false)
            .commit()
        signedIn = user.id
        status.value =
            status.value.copy(
                folder = folder,
                completed = index.files.size,
                total = snapshot?.objects("tracks")?.size ?: 0,
            )
    }

    fun enable(value: Boolean) {
        if (
            value &&
                (folder == null ||
                    signedIn != boundUser ||
                    server.url.value?.toString() != boundAddress)
        )
            throw IOException(context.getString(app.caimack.R.string.sync_choose_folder))
        prefs.edit().putBoolean("enabled", value).commit()
        status.value = status.value.copy(enabled = value, message = null)
    }

    @Synchronized
    fun enqueue(action: SyncAction): Boolean {
        if (!active || snapshot == null) return false
        val updated = actions + action
        write(
            actionsFile,
            json.encodeToString(updated),
        ) // persist before acknowledging optimistic UI
        actions = updated
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
        write(rejectedFile, json.encodeToString(rejected))
        confirmed =
            (confirmed +
                    actions.filter { action ->
                        results.any {
                            it.string("id") == action.id && it.string("status") == "applied"
                        }
                    })
                .distinctBy { it.id }
        write(confirmedFile, json.encodeToString(confirmed))
        val updated = actions.filter { it.id !in accepted }
        write(actionsFile, json.encodeToString(updated))
        actions = updated
        status.value = status.value.copy(pending = actions.size, rejected = rejected.size)
    }

    @Synchronized
    fun accept(value: JsonObject) {
        require(value["protocol"]?.jsonPrimitive?.int == 1) { "Unsupported sync protocol" }
        require(value["user"]?.jsonObject?.string("id") == boundUser) { "Different sync account" }
        val prior = snapshot?.string("serverId")
        require(prior.isNullOrEmpty() || prior == value.string("serverId")) {
            "Different sync server; choose a new folder"
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
        write(snapshotFile, value.toString())
        snapshot = value
        confirmedFile.delete()
        confirmed = emptyList()
        status.value = status.value.copy(total = tracks.size)
    }

    @Synchronized
    fun updateIndex(transform: (FileIndex) -> FileIndex) {
        val next = transform(index)
        write(indexFile, json.encodeToString(next))
        index = next
        status.value = status.value.copy(completed = index.files.size)
    }

    fun finish() {
        val now = System.currentTimeMillis()
        prefs.edit().putLong("lastSync", now).commit()
        status.value = status.value.copy(lastSync = now, message = null)
    }

    fun audio(id: String): Uri? = if (active) index.files[id]?.uri?.let(Uri::parse) else null

    fun tracks(): List<app.caimack.api.Track> =
        if (!active) emptyList()
        else
            snapshot
                ?.let {
                    json
                        .decodeFromJsonElement<List<app.caimack.api.Track>>(
                            OfflineCatalog.view(it, edits()).getValue("tracks")
                        )
                        .filter { track -> track.id in index.files }
                }
                .orEmpty()

    fun asset(path: String): String? {
        if (!active) return null
        val resolved =
            if (path.startsWith("api/tracks/")) {
                val track =
                    snapshot?.objects("tracks")?.find {
                        it.string("id") == path.split('/').getOrNull(2)
                    }
                "api/albums/${track?.string("albumId")}/cover"
            } else path
        val version = index.assets[resolved] ?: return null
        return File(directory, "asset-${sha256(resolved.toByteArray())}-$version")
            .takeIf { it.isFile }
            ?.toURI()
            ?.toString()
    }

    private fun read(file: AtomicFile): String? =
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) null
        else file.openRead().bufferedReader().use { it.readText() }

    private fun write(file: AtomicFile, value: String) {
        val stream = file.startWrite()
        try {
            stream.write(value.toByteArray())
            file.finishWrite(stream)
        } catch (error: Throwable) {
            file.failWrite(stream)
            throw error
        }
    }
}
