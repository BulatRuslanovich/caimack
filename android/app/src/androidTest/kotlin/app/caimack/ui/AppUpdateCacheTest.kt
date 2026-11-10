// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.content.Context
import androidx.core.content.edit
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.BuildConfig
import app.caimack.updates.AppRelease
import app.caimack.updates.AppUpdates
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class AppUpdateCacheTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun withCache(test: (android.content.SharedPreferences, CoroutineScope, AppRelease) -> Unit) {
        val prefs = context.getSharedPreferences("app_updates", Context.MODE_PRIVATE)
        val original = prefs.all.toMap()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val repo = BuildConfig.UPDATE_REPOSITORY
        val tag = "v99.99.99"
        val release = AppRelease(tag, "Cached release notes", "https://github.com/$repo/releases/download/$tag/caimack-$tag-arm64.apk", "https://github.com/$repo/releases/tag/$tag")
        try {
            prefs.edit(commit = true) {
                clear()
                putString("repository", repo)
                putString("release", Json.encodeToString(release))
                putLong("checked", System.currentTimeMillis())
            }
            test(prefs, scope, release)
        } finally {
            scope.cancel()
            prefs.edit(commit = true) {
                clear()
                original.forEach { (key, value) ->
                    when (value) {
                        is String -> putString(key, value)
                        is Long -> putLong(key, value)
                    }
                }
            }
        }
    }

    @Test fun cachedUpdateAndDismissalSurviveRecreatingTheUpdater() = withCache { _, scope, release ->
        val first = AppUpdates(context, scope)
        assertEquals(release, first.state.value.release)
        assertTrue(first.state.value.showBanner)
        first.dismiss()
        val restarted = AppUpdates(context, scope)
        assertEquals(release, restarted.state.value.release)
        assertFalse(restarted.state.value.showBanner)
        // A fresh cached result must not contact the network on resume.
        runBlocking { restarted.check().join() }
        assertFalse(restarted.state.value.failed)
    }

    @Test fun cachedDownloadFromAnotherRepositoryIsRejected() = withCache { prefs, scope, release ->
        prefs.edit(commit = true) { putString("release", Json.encodeToString(release.copy(apkUrl = "https://github.com/other/repo/releases/download/v99.99.99/caimack-v99.99.99-arm64.apk"))) }
        assertNull(AppUpdates(context, scope).state.value.release)
    }
}
