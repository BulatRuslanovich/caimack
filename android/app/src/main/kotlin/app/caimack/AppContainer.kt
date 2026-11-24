// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack

import androidx.core.content.edit
import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.AtomicFile
import java.io.File
import java.time.Instant
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import app.caimack.api.CaimackApi
import app.caimack.api.Media
import app.caimack.api.PlaybackSignal
import app.caimack.api.RadioRequest
import app.caimack.api.RadioBatch
import app.caimack.api.Track
import app.caimack.api.UserSettings
import app.caimack.audiobooks.AudiobookAccount
import app.caimack.audiobooks.AudiobookApi
import app.caimack.audiobooks.AudiobookPlayback
import app.caimack.audiobooks.AudiobookStore
import app.caimack.playback.Downloads
import app.caimack.playback.EqualizerSettings
import app.caimack.playback.Favorites
import app.caimack.playback.PlaybackPrefs
import app.caimack.playback.PlayerConnection
import app.caimack.playback.ConnectPlayback
import app.caimack.playback.RadioSession
import app.caimack.playback.Signals
import app.caimack.playback.SleepTimer
import app.caimack.session.PersistentCookieJar
import app.caimack.ui.Appearance
import app.caimack.ui.RecentSearches
import app.caimack.session.Server
import app.caimack.session.Session
import app.caimack.session.SessionAuthenticator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import app.caimack.sync.SyncStore
import app.caimack.sync.SyncAction
import app.caimack.sync.OfflineCatalog
import app.caimack.sync.LibrarySync
import app.caimack.sync.PlaybackSync
import app.caimack.sync.SyncScheduler
import app.caimack.session.SessionState
import java.io.IOException
import okhttp3.Dispatcher
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class AppContainer(context: Context) {
    val recommendationsEnabled = MutableStateFlow(false)
    private val audiobookExperimentPreferences = context.getSharedPreferences("server_experiments", Context.MODE_PRIVATE)
    private val audiobookExperiment = MutableStateFlow(false)
    private val audiobookExperimentRefresh = kotlinx.coroutines.channels.Channel<Unit>(kotlinx.coroutines.channels.Channel.CONFLATED)
    private var audiobookExperimentStreamOwner: AudiobookAccount? = null
    val audiobooksEnabled = audiobookExperiment.asStateFlow()
    private var capabilitiesFor: String? = null
    suspend fun refreshCapabilities() {
        val address = server.url.value?.toString()
        if (address != capabilitiesFor) recommendationsEnabled.value = false
        val capabilities = api.capabilities()
        if (server.url.value?.toString() == address) {
            recommendationsEnabled.value = capabilities.recommendationsEnabled
            capabilitiesFor = address
        }
    }

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val updates = app.caimack.updates.AppUpdates(context.applicationContext, scope)

    val preferences: DataStore<Preferences> =
        PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("caimack") }

    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    val server = Server(preferences) { appearance.language.ifEmpty { Locale.getDefault().toLanguageTag() } }

    val syncStore = SyncStore(context.applicationContext,json,server)
    private val offlineCatalog = OfflineCatalog(syncStore) { SyncScheduler.schedule(context,soon=true) }
    val sync by lazy { LibrarySync(context.applicationContext, syncStore, server, { downloads }) { http } }

    private val cookies = PersistentCookieJar(preferences, scope)
    val connectionPreferences = app.caimack.session.ConnectionPreferences(context.applicationContext)
    private val localHttp = app.caimack.session.LocalHttpPolicy(
        { connectionPreferences.allowLocalHttp.value }, { server.url.value },
    )
    @Volatile private var loggingOut = false
    private fun playbackOwner(): PlaybackSync.Owner? {
        if (loggingOut) return null
        val user = (session.state.value as? SessionState.SignedIn)?.user ?: return null
        return server.url.value?.let { PlaybackSync.Owner(it, user.id) }
    }
    private val playbackSync by lazy {
        PlaybackSync(File(context.filesDir, "playback-sync"), json, api, ::playbackOwner)
    }

    private data class LocalCatalogVersion(
        val downloads: Map<String, app.caimack.playback.Offline>,
        val library: Long,
        val sync: Long,
        val catalog: Long,
        val artwork: Long,
    )

    val libraryCache by lazy { app.caimack.playback.LibraryCache(File(context.filesDir, "library-cache"),
        { (session.state.value as? SessionState.SignedIn)?.let { "${server.url.value}|${it.user.id}" } },
        { downloadedCatalog.localSnapshot() }, json, edits = playbackSync::edits,
        confirmed = playbackSync::confirmed, observed = playbackSync::observed,
        localVersion = {
            LocalCatalogVersion(downloads.state.value, downloads.library.revision.value, syncStore.catalogRevision.value,
                downloadedCatalog.catalogRevision.value, downloadedCatalog.revision.value)
        }, probeConnection = ::probeLibraryConnection) }

    val http: OkHttpClient = OkHttpClient.Builder()
        .followSslRedirects(false)
        .cookieJar(cookies)
        .addInterceptor(server.interceptor)
        .addInterceptor(offlineCatalog.interceptor)
        .addInterceptor { playbackSync.interceptor.intercept(it) }
        .addInterceptor { libraryCache.interceptor.intercept(it) }
        .addInterceptor(localHttp.interceptor)
        .addNetworkInterceptor(localHttp.networkInterceptor)
        .authenticator(SessionAuthenticator(server, { http }) { session.expire() })
        .build()

    private val offlineReadsHttp = http.newBuilder().dispatcher(Dispatcher()).build()

    private val retrofit = Retrofit.Builder()
        .baseUrl(Server.PLACEHOLDER)
        .callFactory { request ->
            val client = if (libraryCache.isOfflineRead(request)) offlineReadsHttp else http
            client.newCall(request)
        }
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    val api: CaimackApi = retrofit.create(CaimackApi::class.java)

    val session = Session(api, server, cookies, json, { deviceName }, syncStore::offlineUser,
        onLogin = { user -> syncStore.login(user); loggingOut = false },
        onLogout = { loggingOut = true; syncStore.logout() })

    val media = Media(server,
        local = { path -> syncStore.asset(path) ?: downloadedCatalog.asset(path) },
        changed = { path ->
            downloadedCatalog.invalidateArtwork(path)
            scope.launch { downloadedCatalog.cacheArtwork(listOf(path), http) }
        })

    val settings = MutableStateFlow(UserSettings())
    val playbackDelivery = MutableStateFlow<app.caimack.playback.PlaybackDelivery?>(null)

    val appearance = Appearance(context)
    val haptics = app.caimack.haptics.HapticsPreferences(context)

    val equalizer = EqualizerSettings(context)

    val playbackPrefs = PlaybackPrefs(context)

    val sleepTimer = SleepTimer()

    val openRecap = MutableStateFlow(false)

    val radio = RadioSession(context)

    val recentSearches = RecentSearches(context)

    val tracks: MutableMap<String, Track> = ConcurrentHashMap()

    val deviceId: String = context.getSharedPreferences("device", Context.MODE_PRIVATE).let { stored ->
        stored.getString("id", null) ?: UUID.randomUUID().toString().also { stored.edit().putString("id", it).apply() }
    }

    val deviceName: String =
        Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL

    val listeningSession: String = UUID.randomUUID().toString()

    val signals = Signals(api, scope, listeningSession) { kind,payload,occurredAt ->
        val action = SyncAction(kind = kind, occurredAt = occurredAt, payload = payload)
        try {
            if (syncStore.enqueue(action)) {
                SyncScheduler.schedule(context, soon = true)
                true
            } else playbackOwner()?.let { playbackSync.enqueue(it, action) } ?: false
        } catch (error: IOException) {
            android.util.Log.w("Caimack", "Could not save playback activity", error)
            false
        }
    }

    val favorites = Favorites(api, scope, signals, identity = { accountKey }, savedPreference = playbackSync::favorite)

    val downloads by lazy {
        Downloads(context.applicationContext, http, server, json, { syncStore.downloadOwner }) { !syncStore.active }
    }

    fun synchronizedTracks(): List<Track> = syncStore.tracks(
        downloads.libraryEntries().filter { it.done }.mapNotNullTo(hashSetOf()) { it.track?.id }
    )

    fun cachedArtwork(url: String): String? {
        val address = server.url.value?.toString() ?: return null
        if (!url.startsWith(address)) return null
        return syncStore.asset(url.removePrefix(address).substringBefore('?')) ?: downloadedCatalog.cachedUrl(url)
    }

    val downloadedCatalog by lazy { app.caimack.playback.DownloadedCatalog(File(context.filesDir, "downloaded-catalog"), json,
        { server.url.value?.toString() },
        { synchronizedTracks() + downloads.tracks() },
        syncStore::catalogView,
        { (session.state.value as? SessionState.SignedIn)?.let { "${server.url.value}|${it.user.id}" } },
        legacyArtworkDirectory = File(context.filesDir, "downloaded-artwork")) }

    val accountKey: String?
        get() = (session.state.value as? SessionState.SignedIn)?.let { "${server.url.value}|${it.user.id}" }

    val downloadedLyrics by lazy { app.caimack.playback.DownloadedLyrics(
        File(context.filesDir, "downloaded-lyrics"), json, { accountKey },
        { downloads.state.value.values.filter { downloads.visible(it) }.mapNotNull { it.track?.id }.toSet() },
        api::lyrics,
    ) }

    suspend fun lyrics(id: String): app.caimack.api.Lyrics {
        val offline = libraryCache.offline.value
        if (syncStore.active || (offline && downloads.completed(id) != null)) {
            withContext(Dispatchers.IO) { syncStore.lyrics(id) }?.let { return it }
        }
        return try {
            downloadedLyrics.load(id, offline = offline)
        } catch (error: IOException) {
            withContext(Dispatchers.IO) {
                syncStore.lyrics(id).takeIf { downloads.completed(id) != null }
            } ?: throw error
        }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val localLibrary by lazy {
        val account = combine(session.state, server.url) { _, _ -> accountKey }.distinctUntilChanged()
        combine(downloads.state, downloads.library.revision, syncStore.catalogRevision, downloadedCatalog.catalogRevision, account) { entries, _, _, _, owner ->
            entries to owner
        }.mapLatest { (entries, owner) ->
            // This flow runs on the container's IO scope, never during composition.
            if (owner == null || owner != accountKey) return@mapLatest app.caimack.playback.LocalLibrary()
            syncStore.session((session.state.value as? SessionState.SignedIn)?.user)
            val privateTracks = downloads.libraryEntries().filter { it.done }.mapNotNull { it.track }
            val synced = syncStore.tracks(privateTracks.mapTo(hashSetOf()) { it.id })
            val songs = entries.values.filter { it.done && downloads.visible(it) }.mapNotNull { it.track }
            val all = (synced + privateTracks + songs).distinctBy { it.id }
            val result = app.caimack.playback.LocalLibrary(owner, all.mapTo(hashSetOf()) { it.id }, synced,
                downloadedCatalog.availableCollections(all), syncStore.audioBytes(), all)
            syncStore.reportAvailable(synced.size)
            if (owner == accountKey) result else app.caimack.playback.LocalLibrary()
        }.stateIn(scope, SharingStarted.Eagerly, app.caimack.playback.LocalLibrary())
    }

    val player = PlayerConnection(context.applicationContext, media, tracks, radio, signals)
    val connect by lazy { ConnectPlayback(context.applicationContext, this) }

    internal fun audiobookAccount(): AudiobookAccount? = playbackOwner()?.let { AudiobookAccount(it.address, it.userId) }
    internal val audiobookAccounts get() = combine(session.state, server.url, audiobooksEnabled) { _, _, enabled ->
        if (enabled) audiobookAccount() else null
    }.distinctUntilChanged()
    internal val audiobookStore by lazy {
        AudiobookStore(File(context.filesDir, "audiobooks"), json, http, retrofit.create(AudiobookApi::class.java),
            scope, ::audiobookAccount, audiobookAccounts) { audiobooksEnabled.value }
    }
    internal val audiobookPlayback by lazy {
        AudiobookPlayback(context.applicationContext, scope, audiobookStore, {
            if (audiobooksEnabled.value) audiobookAccount() else null
        }, connect::pauseForAudiobook, connect::routeBook)
    }

    private fun applyAudiobookExperiment(enabled: Boolean) {
        if (!enabled && audiobooksEnabled.value) {
            audiobookPlayback.pauseForMusic()
            audiobookPlayback.openFromNotification.value = false
        }
        audiobookExperiment.value = enabled
    }

    internal fun receiveAudiobookExperiment(owner: AudiobookAccount, enabled: Boolean): Boolean {
        if (audiobookAccount() != owner) return false
        audiobookExperimentStreamOwner = owner
        audiobookExperimentPreferences.edit { putBoolean(owner.server.toString(), enabled) }
        val changed = enabled != audiobooksEnabled.value
        applyAudiobookExperiment(enabled)
        if (enabled && !changed) audiobookStore.requestRefreshIfStale()
        return changed
    }

    private val artworkRefresh = kotlinx.coroutines.channels.Channel<Unit>(kotlinx.coroutines.channels.Channel.CONFLATED)
    private val lyricsRefresh = kotlinx.coroutines.channels.Channel<Unit>(kotlinx.coroutines.channels.Channel.CONFLATED)
    fun refreshDownloadMetadata() {
        artworkRefresh.trySend(Unit)
        lyricsRefresh.trySend(Unit)
    }

    fun setAllowLocalHttp(value: Boolean) {
        connectionPreferences.setAllowLocalHttp(value)
        if (!value && server.url.value?.scheme == "http") {
            http.dispatcher.cancelAll()
            offlineReadsHttp.dispatcher.cancelAll()
            http.connectionPool.evictAll()
            libraryCache.offline.value = true
        } else if (value) {
            refreshLibraryConnection()
            refreshDownloadMetadata()
        }
    }

    private val connectionProbe = kotlinx.coroutines.sync.Mutex()
    fun refreshLibraryConnection() {
        playbackSync.request()
        audiobookExperimentRefresh.trySend(Unit)
        if (audiobooksEnabled.value) audiobookStore.requestRefresh()
        probeLibraryConnection()
    }

    private fun probeLibraryConnection() {
        scope.launch {
            if (session.state.value !is SessionState.SignedIn || !connectionProbe.tryLock()) return@launch
            try { withTimeoutOrNull(5_000) { runCatching { api.me() } } }
            finally { connectionProbe.unlock() }
        }
    }

    fun locallyAvailable(id: String): Boolean = downloads.completed(id) != null || syncStore.audio(id) != null
    fun playable(tracks: List<Track>): List<Track> = if (libraryCache.offline.value) tracks.filter { locallyAvailable(it.id) } else tracks


    init {
        playbackSync.start(scope)
        scope.launch(Dispatchers.Main) {
            combine(session.state, server.url) { state, address ->
                val user = (state as? SessionState.SignedIn)?.user
                if (address != null && user != null) AudiobookAccount(address, user.id) else null
            }.distinctUntilChanged().collectLatest { owner ->
                if (owner == null || audiobookExperimentStreamOwner != owner) {
                    audiobookExperimentStreamOwner = null
                    applyAudiobookExperiment(false)
                }
                if (owner == null) return@collectLatest
                val key = owner.server.toString()
                var first = true
                audiobookExperimentRefresh.trySend(Unit)
                for (request in audiobookExperimentRefresh) {
                    if (audiobookExperimentStreamOwner == owner) continue
                    val remote = try {
                        withTimeoutOrNull(4_000) { api.audiobookExperiment().enabled }
                    } catch (_: IOException) {
                        null
                    } catch (error: retrofit2.HttpException) {
                        if (error.code() == 404) false else null
                    }
                    if (audiobookAccount() != owner || audiobookExperimentStreamOwner == owner) continue
                    if (remote != null) audiobookExperimentPreferences.edit { putBoolean(key, remote) }
                    if (remote != null || first) {
                        applyAudiobookExperiment(remote ?: audiobookExperimentPreferences.getBoolean(key, false))
                    }
                    first = false
                }
            }
        }
        scope.launch {
            for (request in lyricsRefresh) {
                val owner = accountKey ?: continue
                // The first response can contain only line timing while word timing
                // is being fetched by the server. Persist the richer response too.
                for (attempt in 0 until 5) {
                    if (accountKey != owner) break
                    val ids = kotlinx.coroutines.withContext(Dispatchers.Main) {
                        downloads.state.value.values.filter { downloads.visible(it) }.mapNotNull { it.track?.id }
                    }
                    if (!downloadedLyrics.refresh(ids)) break
                    if (attempt < 4) kotlinx.coroutines.delay(15_000)
                }
            }
        }

        scope.launch {
            for (request in artworkRefresh) {
                if (session.state.value !is SessionState.SignedIn) continue
                val songs = kotlinx.coroutines.withContext(Dispatchers.Main) {
                    downloads.state.value.values.filter { downloads.visible(it) }.mapNotNull { it.track }
                }
                downloadedCatalog.cacheTrackArtwork(songs, http)
            }
        }
        scope.launch {
            session.state.first { it is SessionState.SignedIn }
            val state = kotlinx.coroutines.withContext(Dispatchers.Main) { downloads.state }
            state.map { entries -> entries.values.mapNotNull { entry -> entry.track?.let { it to entry.done } }.toSet() }
                .distinctUntilChanged().collect { refreshDownloadMetadata() }
        }
        player.remoteRoute = { command -> connect.route(command) }
        player.remoteSelected = { connect.isRemote }
        scope.launch {
            session.state.collect { state ->
                favorites.refreshAccount()
                syncStore.session((state as? SessionState.SignedIn)?.user)
                if (state is SessionState.SignedIn) {
                    refreshDownloadMetadata()
                    refreshLibraryConnection()
                }
                if(syncStore.active) {
                    syncStore.snapshot?.get("tracks")?.let { rows ->
                        json.decodeFromJsonElement<List<Track>>(rows).forEach { tracks[it.id]=it }
                    }
                    recommendationsEnabled.value=syncStore.snapshot?.get("recommendationsEnabled")?.jsonPrimitive?.booleanOrNull ?: false
                    SyncScheduler.schedule(context,soon=true)
                }
            }
        }
    }

    val queue = AtomicFile(File(context.filesDir, "queue.json"))

    suspend fun flushSignals() {
        withTimeoutOrNull(SIGNALS_FLUSH_WAIT_MS) {
            signals.send()
            playbackSync.flush()
        }
    }

    suspend fun radio(request: RadioRequest): RadioBatch {
        val playlist = request.playlistId != null
        if (!playlist) {
            if (libraryCache.offline.value && request.seedTrackId == null) return localRadio(request)
            if (syncStore.active && request.seedTrackId == null && syncStore.snapshot?.containsKey("radio") == true) return offlineRadio(request)
            if (syncStore.active && !sync.network.available()) return offlineRadio(request)
        }
        return try {
            kotlinx.coroutines.withTimeout(8_000) {
                if (!playlist) {
                    refreshCapabilities()
                    check(recommendationsEnabled.value) { "Recommendations module is disabled" }
                }
                flushSignals()
                api.radio(request.copy(sessionId = request.sessionId ?: listeningSession)).also { syncStore.offlineQueue=false }
            }
        } catch(error: IOException) { if(!playlist && syncStore.active) offlineRadio(request) else throw error }
          catch(error: kotlinx.coroutines.TimeoutCancellationException) { if(!playlist && syncStore.active) offlineRadio(request) else throw error }
          catch(error: retrofit2.HttpException) { if(!playlist && syncStore.active && (error.code()>=500 || error.code()==401)) offlineRadio(request) else throw error }
    }

    private fun localRadio(request: RadioRequest): RadioBatch {
        val library = localLibrary.value
        if (library.account != accountKey) return RadioBatch()
        val seen = request.exclude.toMutableSet()
        val ranked = if (syncStore.active) syncStore.snapshot?.get("radio")?.let { json.decodeFromJsonElement<RadioBatch>(it) } else null
        val tracks = buildList {
            ranked?.tracks.orEmpty().forEach { if (it.track.id in library.trackIds && seen.add(it.track.id)) add(it) }
            library.availableTracks.shuffled().forEach { if (seen.add(it.id)) add(app.caimack.api.RecommendedTrack(it)) }
        }
        return RadioBatch(tracks)
    }

    private fun offlineRadio(request: RadioRequest): RadioBatch {
        check(request.seedTrackId==null) { "Only general radio is synchronized for offline playback" }
        val value = syncStore.snapshot?.get("radio") ?: throw IOException("Radio has not been synchronized yet")
        syncStore.offlineQueue=true
        val batch = json.decodeFromJsonElement<RadioBatch>(value)
        return batch.copy(tracks=batch.tracks.filter { locallyAvailable(it.track.id) && it.track.id !in request.exclude }.take(100),seedTrackId=null)
    }

    fun shelfShown(source: String) =
        signals.add(PlaybackSignal("shelfShown", null, 0, occurredAt = Instant.now().toString(), sessionId = listeningSession, source = source))

    private companion object {
        const val SIGNALS_FLUSH_WAIT_MS = 1_500L
    }
}
