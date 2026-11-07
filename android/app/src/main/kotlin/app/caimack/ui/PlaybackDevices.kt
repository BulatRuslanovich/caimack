// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.os.SystemClock
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.api.ConnectCommand
import app.caimack.playback.RadioNote
import app.caimack.playback.RadioState
import app.caimack.playback.SleepTimerState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaybackDevicesButton(modifier: Modifier = Modifier, compact: Boolean = false) {
    val container = LocalContainer.current
    val context = LocalContext.current
    val palette = LocalPalette.current
    val state by container.connect.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }
    val title = stringResource(R.string.connect_title)
    val label = if (state.selectedId == null) stringResource(R.string.connect_this_device)
        else stringResource(if (state.available) R.string.connect_playing_on else R.string.connect_unavailable,
            state.selectedName ?: stringResource(R.string.connect_title))
    val choose: (String?) -> Unit = { id ->
        if (!choosing) scope.launch {
            choosing = true
            try { container.connect.select(id); open = false }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { Toast.makeText(context, R.string.connect_failed, Toast.LENGTH_LONG).show() }
            finally { choosing = false }
        }
    }
    Row(modifier.heightIn(min = 48.dp).clickable { open = true }.padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(Lucide.MonitorSpeaker, title, tint = if (state.selectedId != null) palette.primary else palette.muted, modifier = Modifier.size(18.dp))
        if (!compact) Text(label, style = Type.tiny, color = if (state.selectedId != null) palette.primary else palette.muted,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (open) ModalBottomSheet(onDismissRequest = { open = false }, containerColor = palette.card) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = Type.heading)
            Text(stringResource(R.string.connect_description), style = Type.small, color = palette.muted)
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)
            SheetRow(stringResource(R.string.connect_this_device), if (state.selectedId == null) Lucide.Check else Lucide.MonitorSpeaker) { choose(null) }
            state.devices.filter { it.id != container.deviceId }.forEach { device ->
                SheetRow(device.name, if (device.id == state.selectedId) Lucide.Check else Lucide.MonitorSpeaker) { choose(device.id) }
            }
            if (choosing || state.pending) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (!state.connected) Text(stringResource(R.string.connect_reconnecting), style = Type.small, color = palette.muted)
            Text(stringResource(R.string.connect_find_devices), style = Type.tiny, color = palette.muted,
                modifier = Modifier.padding(top = 8.dp, bottom = 12.dp))
        }
    }
}

@Composable
internal fun displayedRadio(): RadioState {
    val container = LocalContainer.current
    val connect by container.connect.state.collectAsStateWithLifecycle()
    val local by container.radio.state.collectAsStateWithLifecycle()
    if (connect.selectedId == null) return local
    val radio = connect.playback?.radio ?: return RadioState()
    return RadioState(seedTrackId = radio.seedTrackId, notes = radio.reasons.mapValues { RadioNote(it.value, false) }, active = true, focus = radio.focus)
}

@Composable
internal fun displayedSleepTimer(): SleepTimerState? {
    val container = LocalContainer.current
    val connect by container.connect.state.collectAsStateWithLifecycle()
    val local by container.sleepTimer.state.collectAsStateWithLifecycle()
    if (connect.selectedId == null) return local
    val timer = connect.playback?.sleepTimer
    return remember(timer) {
        when (timer?.kind) {
            "trackEnd" -> SleepTimerState.TrackEnd
            "minutes" -> SleepTimerState.Minutes(timer.minutes, SystemClock.elapsedRealtime() + (timer.endsAt - System.currentTimeMillis()).coerceAtLeast(0))
            else -> null
        }
    }
}
