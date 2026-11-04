// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.service.dreams.DreamService
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import app.caimack.CaimackApp
import app.caimack.api.Lyrics
import kotlinx.coroutines.delay
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlin.random.Random

private const val DRIFT_EVERY_MS = 60_000L
private const val DRIFT_DP = 18

class RecordDream : DreamService(), LifecycleOwner, SavedStateRegistryOwner {
    private val registry = LifecycleRegistry(this)
    private val saved = SavedStateRegistryController.create(this)

    override val lifecycle: Lifecycle get() = registry
    override val savedStateRegistry: SavedStateRegistry get() = saved.savedStateRegistry

    override fun onCreate() {
        super.onCreate()
        saved.performRestore(null)
        registry.currentState = Lifecycle.State.CREATED
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true

        val container = (application as CaimackApp).container
        container.player.connect()

        setContentView(
            ComposeView(this).apply {
                setViewTreeLifecycleOwner(this@RecordDream)
                setViewTreeSavedStateRegistryOwner(this@RecordDream)
                setContent {
                    val colorway by container.appearance.colorway.collectAsState()
                    CaimackTheme(dark = true, colorway = colorway) {
                        CompositionLocalProvider(LocalContainer provides container, LocalContentColor provides paletteOf(colorway, dark = true).foreground) {
                            DreamScreen()
                        }
                    }
                }
            },
        )
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        moveTo(Lifecycle.State.RESUMED)
    }

    override fun onDreamingStopped() {
        moveTo(Lifecycle.State.CREATED)
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        moveTo(Lifecycle.State.DESTROYED)
        super.onDetachedFromWindow()
    }

    private fun moveTo(state: Lifecycle.State) {
        if (registry.currentState != Lifecycle.State.DESTROYED) registry.currentState = state
    }
}

@Composable
private fun DreamScreen() {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val state by container.player.state.collectAsState()
    val track = state.current

    var drift by remember { mutableStateOf(IntOffset.Zero) }
    var clock by remember { mutableStateOf(now()) }
    var position by remember { mutableLongStateOf(0L) }

    LaunchedEffect(Unit) {
        val random = Random(System.nanoTime())
        var tick = 0L
        while (true) {
            delay(500)
            tick += 500
            position = container.player.position
            clock = now()
            if (tick % DRIFT_EVERY_MS == 0L) drift = IntOffset(random.nextInt(-DRIFT_DP, DRIFT_DP), random.nextInt(-DRIFT_DP, DRIFT_DP))
        }
    }

    val lyrics by produceState<Lyrics?>(null, track?.id) {
        value = track?.let { runCatching { container.api.lyrics(it.id).body() }.getOrNull() }
    }
    val line = lyrics?.lines?.lastOrNull { it.at <= position }?.text?.trim()?.ifEmpty { null }

    Box(Modifier.fillMaxSize().background(palette.background)) {
        track?.let { ArtBackdrop(trackCover(it), BackdropMode.Stage, Modifier.fillMaxSize(), grainStrength = 0.6f) }

        BoxWithConstraints(Modifier.fillMaxSize().offset(drift.x.dp, drift.y.dp).padding(32.dp)) {
            val wide = maxWidth > maxHeight
            val disc = (if (wide) maxHeight * 0.5f else maxWidth * 0.62f)

            Column(
                Modifier.align(Alignment.Center).fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(28.dp),
            ) {
                Text(clock, style = Type.display.copy(fontSize = 44.sp), color = palette.foreground.copy(alpha = 0.85f))

                if (track == null) {
                    BrandMark(palette.foreground, palette.primary, Modifier.size(disc * 0.4f))
                    return@Column
                }

                Box(Modifier.offset(x = -disc * 0.15f)) {
                    Record(track, spinning = state.playing && !state.buffering, out = true, modifier = Modifier.size(disc))
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(track.title, style = displayStyle(track.title), textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(artistsOf(track), style = Type.body, color = palette.muted, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }

                AnimatedContent(line, transitionSpec = { fadeIn(tween(600)) togetherWith fadeOut(tween(400)) }, label = "dream-line") { shown ->
                    Text(
                        shown?.let { "“$it”" } ?: "",
                        style = Type.title,
                        color = palette.primary,
                        textAlign = TextAlign.Center,
                        maxLines = 3,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

private fun now(): String = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))
