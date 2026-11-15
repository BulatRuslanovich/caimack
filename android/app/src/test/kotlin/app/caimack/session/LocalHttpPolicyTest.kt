// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.session

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test

class LocalHttpPolicyTest {
    @Test fun `only unambiguous private IP literals and localhost are local`() {
        listOf("10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.228", "127.0.0.1",
            "localhost", "169.254.1.1", "::1", "fd00::1", "fe80::1").forEach {
            assertTrue(it, LocalHttpPolicy.isLocalHost(it))
        }
        listOf("example.com", "server.local", "8.8.8.8", "172.15.1.1", "172.32.0.1", "192.169.1.1",
            "0.0.0.0", "2130706433", "127.1", "010.0.0.1", "10.0.0.256", "localhost.example.com",
            "2001:4860:4860::8888").forEach { assertFalse(it, LocalHttpPolicy.isLocalHost(it)) }
    }

    @Test fun `disabled HTTP sends nothing and enabling can be revoked on a reused connection`() {
        MockWebServer().use { web ->
            web.start()
            var enabled = false
            val policy = LocalHttpPolicy({ enabled }, { web.url("/") })
            val http = OkHttpClient.Builder().addInterceptor(policy.interceptor).addNetworkInterceptor(policy.networkInterceptor).build()
            val request = Request.Builder().url(web.url("/api/auth/me")).build()
            fun denied() {
                try { http.newCall(request).execute().close(); fail("HTTP must be rejected") }
                catch (error: LocalHttpPolicy.Denied) { assertTrue(error.disabled) }
            }
            denied()
            assertEquals(0, web.requestCount)
            enabled = true
            web.enqueue(MockResponse.Builder().body("ok").build())
            http.newCall(request).execute().use { assertEquals(200, it.code) }
            enabled = false
            denied()
            assertEquals(1, web.requestCount)
        }
    }

    @Test fun `enabling local HTTP never permits public addresses or public names`() {
        val policy = LocalHttpPolicy({ true })
        val http = OkHttpClient.Builder().addInterceptor(policy.interceptor).build()
        for (url in listOf("http://8.8.8.8/", "http://example.com/")) {
            try { http.newCall(Request.Builder().url(url).build()).execute().close(); fail("Public HTTP must be rejected") }
            catch (error: LocalHttpPolicy.Denied) { assertFalse(error.disabled) }
        }
    }

    @Test fun `redirects cannot send HTTP to another local server`() {
        MockWebServer().use { first -> MockWebServer().use { other ->
            first.start(); other.start()
            val policy = LocalHttpPolicy({ true }, { first.url("/") })
            val http = OkHttpClient.Builder().addInterceptor(policy.interceptor).addNetworkInterceptor(policy.networkInterceptor)
                .followSslRedirects(false).build()
            first.enqueue(MockResponse.Builder().code(302).addHeader("Location", other.url("/private").toString()).build())
            try { http.newCall(Request.Builder().url(first.url("/")).build()).execute().close(); fail("Redirect must be rejected") }
            catch (error: LocalHttpPolicy.Denied) { assertFalse(error.disabled) }
            assertEquals(1, first.requestCount)
            assertEquals(0, other.requestCount)
        } }
    }

    @Test fun `HTTPS server selection cannot be downgraded even with local HTTP enabled`() {
        val policy = LocalHttpPolicy({ true }, { "https://192.168.1.228/".toHttpUrl() })
        val http = OkHttpClient.Builder().addInterceptor(policy.interceptor).build()
        try { http.newCall(Request.Builder().url("http://192.168.1.228/").build()).execute().close(); fail("Downgrade must be rejected") }
        catch (error: LocalHttpPolicy.Denied) { assertFalse(error.disabled) }
    }

    @Test fun `a local server must be selected before HTTP can be sent`() {
        MockWebServer().use { web ->
            web.start()
            val policy = LocalHttpPolicy({ true }, { null })
            val http = OkHttpClient.Builder().addInterceptor(policy.interceptor).build()
            try { http.newCall(Request.Builder().url(web.url("/")).build()).execute().close(); fail("No server selected") }
            catch (error: LocalHttpPolicy.Denied) { assertFalse(error.disabled) }
            assertEquals(0, web.requestCount)
        }
    }
}
