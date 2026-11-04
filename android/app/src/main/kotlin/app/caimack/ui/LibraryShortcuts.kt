// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.caimack.R

@Composable
internal fun LibraryShortcuts(onFavorites: () -> Unit, onDownloads: () -> Unit) {
    val palette = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        listOf(
            Triple(R.string.nav_favorites, Lucide.Heart, onFavorites),
            Triple(R.string.downloads_title, Lucide.Download, onDownloads),
        ).forEach { (label, icon, open) ->
            Row(
                Modifier.weight(1f).clip(Radius.panel).background(palette.primarySoft)
                    .clickable(role = Role.Button, onClick = open).heightIn(min = 64.dp).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(icon, null, tint = palette.primary, modifier = Modifier.size(22.dp))
                Text(stringResource(label), style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = palette.foreground)
            }
        }
    }
}
