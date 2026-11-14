// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import app.caimack.api.CaimackApi
import app.caimack.api.Track
import java.io.IOException
import java.lang.reflect.Proxy
import kotlin.coroutines.Continuation
import kotlin.coroutines.intrinsics.COROUTINE_SUSPENDED
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FavoritesTest {
    private data class Call(val method: String, val result: Continuation<Unit>)
    private val track = Track("track", "Track", "artist", "Artist", durationSeconds = 180)
    private val calls = mutableListOf<Call>()
    private val api = Proxy.newProxyInstance(CaimackApi::class.java.classLoader, arrayOf(CaimackApi::class.java)) { _, method, args ->
        check(method.name == "like" || method.name == "unlike")
        @Suppress("UNCHECKED_CAST")
        calls += Call(method.name, args!!.last() as Continuation<Unit>)
        COROUTINE_SUSPENDED
    } as CaimackApi

    @Test fun `account and server changes clear overrides and discard late responses`() = runTest {
        var account: String? = "server|alice"
        val favorites = Favorites(api, backgroundScope, Signals(api, backgroundScope, "test") { _, _, _ -> true }) { account }
        favorites.toggle(track)
        runCurrent()
        assertTrue(favorites.isFavorite(track))
        account = "server|bob"
        favorites.refreshAccount()
        assertFalse(favorites.isFavorite(track))
        calls.single().result.resume(Unit)
        runCurrent()
        assertFalse(favorites.isFavorite(track))
        favorites.toggle(track)
        runCurrent()
        calls.last().result.resume(Unit)
        runCurrent()
        account = "other-server|bob"
        assertFalse(favorites.isFavorite(track))
        account = null
        favorites.toggle(track)
        runCurrent()
        assertEquals(2, calls.size)
    }

    @Test fun `older failure cannot undo latest choice and queued requests are coalesced`() = runTest {
        val favorites = Favorites(api, backgroundScope, Signals(api, backgroundScope, "test") { _, _, _ -> true })
        favorites.toggle(track)
        runCurrent()
        favorites.toggle(track)
        favorites.toggle(track)
        runCurrent()
        assertEquals(listOf("like"), calls.map { it.method })
        calls.first().result.resumeWithException(IOException("Old request failed"))
        runCurrent()
        assertTrue(favorites.isFavorite(track))
        assertEquals(listOf("like", "like"), calls.map { it.method })
        calls.last().result.resume(Unit)
        runCurrent()
        assertTrue(favorites.isFavorite(track))
    }

    @Test fun `latest failure restores last confirmed state and writes stay ordered`() = runTest {
        val favorites = Favorites(api, backgroundScope, Signals(api, backgroundScope, "test") { _, _, _ -> true })
        favorites.toggle(track)
        runCurrent()
        favorites.toggle(track)
        runCurrent()
        assertEquals(1, calls.size)
        calls.first().result.resume(Unit)
        runCurrent()
        assertEquals(listOf("like", "unlike"), calls.map { it.method })
        calls.last().result.resumeWithException(IOException("Latest request failed"))
        runCurrent()
        assertTrue(favorites.isFavorite(track))
    }
}
