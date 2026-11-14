// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.session.SessionState
import app.caimack.ui.LocalContainer
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
    val session by container.session.state.collectAsStateWithLifecycle()
    val user = (session as? SessionState.SignedIn)?.user
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
                            Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                        )
                        val startAfterSelection = enableAfterPicker || state.enabled
                        withContext(Dispatchers.IO) {
                            container.syncStore.configure(uri, user)
                            if (startAfterSelection) container.syncStore.enable(true)
                        }
                        val required = buildList {
                            add(android.Manifest.permission.POST_NOTIFICATIONS)
                            if (Build.VERSION.SDK_INT >= 37)
                                add("android.permission.ACCESS_LOCAL_NETWORK")
                        }
                        if (startAfterSelection) permissions.launch(required.toTypedArray())
                    }
                        .onFailure { error = it.message }
                }
        }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        Text(stringResource(R.string.sync_title), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.sync_description), style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.sync_enable), Modifier.weight(1f))
            Switch(
                checked = state.enabled,
                onCheckedChange = { value ->
                    if (
                        value &&
                            (state.folder == null ||
                                container.syncStore.boundUser != user?.id ||
                                container.syncStore.boundAddress !=
                                    container.server.url.value?.toString())
                    ) {
                        enableAfterPicker = true
                        picker.launch(null)
                    } else {
                        if (!value) container.sync.pause()
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    container.syncStore.enable(value)
                                }
                            }
                                .onSuccess {
                                    if (value) start() else SyncScheduler.schedule(context)
                                }
                                .onFailure { error = it.message }
                        }
                    }
                },
            )
        }
        state.folder?.let {
            Text(Uri.decode(it.substringAfterLast('/')), style = MaterialTheme.typography.bodySmall)
        }
        OutlinedButton(
            onClick = {
                enableAfterPicker = false
                picker.launch(state.folder?.let(Uri::parse))
            },
            enabled = !state.running,
        ) {
            Text(stringResource(R.string.sync_choose_folder))
        }
        if (state.enabled) {
            Text(stringResource(R.string.sync_progress, state.completed, state.total))
            if (state.running)
                LinearProgressIndicator(
                    progress = {
                        if (state.totalBytes > 0) state.bytes.toFloat() / state.totalBytes else 0f
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            state.message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            if (state.lastSync > 0)
                Text(
                    stringResource(
                        R.string.sync_last,
                        java.text.DateFormat.getDateTimeInstance()
                            .format(java.util.Date(state.lastSync)),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                )
            Text(
                stringResource(R.string.sync_pending, state.pending),
                style = MaterialTheme.typography.bodySmall,
            )
            if (state.rejected > 0)
                Text(
                    stringResource(R.string.sync_rejected, state.rejected) +
                        "\n" +
                        container.syncStore.rejectionMessages(),
                    color = MaterialTheme.colorScheme.error,
                )
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { start() }, enabled = !state.running) {
                    Text(stringResource(R.string.sync_now))
                }
                OutlinedButton(
                    onClick = {
                        container.sync.pause()
                        SyncScheduler.schedule(context)
                    }
                ) {
                    Text(stringResource(R.string.sync_pause))
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Text(stringResource(R.string.sync_files_hint), style = MaterialTheme.typography.bodySmall)
    }
}
