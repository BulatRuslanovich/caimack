// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack

import app.caimack.playback.Background
import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioManager
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.session.SessionState
import app.caimack.ui.App
import app.caimack.ui.Appearance
import app.caimack.ui.CaimackTheme
import app.caimack.ui.LocalContainer
import app.caimack.ui.LoginScreen

class MainActivity : ComponentActivity() {
    private val localNetworkPermission = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }

    override fun onResume() {
        super.onResume()
        (application as CaimackApp).container.updates.check()
        (application as CaimackApp).container.refreshDownloadArtwork()
        (application as CaimackApp).container.refreshLibraryConnection()
    }

    override fun attachBaseContext(newBase: Context) = super.attachBaseContext(Appearance.localized(newBase))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        volumeControlStream = AudioManager.STREAM_MUSIC
        enableEdgeToEdge()
        if(android.os.Build.VERSION.SDK_INT>=37 && androidx.core.content.ContextCompat.checkSelfPermission(this,"android.permission.ACCESS_LOCAL_NETWORK") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            localNetworkPermission.launch("android.permission.ACCESS_LOCAL_NETWORK")
        }

        val container = (application as CaimackApp).container
        if (savedInstanceState == null) {
            playFromSearch(intent)
            openFromNotification(intent)
        }

        setContent {
            val state by container.session.state.collectAsStateWithLifecycle()
            val address by container.server.url.collectAsStateWithLifecycle()
            val theme by container.appearance.theme.collectAsStateWithLifecycle()
            val dark = theme == Appearance.DARK || (theme == Appearance.SYSTEM && isSystemInDarkTheme())
            val colorway by container.appearance.colorway.collectAsStateWithLifecycle()

            DisposableEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(bars, bars)
                onDispose {}
            }

            CaimackTheme(dark = dark, colorway = colorway) {
                CompositionLocalProvider(LocalContainer provides container) {
                    Surface(Modifier.fillMaxSize()) {
                        when (val current = state) {
                            SessionState.Restoring -> Unit
                            is SessionState.SignedOut -> LoginScreen(
                                session = container.session,
                                lastAddress = address?.toString()?.trimEnd('/').orEmpty(),
                                expired = current.expired,
                            )
                            is SessionState.SignedIn -> App(current.user)
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        playFromSearch(intent)
        openFromNotification(intent)
    }

    private fun openFromNotification(intent: Intent) {
        if (intent.getStringExtra(Background.EXTRA_OPEN) == Background.OPEN_RECAP) {
            (application as CaimackApp).container.openRecap.value = true
        }
    }

    private fun playFromSearch(intent: Intent) {
        if (intent.action != MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH) return
        (application as CaimackApp).container.player.playFromSearch(intent.getStringExtra(SearchManager.QUERY).orEmpty())
    }
}
