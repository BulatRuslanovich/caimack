// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.os.Build
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalView
import app.caimack.haptics.PlayerHaptic
import app.caimack.haptics.TactileFeedback

@Composable
internal fun rememberPlayerHaptics(): (PlayerHaptic) -> Unit {
    val enabled by LocalContainer.current.haptics.touchEnabled.collectAsState()
    val currentEnabled by rememberUpdatedState(enabled)
    val view = LocalView.current
    val feedback = remember(view) {
        TactileFeedback({ currentEnabled }, SystemClock::uptimeMillis) { event ->
            val type = when (event) {
                PlayerHaptic.Button -> HapticFeedbackConstants.CONTEXT_CLICK
                PlayerHaptic.Skip, PlayerHaptic.Favorite, PlayerHaptic.Confirm -> HapticFeedbackConstants.CONFIRM
                PlayerHaptic.Boundary -> HapticFeedbackConstants.REJECT
                PlayerHaptic.Tick -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_FREQUENT_TICK else HapticFeedbackConstants.CLOCK_TICK
                PlayerHaptic.SwipeArmed -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE else HapticFeedbackConstants.GESTURE_START
                PlayerHaptic.SwipeCancelled -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.GESTURE_THRESHOLD_DEACTIVATE else HapticFeedbackConstants.GESTURE_END
            }
            // Native feedback observes the system and view haptic preferences.
            view.performHapticFeedback(type)
        }
    }
    return remember(feedback) { feedback::perform }
}
