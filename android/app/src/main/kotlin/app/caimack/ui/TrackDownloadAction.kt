// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.exoplayer.offline.Download
import app.caimack.R
import app.caimack.api.Track
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
internal fun TrackDownloadAction(track: Track, onDismiss: () -> Unit) {
    val container = LocalContainer.current
    val synchronization by container.syncStore.status.collectAsStateWithLifecycle()
    if (synchronization.enabled && container.syncStore.active) return

    val downloads by container.downloads.state.collectAsStateWithLifecycle()
    val entry = downloads[track.id]?.takeIf(container.downloads::visible)
    if (entry?.download?.state == Download.STATE_REMOVING) return
    val complete = entry?.done == true
    val pending = entry != null && !complete && entry.download.state != Download.STATE_FAILED
    if (LocalOfflineLibrary.current && !complete && !pending) return

    val context = LocalContext.current
    val queued = stringResource(R.string.downloads_queued)
    val failed = stringResource(R.string.downloads_failed)
    val label = when {
        complete -> R.string.downloads_remove
        pending -> R.string.downloads_cancel
        entry != null -> R.string.downloads_retry
        else -> R.string.downloads_add
    }
    val icon = when {
        complete -> Lucide.CircleArrowDown
        pending -> Lucide.X
        else -> Lucide.Download
    }
    SheetRow(stringResource(label), icon) {
        if (complete || pending) {
            container.downloads.remove(listOf(track.id))
        } else {
            // The application scope keeps the request alive after the sheet closes.
            container.scope.launch {
                if (container.syncStore.active) return@launch
                try {
                    container.downloads.add(listOf(track), container.settings.value)
                    withContext(Dispatchers.Main) { Toast.makeText(context, queued, Toast.LENGTH_SHORT).show() }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    withContext(Dispatchers.Main) { Toast.makeText(context, failed, Toast.LENGTH_LONG).show() }
                }
            }
        }
        onDismiss()
    }
}
