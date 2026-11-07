// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
internal fun OptionSelector(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    modifier: Modifier = Modifier,
    onChange: (String) -> Unit,
) {
    val palette = LocalPalette.current
    var expanded by remember { mutableStateOf(false) }
    val selected = options.firstOrNull { it.first == value }?.second ?: value
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(Radius.row)
                .background(palette.card).border(1.dp, palette.borderStrong, Radius.row)
                .semantics { stateDescription = selected }
                .clickable(role = Role.Button, onClickLabel = label) { expanded = true }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(selected, style = Type.small, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Icon(Lucide.ChevronDown, label, tint = palette.muted, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }, modifier = Modifier.heightIn(max = 360.dp).background(palette.popover)) {
            options.forEach { (key, text) ->
                DropdownMenuItem(
                    text = { Text(text, color = if (key == value) palette.primary else palette.foreground) },
                    onClick = { expanded = false; onChange(key) },
                    trailingIcon = { if (key == value) Icon(Lucide.Check, null, tint = palette.primary) },
                )
            }
        }
    }
}
