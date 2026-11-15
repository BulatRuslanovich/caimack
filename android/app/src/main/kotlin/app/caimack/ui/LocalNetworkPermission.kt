// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import app.caimack.session.LocalHttpPolicy
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

private const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

internal fun localNetworkGranted(context: Context): Boolean =
    Build.VERSION.SDK_INT < 37 || ContextCompat.checkSelfPermission(context, LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED

internal fun localServerAddress(address: String): Boolean {
    val text = address.trim().let { if ("://" in it) it else "https://$it" }
    val host = text.toHttpUrlOrNull()?.host ?: return false
    return LocalHttpPolicy.isLocalHost(host) || host.endsWith(".local")
}

/** Run the user action only after Android has allowed LAN access. */
@Composable
internal fun rememberLocalNetworkPermission(onDenied: () -> Unit = {}): (() -> Unit) -> Unit {
    val context = LocalContext.current
    val denied by rememberUpdatedState(onDenied)
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val action = pending
        pending = null
        if (granted) action?.invoke() else denied()
    }
    return { action ->
        if (localNetworkGranted(context)) action()
        else if (pending == null) {
            pending = action
            launcher.launch(LOCAL_NETWORK)
        }
    }
}
