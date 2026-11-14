// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.widget

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.*
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LatestWidgetUpdateTest {
    @Test fun `late cover cannot overwrite a newer widget even if loader ignores cancellation`() = runTest {
        val updates = LatestWidgetUpdate()
        val slow = CompletableDeferred<Unit>()
        val published = mutableListOf<String>()
        updates.submit(backgroundScope) {
            withContext(NonCancellable) { slow.await() }
            val publish: () -> Unit = { published += "old cover and metadata" }
            publish
        }
        runCurrent()
        updates.submit(backgroundScope) {
            val publish: () -> Unit = { published += "new cover and metadata" }
            publish
        }
        runCurrent()
        assertEquals(listOf("new cover and metadata"), published)
        slow.complete(Unit)
        runCurrent()
        assertEquals(listOf("new cover and metadata"), published)
    }
}
