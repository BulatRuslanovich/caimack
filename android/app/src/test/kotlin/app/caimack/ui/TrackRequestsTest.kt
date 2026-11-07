// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import app.caimack.api.CaimackApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.MediaType.Companion.toMediaType
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class TrackRequestsTest {
    @Test fun searchAndSortAreSentToTheServerAndShuffleUsesTheSameFilter() = runBlocking {
        val web = MockWebServer()
        web.start()
        try {
            val api = Retrofit.Builder().baseUrl(web.url("/"))
                .addConverterFactory(Json.asConverterFactory("application/json".toMediaType()))
                .build().create(CaimackApi::class.java)
            web.enqueue(MockResponse.Builder().body("""{"items":[],"total":0,"page":1,"pageSize":50}""").build())
            api.tracks(1, 50, "Recent", "Рок & jazz")
            val list = web.takeRequest()
            assertEquals("Recent", list.url.queryParameter("sort"))
            assertEquals("Рок & jazz", list.url.queryParameter("q"))
            web.enqueue(MockResponse.Builder().body("[]").build())
            api.shuffleTracks("Рок & jazz")
            val shuffle = web.takeRequest()
            assertEquals("/api/tracks/shuffle", shuffle.url.encodedPath)
            assertEquals("Рок & jazz", shuffle.url.queryParameter("q"))
        } finally { web.close() }
    }
}
