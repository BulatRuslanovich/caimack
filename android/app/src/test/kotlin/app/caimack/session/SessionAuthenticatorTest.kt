// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.session

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import java.io.File
import java.nio.file.Files
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SessionAuthenticatorTest {
    private val web = MockWebServer()
    private val refreshes = AtomicInteger()
    private var expired = false
    private var refreshAnswer: () -> MockResponse = { freshSession() }
    private lateinit var client: OkHttpClient
    private lateinit var directory: File

    @Before
    fun start() {
        web.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/api/auth/refresh" -> {
                    refreshes.incrementAndGet()
                    refreshAnswer()
                }
                "/api/auth/login" -> MockResponse.Builder().code(401).build()
                else -> if (request.headers["Cookie"]?.contains("ms_access=fresh") == true) {
                    MockResponse.Builder().code(200).body("ok").build()
                } else {
                    MockResponse.Builder().code(401).build()
                }
            }
        }
        web.start()

        directory = Files.createTempDirectory("session").toFile()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val preferences = PreferenceDataStoreFactory.create(scope = scope) { File(directory, "test.preferences_pb") }
        val server = Server(preferences)
        runBlocking { server.remember(web.url("/").toString()) }

        client = OkHttpClient.Builder()
            .cookieJar(PersistentCookieJar(preferences, scope))
            .addInterceptor(server.interceptor)
            .authenticator(SessionAuthenticator(server, { client }) { expired = true })
            .build()
    }

    @After
    fun stop() {
        web.close()
        directory.deleteRecursively()
    }

    @Test
    fun `an expired access token is refreshed once and the request goes through`() {
        val response = get("api/library")

        assertEquals(200, response)
        assertEquals(1, refreshes.get())
        assertFalse(expired)
    }

    @Test
    fun `requests that fail together share a single refresh`() {
        val pool = Executors.newFixedThreadPool(6)
        val results = (1..6).map { pool.submit<Int> { get("api/library") } }.map { it.get() }
        pool.shutdown()

        assertTrue(results.all { it == 200 })
        assertEquals(1, refreshes.get())
    }

    @Test
    fun `a refresh the server rejects ends the session`() {
        refreshAnswer = { MockResponse.Builder().code(401).build() }

        assertEquals(401, get("api/library"))
        assertTrue(expired)
    }

    @Test
    fun `a refresh lost to the network keeps the session`() {
        refreshAnswer = { MockResponse.Builder().onRequestStart(SocketEffect.CloseSocket()).build() }

        assertEquals(401, get("api/library"))
        assertFalse(expired)
    }

    @Test
    fun `sign-in is never retried through a refresh`() {
        val status = client.newCall(
            Request.Builder().url("${Server.PLACEHOLDER}api/auth/login").post("{}".toRequestBody()).build(),
        ).execute().use { it.code }

        assertEquals(401, status)
        assertEquals(0, refreshes.get())
    }

    private fun get(path: String): Int =
        client.newCall(Request.Builder().url("${Server.PLACEHOLDER}$path").build()).execute().use { it.code }

    private fun freshSession(): MockResponse = MockResponse.Builder()
        .code(200)
        .addHeader("Set-Cookie", "ms_access=fresh; Path=/; HttpOnly")
        .body("{}")
        .build()
}
