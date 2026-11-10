// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.updates

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ReleasesTest {
    private val repo = "owner/music"
    private val releases = GitHubReleases(repo)
    private fun payload(tag: String = "v1.0.9", extra: String = "", url: String = "https://github.com/$repo/releases/download/$tag/caimack-$tag-arm64.apk", name: String = "caimack-$tag-arm64.apk", state: String = "uploaded", size: Long = 42) =
        """{"tag_name":"$tag","body":"Release notes","assets":[{"name":"$name","state":"$state","size":$size,"browser_download_url":"$url"}]$extra}"""

    @Test fun `stable numeric versions match Android versionCode order`() {
        assertTrue(releaseVersion("v1.0.10")!! > releaseVersion("1.0.9")!!)
        assertTrue(releaseVersion("2.0.0")!! > releaseVersion("v1.99.99")!!)
        assertEquals(0, releaseVersion("0.0.0"))
        for (tag in listOf("1.0", "v1.0.9-beta", "v01.0.0", "v1.100.0", "-1.0.0", "1.0.9\n", "9999999999.0.0")) assertNull(tag, releaseVersion(tag))
    }

    @Test fun `only an uploaded APK belonging to the exact repository and tag is offered`() {
        val release = releases.parse(payload())!!
        assertEquals("1.0.9", release.version)
        assertEquals("Release notes", release.notes)
        assertTrue(trustedRelease(release, repo))
        assertFalse(trustedRelease(release, "other/music"))
        assertNotNull(GitHubReleases("Owner/Music").parse(payload()))
        for (url in listOf(
            "http://github.com/$repo/releases/download/v1.0.9/caimack-v1.0.9-arm64.apk",
            "https://github.com.evil.test/$repo/releases/download/v1.0.9/caimack-v1.0.9-arm64.apk",
            "https://github.com/other/music/releases/download/v1.0.9/caimack-v1.0.9-arm64.apk",
            "https://github.com/$repo/releases/download/v1.0.8/caimack-v1.0.9-arm64.apk",
            "https://github.com/$repo/releases/download/v1.0.9/caimack-v1.0.9-arm64.apk?token=anything",
        )) assertThrows(IOException::class.java) { releases.parse(payload(url = url)) }
    }

    @Test fun `drafts prereleases and malformed tags are ignored`() {
        assertNull(releases.parse(payload(extra = ",\"draft\":true")))
        assertNull(releases.parse(payload(extra = ",\"prerelease\":true")))
        assertNull(releases.parse(payload(tag = "v1.0.9-rc1")))
    }

    @Test fun `missing empty or unfinished APKs are not reported as up to date`() {
        for (raw in listOf(payload(name = "source.zip"), payload(state = "starter"), payload(size = 0), """{"tag_name":"v1.0.9"}""")) {
            assertThrows(IOException::class.java) { releases.parse(raw) }
        }
    }

    @Test fun `public API requests do not contain server credentials and handle no releases`() = runBlocking {
        MockWebServer().use { web ->
            web.start()
            web.enqueue(MockResponse.Builder().code(200).body(payload()).build())
            web.enqueue(MockResponse.Builder().code(404).build())
            web.enqueue(MockResponse.Builder().code(403).body("rate limited").build())
            val source = GitHubReleases(repo, api = web.url("/"))
            assertEquals("v1.0.9", source.latest()?.tag)
            val request = web.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("/repos/$repo/releases/latest", request.url.encodedPath)
            assertNull(request.headers["Authorization"])
            assertNull(request.headers["Cookie"])
            assertNull(source.latest())
            try { source.latest(); fail("HTTP failures must stay retryable") } catch (_: IOException) { }
        }
    }

    @Test fun `chunked responses work and oversized responses fail`() = runBlocking {
        MockWebServer().use { web ->
            web.start()
            web.enqueue(MockResponse.Builder().code(200).chunkedBody(payload(), 32).build())
            web.enqueue(MockResponse.Builder().code(200).body("x".repeat(2_000_001)).build())
            val source = GitHubReleases(repo, api = web.url("/"))
            assertNotNull(source.latest())
            try { source.latest(); fail("Oversized response accepted") } catch (_: IOException) { }
        }
    }
}
