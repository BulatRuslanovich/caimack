// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.platform.LocalContext

@Composable
internal fun systemMotionEnabled(): Boolean {
    val resolver = LocalContext.current.contentResolver
    fun enabled() = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
    val enabled by produceState(enabled(), resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { value = enabled() }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        value = enabled()
        awaitDispose { resolver.unregisterContentObserver(observer) }
    }
    return enabled
}

@Composable
internal fun playerMotionEnabled(): Boolean {
    val effects by LocalContainer.current.appearance.playerEffects.collectAsState()
    return effects && systemMotionEnabled()
}
