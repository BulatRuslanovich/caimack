// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import app.caimack.R

@Composable
internal fun LocalHttpSetting() {
    val container = LocalContainer.current
    val enabled by container.connectionPreferences.allowLocalHttp.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var granted by remember { mutableStateOf(localNetworkGranted(context)) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { granted = localNetworkGranted(context) }
    val request = rememberLocalNetworkPermission()
    val change: (Boolean) -> Unit = { value ->
        if (value) request { granted = true; container.setAllowLocalHttp(true) }
        else container.setAllowLocalHttp(false)
    }
    Column {
        Row(Modifier.fillMaxWidth().clickable { change(!enabled) }, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Text(stringResource(R.string.settings_local_http), style = Type.small)
                Text(stringResource(R.string.settings_local_http_hint), style = Type.tiny, color = LocalPalette.current.muted)
            }
            Toggle(enabled, onCheckedChange = change)
        }
        if (enabled && !granted) {
            TextButton(onClick = { request { granted = true; container.refreshLibraryConnection(); container.refreshDownloadMetadata() } }) {
                Text(stringResource(R.string.settings_local_network_permission))
            }
        }
    }
}
