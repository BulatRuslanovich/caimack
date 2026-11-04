// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import app.caimack.R
import app.caimack.api.Playlist
import app.caimack.api.PlaylistChanges
import app.caimack.session.SessionState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

private const val NAME_LIMIT = 100
private const val DESCRIPTION_LIMIT = 500

@Composable
fun currentUserId(): String? {
    val state by LocalContainer.current.session.state.collectAsState()
    return (state as? SessionState.SignedIn)?.user?.id
}

@Composable
fun PlaylistDialog(
    title: String,
    initial: PlaylistChanges? = null,
    onDismiss: () -> Unit,
    onSave: suspend (PlaylistChanges) -> Unit,
) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val context = LocalContext.current
    var name by rememberSaveable { mutableStateOf(initial?.name.orEmpty()) }
    var description by rememberSaveable { mutableStateOf(initial?.description.orEmpty()) }
    var public by rememberSaveable { mutableStateOf(initial?.isPublic ?: false) }
    var saving by remember { mutableStateOf(false) }
    val ready = name.isNotBlank() && !saving

    Dialog(onDismissRequest = { if (!saving) onDismiss() }) {
        Column(
            Modifier.fillMaxWidth().clip(Radius.hero).background(palette.card).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(title, style = Type.title)
            Field(
                stringResource(R.string.playlist_name),
                name,
                { name = it.take(NAME_LIMIT) },
                KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next),
            )
            Field(
                stringResource(R.string.playlist_description),
                description,
                { description = it.take(DESCRIPTION_LIMIT) },
                KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            )
            Row(
                Modifier.fillMaxWidth().clip(Radius.row).clickable { public = !public }.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.playlist_public), style = Type.body, modifier = Modifier.weight(1f))
                Toggle(public) { public = it }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                DialogButton(stringResource(R.string.action_cancel), enabled = !saving, onClick = onDismiss)
                DialogButton(stringResource(R.string.action_save), primary = true, enabled = ready) {
                    saving = true
                    val changes = PlaylistChanges(name.trim(), description.trim().ifEmpty { null }, public)
                    container.scope.launch {
                        runCatching { onSave(changes) }.onFailure {
                            withContext(Dispatchers.Main) {
                                saving = false
                                Toast.makeText(context, R.string.playlist_save_failed, Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ConfirmDialog(title: String, confirm: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val palette = LocalPalette.current
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().clip(Radius.hero).background(palette.card).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(title, style = Type.section)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                DialogButton(stringResource(R.string.action_cancel), onClick = onDismiss)
                DialogButton(confirm, destructive = true, onClick = onConfirm)
            }
        }
    }
}

@Composable
private fun DialogButton(
    label: String,
    primary: Boolean = false,
    destructive: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val palette = LocalPalette.current
    val fill = when {
        destructive -> palette.destructive
        primary -> palette.action
        else -> Color.Transparent
    }
    val ink = when {
        destructive -> palette.background
        primary -> palette.onAction
        else -> palette.foreground
    }
    Box(
        Modifier
            .height(40.dp)
            .clip(CircleShape)
            .background(if (enabled) fill else fill.copy(alpha = fill.alpha * 0.4f))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = if (enabled) ink else ink.copy(alpha = 0.5f))
    }
}

fun coverPart(context: Context, uri: Uri): MultipartBody.Part? {
    val resolver = context.contentResolver
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val type = resolver.getType(uri) ?: "image/jpeg"
    val extension = type.substringAfter('/', "jpg")
    return MultipartBody.Part.createFormData("file", "cover.$extension", bytes.toRequestBody(type.toMediaTypeOrNull()))
}

fun Playlist.changes() = PlaylistChanges(name, description, isPublic)
