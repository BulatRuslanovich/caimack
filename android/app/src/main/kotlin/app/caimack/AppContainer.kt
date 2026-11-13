// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack

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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
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
import app.caimack.sync.SyncScheduler
import app.caimack.session.SessionState
import java.io.IOException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class AppContainer(context: Context) {
    val recommendationsEnabled = MutableStateFlow(false)
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
    val sync by lazy { LibrarySync(context.applicationContext,syncStore,server) { http } }

    private val cookies = PersistentCookieJar(preferences, scope)

    val libraryCache by lazy { app.caimack.playback.LibraryCache(File(context.filesDir, "library-cache"),
        { (session.state.value as? SessionState.SignedIn)?.let { "${server.url.value}|${it.user.id}" } },
        { downloadedCatalog.localSnapshot() }, json) }

    val http: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookies)
        .addInterceptor(server.interceptor)
        .addInterceptor(offlineCatalog.interceptor)
        .addInterceptor { libraryCache.interceptor.intercept(it) }
        .authenticator(SessionAuthenticator(server, { http }) { session.expire() })
        .build()

    val api: CaimackApi = Retrofit.Builder()
        .baseUrl(Server.PLACEHOLDER)
        .client(http)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(CaimackApi::class.java)

    val session = Session(api, server, cookies, json, { deviceName }, syncStore::offlineUser, syncStore::login, syncStore::logout)

    val media = Media(server) { path -> syncStore.asset(path) ?: downloadedCatalog.asset(path) }

    val settings = MutableStateFlow(UserSettings())
    val playbackDelivery = MutableStateFlow<app.caimack.playback.PlaybackDelivery?>(null)

    val appearance = Appearance(context)

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
        val saved = syncStore.enqueue(SyncAction(kind=kind,occurredAt=occurredAt,payload=payload))
        if(saved) SyncScheduler.schedule(context,soon=true)
        saved
    }

    val favorites = Favorites(api, scope, signals)

    val downloads by lazy { Downloads(context.applicationContext, http, server, json) { !syncStore.active } }

    val downloadedCatalog by lazy { app.caimack.playback.DownloadedCatalog(context.applicationContext, json,
        { server.url.value?.toString() },
        { downloads.tracks() + syncStore.tracks() },
        { if (syncStore.active) app.caimack.sync.OfflineCatalog.view(syncStore.snapshot ?: kotlinx.serialization.json.buildJsonObject {}, syncStore.edits()) else null }) }

    val player = PlayerConnection(context.applicationContext, media, tracks, radio, signals)
    val connect by lazy { ConnectPlayback(context.applicationContext, this) }

    private val artworkRefresh = kotlinx.coroutines.channels.Channel<Unit>(kotlinx.coroutines.channels.Channel.CONFLATED)
    fun refreshDownloadArtwork() { artworkRefresh.trySend(Unit) }
    private val connectionProbe = kotlinx.coroutines.sync.Mutex()
    fun refreshLibraryConnection() {
        scope.launch {
            if (session.state.value !is SessionState.SignedIn || !connectionProbe.tryLock()) return@launch
            try { withTimeoutOrNull(5_000) { runCatching { api.me() } } }
            finally { connectionProbe.unlock() }
        }
    }

    fun locallyAvailable(id: String): Boolean = downloads.state.value[id]?.done == true || syncStore.audio(id) != null
    fun playable(tracks: List<Track>): List<Track> = if (libraryCache.offline.value) tracks.filter { locallyAvailable(it.id) } else tracks


    init {
        scope.launch {
            for (request in artworkRefresh) {
                if (session.state.value !is SessionState.SignedIn) continue
                val songs = kotlinx.coroutines.withContext(Dispatchers.Main) {
                    downloads.state.value.values.mapNotNull { it.track }
                }
                downloadedCatalog.cacheTrackArtwork(songs, http)
            }
        }
        scope.launch {
            session.state.first { it is SessionState.SignedIn }
            val state = kotlinx.coroutines.withContext(Dispatchers.Main) { downloads.state }
            state.map { entries -> entries.values.mapNotNull { it.track }.toSet() }
                .distinctUntilChanged().collect { refreshDownloadArtwork() }
        }
        player.remoteRoute = { command -> connect.route(command) }
        player.remoteSelected = { connect.isRemote }
        scope.launch {
            session.state.collect { state ->
                syncStore.session((state as? SessionState.SignedIn)?.user)
                if (state is SessionState.SignedIn) refreshDownloadArtwork()
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
        withTimeoutOrNull(SIGNALS_FLUSH_WAIT_MS) { signals.send() }
    }

    suspend fun radio(request: RadioRequest): RadioBatch {
        if(syncStore.active && request.seedTrackId==null && syncStore.snapshot?.containsKey("radio")==true) return offlineRadio(request)
        if(syncStore.active && !sync.network.available()) return offlineRadio(request)
        return try {
            kotlinx.coroutines.withTimeout(8_000) {
                refreshCapabilities()
                check(recommendationsEnabled.value) { "Recommendations module is disabled" }
                flushSignals()
                api.radio(request.copy(sessionId = listeningSession)).also { syncStore.offlineQueue=false }
            }
        } catch(error: IOException) { if(syncStore.active) offlineRadio(request) else throw error }
          catch(error: kotlinx.coroutines.TimeoutCancellationException) { if(syncStore.active) offlineRadio(request) else throw error }
          catch(error: retrofit2.HttpException) { if(syncStore.active && (error.code()>=500 || error.code()==401)) offlineRadio(request) else throw error }
    }

    private fun offlineRadio(request: RadioRequest): RadioBatch {
        check(request.seedTrackId==null) { "Only general radio is synchronized for offline playback" }
        val value = syncStore.snapshot?.get("radio") ?: throw IOException("Radio has not been synchronized yet")
        syncStore.offlineQueue=true
        val batch = json.decodeFromJsonElement<RadioBatch>(value)
        return batch.copy(tracks=batch.tracks.filter { syncStore.audio(it.track.id)!=null && it.track.id !in request.exclude }.take(100),seedTrackId=null)
    }

    fun shelfShown(source: String) =
        signals.add(PlaybackSignal("shelfShown", null, 0, occurredAt = Instant.now().toString(), sessionId = listeningSession, source = source))

    private companion object {
        const val SIGNALS_FLUSH_WAIT_MS = 1_500L
    }
}
