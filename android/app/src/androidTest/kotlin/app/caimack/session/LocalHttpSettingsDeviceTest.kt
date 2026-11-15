// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.session

import androidx.test.platform.app.InstrumentationRegistry
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test

class LocalHttpSettingsDeviceTest {
    @Test fun defaultIsOffAndTheChoicePersists() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = "qa-connection-${System.nanoTime()}"
        try {
            val first = ConnectionPreferences(context, file)
            assertFalse(first.allowLocalHttp.value)
            first.setAllowLocalHttp(true)
            assertTrue(ConnectionPreferences(context, file).allowLocalHttp.value)
            first.setAllowLocalHttp(false)
            assertFalse(ConnectionPreferences(context, file).allowLocalHttp.value)
        } finally { context.deleteSharedPreferences(file) }
    }

    @Test fun localRequestsRequireTheOptInOnTheDevice() {
        MockWebServer().use { web ->
            web.start()
            var enabled = false
            val policy = LocalHttpPolicy({ enabled }, { web.url("/") })
            val client = OkHttpClient.Builder().addInterceptor(policy.interceptor).addNetworkInterceptor(policy.networkInterceptor).build()
            val request = Request.Builder().url(web.url("/")).build()
            try { client.newCall(request).execute().close(); fail("HTTP must be disabled") }
            catch (error: LocalHttpPolicy.Denied) { assertTrue(error.disabled) }
            assertEquals(0, web.requestCount)
            enabled = true
            web.enqueue(MockResponse.Builder().body("ok").build())
            client.newCall(request).execute().use { assertEquals(200, it.code) }
        }
    }
}
