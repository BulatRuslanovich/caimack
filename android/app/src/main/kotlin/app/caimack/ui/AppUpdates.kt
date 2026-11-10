// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.net.toUri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.BuildConfig
import app.caimack.R
import app.caimack.updates.AppRelease
import app.caimack.updates.UpdateState

@Composable
internal fun UpdateBanner(state: UpdateState, onDetails: () -> Unit, onDismiss: () -> Unit) {
    val release = state.release ?: return
    if (!state.showBanner) return
    val palette = LocalPalette.current
    Column(Modifier.background(palette.primarySoft)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.update_available, release.version),
                style = Type.small.copy(fontWeight = FontWeight.Medium), color = palette.foreground,
                modifier = Modifier.weight(1f).padding(vertical = 12.dp),
            )
            TextButton(onClick = onDetails) { Text(stringResource(R.string.update_details), color = palette.primary) }
            IconButton(onClick = onDismiss) {
                Icon(Lucide.X, stringResource(R.string.update_later), tint = palette.muted)
            }
        }
        HorizontalDivider(color = palette.border)
    }
}

@Composable
internal fun UpdatesSettings() {
    val updates = LocalContainer.current.updates
    val state by updates.state.collectAsStateWithLifecycle()
    var details by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(updates) { updates.check() }
    UpdatesPanel(state, onCheck = { updates.check(force = true) }, onDetails = { details = true })
    if (details) state.release?.let { UpdateDetails(it) { details = false } }
}

@Composable
internal fun UpdatesPanel(state: UpdateState, onCheck: () -> Unit, onDetails: () -> Unit) {
    val palette = LocalPalette.current
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.settings_updates), style = Type.heading, color = palette.foreground)
        Text(stringResource(R.string.update_installed, BuildConfig.VERSION_NAME), style = Type.small, color = palette.muted)
        Text(
            when {
                !state.enabled -> stringResource(R.string.update_disabled)
                state.release != null -> stringResource(R.string.update_available, state.release.version)
                state.checking -> stringResource(R.string.update_checking)
                state.failed -> stringResource(R.string.update_failed)
                state.checked && !state.published -> stringResource(R.string.update_no_releases)
                state.checked -> stringResource(R.string.update_current)
                else -> stringResource(R.string.settings_updates_intro)
            }, style = Type.body, color = palette.foreground,
        )
        if (state.release != null) {
            TextButton(onClick = onDetails) {
                Text(stringResource(R.string.update_whats_new), color = palette.primary)
            }
            if (state.failed) Text(stringResource(R.string.update_failed), style = Type.small, color = palette.muted)
        }
        if (state.enabled) TextButton(onClick = onCheck, enabled = !state.checking) {
            Text(stringResource(if (state.checking) R.string.update_checking else R.string.update_check),
                color = if (state.checking) palette.muted else palette.primary)
        }
    }
}

@Composable
internal fun UpdateDetails(release: AppRelease, onDismiss: () -> Unit) {
    val palette = LocalPalette.current
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = palette.card,
        titleContentColor = palette.foreground,
        textContentColor = palette.foreground,
        title = { Text("Caimack ${release.version}", style = Type.heading) },
        text = {
            Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                SelectionContainer {
                    Text(release.notes.ifBlank { stringResource(R.string.update_notes_empty) }, style = Type.body)
                }
                Text(stringResource(R.string.update_download_hint), style = Type.small, color = palette.muted)
            }
        },
        confirmButton = {
            TextButton(onClick = { openUpdateLink(context, release.apkUrl) }) {
                Text(stringResource(R.string.update_download), color = palette.primary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.update_later), color = palette.muted) }
        },
    )
}

private fun openUpdateLink(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, R.string.update_browser_missing, Toast.LENGTH_LONG).show()
    }
}
