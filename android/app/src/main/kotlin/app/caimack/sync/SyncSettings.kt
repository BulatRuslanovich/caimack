// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

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
    val session by container.session.state.collectAsStateWithLifecycle()
    val address by container.server.url.collectAsStateWithLifecycle()
    val catalogRevision by container.syncStore.catalogRevision.collectAsStateWithLifecycle()
    val user = (session as? SessionState.SignedIn)?.user
    val active = remember(user, address, state.enabled, catalogRevision) { container.syncStore.active }
    fun start() {
        if (container.syncStore.active) SyncScheduler.start(context)
    }
    val permissions =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            start()
        }
    fun requestPermissionsAndStart() {
        val required = buildList {
            add(android.Manifest.permission.POST_NOTIFICATIONS)
            if (Build.VERSION.SDK_INT >= 37) add("android.permission.ACCESS_LOCAL_NETWORK")
        }
        permissions.launch(required.toTypedArray())
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        Text(stringResource(R.string.sync_title), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.sync_description), style = MaterialTheme.typography.bodyMedium)
        Text(stringResource(R.string.sync_network_hint), style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.sync_enable), Modifier.weight(1f))
            Switch(
                checked = active,
                enabled = user != null,
                onCheckedChange = { value ->
                    error = null
                    if (!value) container.sync.pause()
                    scope.launch {
                        runCatching {
                            withContext(Dispatchers.IO) {
                                if (value) container.syncStore.configure(requireNotNull(user))
                                container.syncStore.enable(value)
                            }
                        }.onSuccess {
                            if (value) requestPermissionsAndStart() else SyncScheduler.schedule(context)
                        }.onFailure { error = it.message }
                    }
                },
            )
        }
        if (active) {
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
                Button(onClick = { requestPermissionsAndStart() }, enabled = !state.running) {
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
