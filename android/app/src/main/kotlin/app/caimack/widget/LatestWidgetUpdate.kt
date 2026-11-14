// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.widget

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** A late image result must never overwrite a newer widget snapshot, even after cancellation. */
internal class LatestWidgetUpdate {
    private var revision = 0L
    private var job: Job? = null

    @Synchronized fun submit(scope: CoroutineScope, load: suspend () -> (() -> Unit)) {
        val current = ++revision
        job?.cancel()
        job = scope.launch {
            val publish = load()
            synchronized(this@LatestWidgetUpdate) {
                if (revision == current) publish()
            }
        }
    }
}
