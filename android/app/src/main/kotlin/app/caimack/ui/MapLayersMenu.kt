// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import app.caimack.R

internal enum class MapLayer(val key: String, @param:StringRes val label: Int) {
    Links("links", R.string.map_layer_links),
}

@Composable
internal fun MapLayersMenu(hidden: Set<String>, modifier: Modifier = Modifier, onToggle: (MapLayer) -> Unit) {
    val palette = LocalPalette.current
    var expanded by remember { mutableStateOf(false) }
    val label = stringResource(R.string.map_layers_count, MapLayer.entries.count { it.key !in hidden })
    val state = stringResource(if (expanded) R.string.map_layers_expanded else R.string.map_layers_collapsed)

    Box(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clip(CircleShape)
                .background(if (expanded) palette.raised else androidx.compose.ui.graphics.Color.Transparent)
                .border(1.dp, palette.cabinetEdge, CircleShape)
                .clickable(role = Role.Button) { expanded = !expanded }
                .semantics { stateDescription = state }
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Lucide.Layers, null, tint = palette.muted, modifier = Modifier.size(16.dp))
            Text(label, style = Type.small, color = palette.foreground, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Icon(if (expanded) Lucide.ChevronUp else Lucide.ChevronDown, null, tint = palette.muted, modifier = Modifier.size(14.dp))
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.width(256.dp),
            shape = Radius.panel,
            containerColor = palette.popover,
        ) {
            Text(
                stringResource(R.string.map_layers),
                style = Type.tiny,
                color = palette.muted,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() },
            )
            MapLayer.entries.forEach { layer ->
                val checked = layer.key !in hidden
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .toggleable(value = checked, role = Role.Switch, onValueChange = { onToggle(layer) })
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(stringResource(layer.label), style = Type.small, color = palette.foreground, modifier = Modifier.weight(1f))
                    Switch(
                        checked = checked,
                        onCheckedChange = null,
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = palette.primary,
                            checkedThumbColor = palette.onPrimary,
                            uncheckedTrackColor = palette.raised,
                            uncheckedBorderColor = palette.controlBorder,
                            uncheckedThumbColor = palette.muted,
                        ),
                    )
                }
            }
        }
    }
}
