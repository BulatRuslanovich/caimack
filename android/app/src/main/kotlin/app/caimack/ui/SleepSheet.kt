// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.caimack.R
import app.caimack.playback.SleepTimer
import app.caimack.playback.SleepTimerState
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SleepSheet(onDismiss: () -> Unit) {
    val palette = LocalPalette.current
    val timer = LocalContainer.current.sleepTimer
    val state by timer.state.collectAsState()
    val remaining by rememberSleepRemaining(state)

    val title = when {
        remaining != null -> stringResource(R.string.sleep_remaining, durationOf(((remaining!! + 999) / 1000).toInt()))
        state is SleepTimerState.TrackEnd -> stringResource(R.string.sleep_at_track_end)
        else -> stringResource(R.string.sleep_title)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.card) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text(
                title,
                style = Type.small.copy(fontWeight = FontWeight.Medium),
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            )
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)

            SleepTimer.MINUTES.forEach { minutes ->
                val chosen = (state as? SleepTimerState.Minutes)?.minutes == minutes
                SheetRow(stringResource(R.string.sleep_minutes, minutes), if (chosen) Lucide.Check else Lucide.Moon) {
                    timer.set(minutes)
                    onDismiss()
                }
            }
            SheetRow(
                stringResource(R.string.sleep_track_end),
                if (state is SleepTimerState.TrackEnd) Lucide.Check else Lucide.Moon,
            ) {
                timer.untilTrackEnd()
                onDismiss()
            }

            if (state != null) {
                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)
                SheetRow(stringResource(R.string.sleep_off), Lucide.X) {
                    timer.cancel()
                    onDismiss()
                }
            }
        }
    }
}

@Composable
fun rememberSleepRemaining(state: SleepTimerState?): State<Long?> = produceState<Long?>(null, state) {
    val minutes = state as? SleepTimerState.Minutes
    while (minutes != null && minutes.remainingMs > 0) {
        value = minutes.remainingMs
        delay(1_000)
    }
    value = null
}
