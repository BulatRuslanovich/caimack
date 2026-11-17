// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.sync

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.session.SessionState
import app.caimack.ui.LocalContainer
import app.caimack.ui.LocalPalette
import app.caimack.ui.Lucide
import app.caimack.ui.Radius
import app.caimack.ui.Toggle
import app.caimack.ui.Type
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SyncSettings() {
    val container = LocalContainer.current
    val context = LocalContext.current
    val state by container.syncStore.status.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var enableAfterPicker by remember { mutableStateOf(false) }
    var networkHelp by rememberSaveable { mutableStateOf(false) }
    val session by container.session.state.collectAsStateWithLifecycle()
    val user = (session as? SessionState.SignedIn)?.user
    val palette = LocalPalette.current
    fun start() {
        SyncScheduler.start(context)
    }
    val permissions =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            start()
        }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri != null && user != null)
                scope.launch {
                    runCatching {
                        context.contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                        )
                        val startAfterSelection = enableAfterPicker || state.enabled
                        withContext(Dispatchers.IO) {
                            container.syncStore.configure(uri, user)
                            if (startAfterSelection) container.syncStore.enable(true)
                        }
                        val required = buildList {
                            add(android.Manifest.permission.POST_NOTIFICATIONS)
                            if (Build.VERSION.SDK_INT >= 37) add("android.permission.ACCESS_LOCAL_NETWORK")
                        }
                        if (startAfterSelection) permissions.launch(required.toTypedArray())
                    }.onFailure { error = it.message }
                }
        }
    val changeEnabled: (Boolean) -> Unit = { value ->
        if (value && (state.folder == null || container.syncStore.boundUser != user?.id ||
                container.syncStore.boundAddress != container.server.url.value?.toString())) {
            enableAfterPicker = true
            picker.launch(null)
        } else {
            if (!value) container.sync.pause()
            scope.launch {
                runCatching {
                    withContext(Dispatchers.IO) { container.syncStore.enable(value) }
                }.onSuccess {
                    if (value) start() else SyncScheduler.schedule(context)
                }.onFailure { error = it.message }
            }
        }
    }
    val enableLabel = stringResource(R.string.sync_enable)
    val chooseFolderLabel = stringResource(R.string.sync_choose_folder)
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)
        Text(stringResource(R.string.sync_title), style = Type.heading)
        Text(stringResource(R.string.sync_description), style = Type.small, color = palette.muted)
        Column(
            Modifier.fillMaxWidth().clip(Radius.panel).background(palette.card)
                .border(1.dp, palette.border, Radius.panel).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(enableLabel, Modifier.weight(1f).padding(end = 12.dp),
                    style = Type.small.copy(fontWeight = FontWeight.Medium))
                Toggle(checked = state.enabled, onCheckedChange = changeEnabled,
                    modifier = Modifier.semantics { contentDescription = enableLabel })
            }
            HorizontalDivider(color = palette.border)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(Radius.row)
                    .clickable(enabled = !state.running, role = Role.Button, onClickLabel = chooseFolderLabel) {
                        enableAfterPicker = false
                        picker.launch(state.folder?.let(Uri::parse))
                    }.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(Lucide.Folder, null, tint = palette.primary, modifier = Modifier.size(22.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(stringResource(R.string.sync_folder), style = Type.tiny, color = palette.muted)
                    val folder = state.folder?.let { Uri.decode(it.substringAfterLast('/')).substringAfter(':') }
                    Text(folder?.ifBlank { stringResource(R.string.sync_folder_storage) } ?: chooseFolderLabel,
                        style = Type.small, color = palette.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Icon(Lucide.ChevronRight, null,
                    tint = if (state.running) palette.faint else palette.muted, modifier = Modifier.size(18.dp))
            }
            if (state.enabled) {
                HorizontalDivider(color = palette.border)
                val paused = container.syncStore.paused
                val status = when {
                    paused -> R.string.sync_paused
                    state.running -> R.string.sync_status_running
                    state.message != null || state.rejected > 0 -> R.string.sync_status_attention
                    state.lastSync > 0 && state.completed >= state.total -> R.string.sync_status_ready
                    else -> R.string.sync_status_waiting
                }
                val statusLabel = stringResource(status)
                val statusColor = when (status) {
                    R.string.sync_status_ready -> palette.success
                    R.string.sync_status_attention -> palette.warning
                    R.string.sync_status_running -> palette.primary
                    else -> palette.muted
                }
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(when (status) {
                            R.string.sync_status_ready -> Lucide.CircleCheck
                            R.string.sync_paused -> Lucide.Pause
                            R.string.sync_status_attention -> Lucide.TriangleAlert
                            else -> Lucide.CircleArrowDown
                        }, null, tint = statusColor, modifier = Modifier.size(18.dp))
                        Text(statusLabel, style = Type.small.copy(fontWeight = FontWeight.Medium), color = statusColor)
                    }
                    Text(stringResource(R.string.sync_progress, state.completed, state.total),
                        style = Type.small, color = palette.foreground)
                    if (state.running && !paused && state.totalBytes == 0L) {
                        LinearProgressIndicator(Modifier.fillMaxWidth(), color = palette.primary, trackColor = palette.raised)
                    } else if ((state.running && state.totalBytes > 0) || state.total > 0) {
                        LinearProgressIndicator(
                            progress = {
                                val progress = if (state.running && state.totalBytes > 0)
                                    state.bytes.toFloat() / state.totalBytes
                                else state.completed.toFloat() / state.total
                                progress.coerceIn(0f, 1f)
                            },
                            modifier = Modifier.fillMaxWidth(), color = palette.primary, trackColor = palette.raised,
                        )
                    }
                    state.message?.takeIf { it != statusLabel }?.let {
                        Text(it, style = Type.tiny, color = palette.muted)
                    }
                    if (state.lastSync > 0) Text(
                        stringResource(R.string.sync_last,
                            java.text.DateFormat.getDateTimeInstance().format(java.util.Date(state.lastSync))),
                        style = Type.tiny, color = palette.muted,
                    )
                    if (state.pending > 0) Text(stringResource(R.string.sync_pending, state.pending),
                        style = Type.tiny, color = palette.primary)
                    if (state.rejected > 0) Text(
                        stringResource(R.string.sync_rejected, state.rejected) + "\n" + container.syncStore.rejectionMessages(),
                        color = palette.destructive, style = Type.small,
                    )
                }
                if (state.running && !paused) {
                    OutlinedButton(
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = Radius.row,
                        onClick = { container.sync.pause(); SyncScheduler.schedule(context) },
                    ) {
                        Icon(Lucide.Pause, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.sync_pause))
                    }
                } else {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { start() }, enabled = !state.running,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp), shape = Radius.row) {
                            Icon(Lucide.CircleArrowDown, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(if (paused) R.string.sync_resume else R.string.sync_now))
                        }
                        if (!paused) OutlinedButton(
                            onClick = { container.sync.pause(); SyncScheduler.schedule(context) },
                            modifier = Modifier.size(48.dp), shape = Radius.row,
                            contentPadding = PaddingValues(0.dp),
                        ) {
                            Icon(Lucide.Pause, stringResource(R.string.sync_pause), modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
            error?.let { Text(it, color = palette.destructive, style = Type.small) }
        }
        Column {
            TextButton(onClick = { networkHelp = !networkHelp }, contentPadding = PaddingValues(0.dp)) {
                Icon(Lucide.Info, null, modifier = Modifier.size(16.dp), tint = palette.muted)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.sync_network_details), style = Type.tiny, color = palette.muted)
                Spacer(Modifier.width(8.dp))
                Icon(Lucide.ChevronDown, null, tint = palette.muted,
                    modifier = Modifier.size(16.dp).rotate(if (networkHelp) 180f else 0f))
            }
            AnimatedVisibility(networkHelp) {
                Text(stringResource(R.string.sync_network_hint), style = Type.tiny, color = palette.muted,
                    modifier = Modifier.padding(bottom = 12.dp))
            }
        }
        Text(stringResource(R.string.sync_files_hint), style = Type.tiny, color = palette.muted)
    }
}
