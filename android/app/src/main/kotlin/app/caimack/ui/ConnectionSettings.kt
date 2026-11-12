// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R

@Composable
internal fun LocalHttpSetting() {
    val container = LocalContainer.current
    val enabled by container.connectionPreferences.allowLocalHttp.collectAsStateWithLifecycle()
    Row(Modifier.fillMaxWidth().clickable { container.setAllowLocalHttp(!enabled) }, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(stringResource(R.string.settings_local_http), style = Type.small)
            Text(stringResource(R.string.settings_local_http_hint), style = Type.tiny, color = LocalPalette.current.muted)
        }
        Toggle(enabled) { container.setAllowLocalHttp(it) }
    }
}
