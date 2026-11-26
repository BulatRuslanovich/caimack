// SPDX-License-Identifier: AGPL-3.0-only

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
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.api.ConnectCommand
import app.caimack.playback.SleepTimer
import app.caimack.playback.SleepTimerState
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SleepSheet(audiobook: Boolean = false, onDismiss: () -> Unit) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val timer = if (audiobook) container.audiobookPlayback.sleepTimer else container.sleepTimer
    val state = if (audiobook) timer.state.collectAsStateWithLifecycle().value else displayedSleepTimer()
    val title = sleepTimerLabel(state, audiobook)
    fun choose(minutes: Int? = null, atEnd: Boolean = false) {
        if (audiobook || !container.connect.route(ConnectCommand.SetSleepTimer(minutes, atEnd))) {
            when {
                atEnd -> timer.untilTrackEnd()
                minutes != null -> timer.set(minutes)
                else -> timer.cancel()
            }
        }
        onDismiss()
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
                    choose(minutes)
                }
            }
            SheetRow(
                stringResource(if (audiobook) R.string.sleep_chapter_end else R.string.sleep_track_end),
                if (state is SleepTimerState.TrackEnd) Lucide.Check else Lucide.Moon,
            ) {
                choose(atEnd = true)
            }

            if (state != null) {
                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)
                SheetRow(stringResource(R.string.sleep_off), Lucide.X) {
                    choose()
                }
            }
        }
    }
}

@Composable
internal fun sleepTimerLabel(state: SleepTimerState?, audiobook: Boolean): String {
    val remaining = rememberSleepRemaining(state).value
    return when {
        remaining != null -> stringResource(R.string.sleep_remaining, durationOf(((remaining + 999) / 1000).toInt()))
        state is SleepTimerState.TrackEnd -> stringResource(if (audiobook) R.string.sleep_at_chapter_end else R.string.sleep_at_track_end)
        else -> stringResource(R.string.sleep_title)
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
