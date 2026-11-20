// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.caimack.BuildConfig
import app.caimack.R

@Composable
internal fun QuickSettingsTile(added: Boolean, onAdd: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.settings_tile), style = Type.body, modifier = Modifier.weight(1f))
        OutlinedButton(onClick = onAdd, enabled = !added, modifier = Modifier.heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp)) {
            if (added) { Icon(Lucide.Check, null, Modifier.size(16.dp)); Spacer(Modifier.width(8.dp)) }
            Text(stringResource(if (added) R.string.settings_tile_added else R.string.settings_tile_add))
        }
    }
}

@Composable
internal fun SettingsAbout() {
    val palette = LocalPalette.current
    Text(
        "v${BuildConfig.VERSION_NAME}",
        style = Type.tiny.copy(fontFeatureSettings = "tnum"),
        color = palette.faint,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
    )
}
