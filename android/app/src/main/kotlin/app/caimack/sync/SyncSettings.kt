// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.sync

import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.session.SessionState
import app.caimack.ui.LocalContainer
import app.caimack.ui.Toggle
import app.caimack.ui.Type
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SyncSettings() {
    val container = LocalContainer.current
    val context = LocalContext.current
    val state by container.syncStore.status.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var updating by remember { mutableStateOf(false) }
    val session by container.session.state.collectAsStateWithLifecycle()
    val address by container.server.url.collectAsStateWithLifecycle()
    val catalogRevision by container.syncStore.catalogRevision.collectAsStateWithLifecycle()
    val user = (session as? SessionState.SignedIn)?.user
    val active = remember(user, address, state.enabled, catalogRevision) { container.syncStore.active }
    val permissions =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            if (container.syncStore.active) SyncScheduler.start(context)
        }
    fun requestPermissionsAndStart() {
        val required = buildList {
            add(android.Manifest.permission.POST_NOTIFICATIONS)
            if (Build.VERSION.SDK_INT >= 37) add("android.permission.ACCESS_LOCAL_NETWORK")
        }
        permissions.launch(required.toTypedArray())
    }
    val label = stringResource(R.string.sync_enable)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f).padding(end = 12.dp), style = Type.body.copy(fontWeight = FontWeight.SemiBold))
        Toggle(
            checked = active,
            enabled = user != null && !updating,
            modifier = Modifier.semantics { contentDescription = label },
            onCheckedChange = { value ->
                val account = user ?: return@Toggle
                updating = true
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) {
                            if (value) container.syncStore.configure(account) else container.sync.pause()
                            container.syncStore.enable(value)
                        }
                        if (value) requestPermissionsAndStart() else SyncScheduler.schedule(context)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Exception) {
                        error.localizedMessage?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show() }
                    } finally {
                        updating = false
                    }
                }
            },
        )
    }
}
