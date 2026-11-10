// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.updates

import android.content.Context
import androidx.core.content.edit
import app.caimack.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.json.Json

data class UpdateState(
    val checking: Boolean = false,
    val checked: Boolean = false,
    val failed: Boolean = false,
    val release: AppRelease? = null,
    val dismissedTag: String? = null,
    val enabled: Boolean = true,
    val published: Boolean = false,
) {
    val showBanner: Boolean get() = enabled && release != null && release.tag != dismissedTag
}

internal interface UpdateStorage {
    var latest: AppRelease?
    var lastChecked: Long
    var lastAttempt: Long
    var dismissedTag: String?
}

private class UpdatePreferences(context: Context, repository: String) : UpdateStorage {
    private val prefs = context.getSharedPreferences("app_updates", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    init {
        if (prefs.getString("repository", null) != repository) prefs.edit { clear(); putString("repository", repository) }
    }
    override var latest: AppRelease?
        get() = prefs.getString("release", null)?.let { runCatching { json.decodeFromString<AppRelease>(it) }.getOrNull() }
            ?.takeIf { trustedRelease(it, prefs.getString("repository", "").orEmpty()) }
        set(value) { prefs.edit { putString("release", value?.let { json.encodeToString(it) }) } }
    override var lastChecked: Long
        get() = prefs.getLong("checked", 0)
        set(value) { prefs.edit { putLong("checked", value) } }
    override var lastAttempt: Long
        get() = prefs.getLong("attempt", 0)
        set(value) { prefs.edit { putLong("attempt", value) } }
    override var dismissedTag: String?
        get() = prefs.getString("dismissed", null)
        set(value) { prefs.edit { putString("dismissed", value) } }
}

class AppUpdates internal constructor(
    private val storage: UpdateStorage,
    private val source: ReleaseSource,
    private val scope: CoroutineScope,
    private val currentVersion: String,
    private val enabled: Boolean = true,
    private val now: () -> Long = System::currentTimeMillis,
) {
    constructor(context: Context, scope: CoroutineScope) : this(
        UpdatePreferences(context, BuildConfig.UPDATE_REPOSITORY),
        GitHubReleases(BuildConfig.UPDATE_REPOSITORY), scope, BuildConfig.VERSION_NAME,
        enabled = BuildConfig.UPDATE_REPOSITORY.isNotBlank(),
    )

    private fun newer(release: AppRelease?): AppRelease? = release?.takeIf {
        val installed = releaseVersion(currentVersion)
        val available = releaseVersion(it.tag)
        installed != null && available != null && available > installed
    }

    private val mutableState = MutableStateFlow(UpdateState(
        checked = storage.lastChecked > 0,
        release = newer(storage.latest),
        dismissedTag = storage.dismissedTag,
        enabled = enabled,
        published = storage.latest != null,
    ))
    val state = mutableState.asStateFlow()
    private val mutex = Mutex()

    fun check(force: Boolean = false): Job = scope.launch {
        if (!enabled || !mutex.tryLock()) return@launch
        try {
            val time = now()
            fun recent(then: Long, interval: Long) = then > 0 && time >= then && time - then < interval
            if (!force && (recent(storage.lastChecked, CHECK_INTERVAL_MS) || recent(storage.lastAttempt, RETRY_INTERVAL_MS))) return@launch
            storage.lastAttempt = time
            mutableState.update { it.copy(checking = true, failed = false) }
            try {
                val latest = source.latest()
                storage.latest = latest
                storage.lastChecked = now()
                mutableState.update { it.copy(checking = false, checked = true, failed = false, release = newer(latest), published = latest != null) }
            } catch (cancelled: CancellationException) {
                mutableState.update { it.copy(checking = false) }
                throw cancelled
            } catch (_: Exception) {
                // Keep a previously discovered update available while offline or rate-limited.
                mutableState.update { it.copy(checking = false, failed = true) }
            }
        } finally {
            mutex.unlock()
        }
    }

    fun dismiss() {
        val tag = mutableState.value.release?.tag ?: return
        storage.dismissedTag = tag
        mutableState.update { it.copy(dismissedTag = tag) }
    }

    internal companion object {
        const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L
        const val RETRY_INTERVAL_MS = 15 * 60 * 1000L
    }
}
