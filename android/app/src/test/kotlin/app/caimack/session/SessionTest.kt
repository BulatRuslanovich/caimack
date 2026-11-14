// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.session

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import app.caimack.api.CaimackApi
import app.caimack.api.User
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.Cookie
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class SessionTest {
    private val web = MockWebServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true }
    private val cachedUser = User("account", "Cached name")
    private lateinit var directory: File
    private lateinit var preferences: DataStore<Preferences>
    private var webClosed = false

    @Before
    fun start() = runBlocking {
        web.start()
        directory = Files.createTempDirectory("restore-session").toFile()
        preferences = PreferenceDataStoreFactory.create(scope = scope) { File(directory, "session.preferences_pb") }
        Server(preferences).remember(web.url("/").toString())
        Unit
    }

    @After
    fun stop() {
        if (!webClosed) web.close()
        scope.cancel()
        directory.deleteRecursively()
    }

    @Test
    fun `individual downloads can be reached before the session check finishes`() = runBlocking {
        rememberUser()
        val requested = CountDownLatch(1)
        val respond = CountDownLatch(1)
        val freshUser = cachedUser.copy(username = "Updated name")
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requested.countDown()
                check(respond.await(5, TimeUnit.SECONDS))
                return MockResponse.Builder().body(json.encodeToString(freshUser)).build()
            }
        }
        val session = session()
        val restoring = launch(Dispatchers.IO) { session.restore() }
        try {
            assertTrue(requested.await(5, TimeUnit.SECONDS))
            assertEquals(SessionState.SignedIn(cachedUser), session.state.value)
        } finally {
            respond.countDown()
            restoring.join()
        }
        assertEquals(SessionState.SignedIn(freshUser), session.state.value)
    }

    @Test
    fun `an unreachable server keeps the saved session without full library sync`() = runBlocking {
        rememberUser()
        val session = session()
        web.close()
        webClosed = true
        session.restore()
        assertEquals(SessionState.SignedIn(cachedUser), session.state.value)
    }

    @Test
    fun `a session rejected by the server still requires sign in`() = runBlocking {
        rememberUser()
        web.enqueue(MockResponse.Builder().code(401).build())
        val session = session()
        session.restore()
        assertEquals(SessionState.SignedOut(expired = true), session.state.value)
    }

    @Test
    fun `an account without a saved identity stays signed out`() = runBlocking {
        val session = session()
        session.restore()
        assertEquals(SessionState.SignedOut(), session.state.value)
        assertEquals(0, web.requestCount)
    }

    @Test
    fun `a synchronized account remains available when its server rejects the session`() = runBlocking {
        web.enqueue(MockResponse.Builder().code(401).build())
        val session = session(offlineUser = { cachedUser })
        session.restore()
        assertEquals(SessionState.SignedIn(cachedUser), session.state.value)
    }

    private suspend fun rememberUser() {
        val hint = Base64.getUrlEncoder().withoutPadding().encodeToString(json.encodeToString(cachedUser).toByteArray())
        val cookie = Cookie.Builder().name("ms_session").value(hint)
            .hostOnlyDomain(web.url("/").host).path("/")
            .expiresAt(System.currentTimeMillis() + 60_000).build()
        PersistentCookieJar(preferences, scope).saveFromResponse(web.url("/"), listOf(cookie))
        withTimeout(5_000) { preferences.data.first { it[stringPreferencesKey("cookies")] != null } }
    }

    private fun session(offlineUser: () -> User? = { null }): Session {
        val server = Server(preferences)
        val cookies = PersistentCookieJar(preferences, scope)
        val client = OkHttpClient.Builder().cookieJar(cookies).addInterceptor(server.interceptor).build()
        val api = Retrofit.Builder().baseUrl(Server.PLACEHOLDER).client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(CaimackApi::class.java)
        return Session(api, server, cookies, json, { "Test phone" }, offlineUser)
    }
}
