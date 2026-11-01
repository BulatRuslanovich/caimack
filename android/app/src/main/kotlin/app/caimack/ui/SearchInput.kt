// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import app.caimack.R
import androidx.compose.ui.unit.dp

@Composable
internal fun SearchInput(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    onSearch: () -> Unit = {},
) {
    val palette = LocalPalette.current
    val focus = LocalFocusManager.current
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clip(Radius.row)
            .background(palette.raised).border(1.dp, palette.controlBorder, Radius.row)
            .padding(start = 14.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Lucide.Search, null, tint = palette.muted, modifier = Modifier.size(16.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = Type.body.copy(color = palette.foreground),
            cursorBrush = SolidColor(palette.foreground),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { onSearch(); focus.clearFocus() }),
            modifier = Modifier.weight(1f).padding(vertical = 12.dp).semantics { contentDescription = label },
            decorationBox = { field ->
                Box {
                    if (value.isEmpty()) Text(label, style = Type.body, color = palette.faint)
                    field()
                }
            },
        )
        if (value.isNotEmpty()) IconButton(onClick = { onValueChange("") }) {
            Icon(Lucide.X, stringResource(R.string.search_clear), tint = palette.muted)
        }
    }
}
