// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.RadioRequest
import app.caimack.session.SessionState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class RadioTile : TileService() {
    private val container get() = (application as CaimackApp).container
    private var watching: Job? = null

    override fun onStartListening() {
        container.player.connect()
        watching = container.scope.launch(Dispatchers.Main) {
            container.player.state.collect { render(it) }
        }
    }

    override fun onStopListening() {
        watching?.cancel()
        watching = null
    }

    override fun onClick() {
        if (container.player.state.value.playing) {
            container.player.pause()
            return
        }

        container.scope.launch {
            val session = container.session.state.first { it !is SessionState.Restoring }
            if (session !is SessionState.SignedIn) return@launch withContext(Dispatchers.Main) { openApp() }

            withContext(Dispatchers.Main) { note(R.string.radio_tile_starting) }
            val batch = runCatching { container.radio(RadioRequest(null, emptyList())) }.getOrNull()
            withContext(Dispatchers.Main) {
                if (batch == null || batch.tracks.isEmpty()) note(R.string.radio_tile_failed)
                else container.player.playMyRadio(batch)
            }
        }
    }

    private fun render(state: PlayerState) {
        val tile = qsTile ?: return
        tile.state = if (state.playing) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = getString(R.string.radio_mine)
        tile.subtitle = state.current?.title?.takeIf { state.playing }
        tile.updateTile()
    }

    private fun note(text: Int) {
        val tile = qsTile ?: return
        tile.subtitle = getString(text)
        tile.updateTile()
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openApp() {
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    companion object {
        fun requestAdd(context: Context, onResult: (Boolean) -> Unit) {
            context.getSystemService(StatusBarManager::class.java).requestAddTileService(
                ComponentName(context, RadioTile::class.java),
                context.getString(R.string.radio_mine),
                Icon.createWithResource(context, R.drawable.ic_tile_radio),
                context.mainExecutor,
            ) { result ->
                onResult(
                    result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ||
                        result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED,
                )
            }
        }
    }
}
