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
import app.caimack.api.Track
import app.caimack.api.UserSettings
import app.caimack.playback.Downloads
import app.caimack.playback.EqualizerSettings
import app.caimack.playback.Favorites
import app.caimack.playback.PlaybackPrefs
import app.caimack.playback.PlayerConnection
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
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

    val preferences: DataStore<Preferences> =
        PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("caimack") }

    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    val server = Server(preferences) { appearance.language.ifEmpty { Locale.getDefault().toLanguageTag() } }

    private val cookies = PersistentCookieJar(preferences, scope)

    val http: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookies)
        .addInterceptor(server.interceptor)
        .authenticator(SessionAuthenticator(server, { http }) { session.expire() })
        .build()

    val api: CaimackApi = Retrofit.Builder()
        .baseUrl(Server.PLACEHOLDER)
        .client(http)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(CaimackApi::class.java)

    val session = Session(api, server, cookies, json) { deviceName }

    val media = Media(server)

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

    val signals = Signals(api, scope, listeningSession)

    val favorites = Favorites(api, scope, signals)

    val downloads by lazy { Downloads(context.applicationContext, http, server, json) }

    val player = PlayerConnection(context.applicationContext, media, tracks, radio, signals)

    val queue = AtomicFile(File(context.filesDir, "queue.json"))

    suspend fun flushSignals() {
        withTimeoutOrNull(SIGNALS_FLUSH_WAIT_MS) { signals.send() }
    }

    suspend fun radio(request: RadioRequest) = run {
        refreshCapabilities()
        check(recommendationsEnabled.value) { "Recommendations module is disabled" }
        flushSignals()
        api.radio(request.copy(sessionId = listeningSession))
    }

    fun shelfShown(source: String) =
        signals.add(PlaybackSignal("shelfShown", null, 0, occurredAt = Instant.now().toString(), sessionId = listeningSession, source = source))

    private companion object {
        const val SIGNALS_FLUSH_WAIT_MS = 1_500L
    }
}
