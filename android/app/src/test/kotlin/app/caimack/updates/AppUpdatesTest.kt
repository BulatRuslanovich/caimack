// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.updates

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class AppUpdatesTest {
    private class MemoryStorage : UpdateStorage {
        override var latest: AppRelease? = null
        override var lastChecked = 0L
        override var lastAttempt = 0L
        override var dismissedTag: String? = null
    }
    private fun release(tag: String = "v1.0.9") = AppRelease(tag, "Notes", "https://github.com/owner/music/releases/download/$tag/caimack-$tag-arm64.apk", "https://github.com/owner/music/releases/tag/$tag")

    @Test fun `checks are throttled across launches but manual checks bypass the interval`() = runTest {
        val store = MemoryStorage()
        var time = 1_000_000L
        var calls = 0
        val source = ReleaseSource { calls++; release() }
        fun checker() = AppUpdates(store, source, this, "1.0.8", now = { time })
        checker().check().join()
        checker().check().join()
        assertEquals(1, calls)
        checker().check(force = true).join()
        assertEquals(2, calls)
        time += AppUpdates.CHECK_INTERVAL_MS
        checker().check().join()
        assertEquals(3, calls)
    }

    @Test fun `dismissal persists for one version and installed versions never prompt`() = runTest {
        val store = MemoryStorage()
        var latest = release()
        val source = ReleaseSource { latest }
        val updates = AppUpdates(store, source, this, "1.0.8")
        updates.check().join()
        assertTrue(updates.state.value.showBanner)
        updates.dismiss()
        assertFalse(updates.state.value.showBanner)
        assertFalse(AppUpdates(store, source, this, "1.0.8").state.value.showBanner)
        assertNull(AppUpdates(store, source, this, "1.0.9").state.value.release)
        assertNull(AppUpdates(store, source, this, "2.0.0").state.value.release)
        latest = release("v1.0.10")
        updates.check(force = true).join()
        assertTrue(updates.state.value.showBanner)
    }

    @Test fun `failed checks retain a cached update and back off without claiming success`() = runTest {
        val store = MemoryStorage().apply { latest = release() }
        var time = 1_000_000L
        var calls = 0
        val updates = AppUpdates(store, ReleaseSource { calls++; throw IOException("offline") }, this, "1.0.8", now = { time })
        updates.check().join()
        assertTrue(updates.state.value.failed)
        assertFalse(updates.state.value.checking)
        assertFalse(updates.state.value.checked)
        assertNotNull(updates.state.value.release)
        assertEquals(0L, store.lastChecked)
        updates.check().join()
        assertEquals(1, calls)
        time += AppUpdates.RETRY_INTERVAL_MS
        updates.check().join()
        assertEquals(2, calls)
    }

    @Test fun `concurrent checks share the in-flight request`() = runTest {
        var calls = 0
        val gate = CompletableDeferred<Unit>()
        val updates = AppUpdates(MemoryStorage(), ReleaseSource { calls++; gate.await(); release() }, this, "1.0.8")
        val first = updates.check()
        testScheduler.runCurrent()
        updates.check(force = true).join()
        assertEquals(1, calls)
        assertTrue(updates.state.value.checking)
        gate.complete(Unit)
        first.join()
        assertFalse(updates.state.value.checking)
        assertNotNull(updates.state.value.release)
    }

    @Test fun `disabled builds do not contact GitHub`() = runTest {
        val updates = AppUpdates(MemoryStorage(), ReleaseSource { error("Must not check") }, this, "1.0.8", enabled = false)
        updates.check(force = true).join()
        assertFalse(updates.state.value.enabled)
    }

    @Test fun `no published release is different from having the latest version`() = runTest {
        val updates = AppUpdates(MemoryStorage(), ReleaseSource { null }, this, "1.0.8")
        updates.check().join()
        assertTrue(updates.state.value.checked)
        assertFalse(updates.state.value.published)
        assertNull(updates.state.value.release)
    }

    @Test fun `a backwards clock change does not suppress checking indefinitely`() = runTest {
        val store = MemoryStorage().apply { lastChecked = 9_000_000; lastAttempt = 9_000_000 }
        var calls = 0
        val updates = AppUpdates(store, ReleaseSource { calls++; release() }, this, "1.0.8", now = { 1_000_000 })
        updates.check().join()
        assertEquals(1, calls)
    }
}
