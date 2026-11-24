// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.activity.compose.BackHandler
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.progressSemantics
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.systemGestureExclusion
import androidx.compose.material3.Icon
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.media3.common.Player
import app.caimack.R
import app.caimack.api.Lyrics
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import app.caimack.playback.QueueSnapshot
import app.caimack.haptics.PlayerHaptic
import app.caimack.haptics.SeekHaptics
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException

private enum class Panel { None, Lyrics, Queue }
@Composable
fun FullPlayer(state: PlayerState, onClose: () -> Unit) {
    val savedColor = LocalPalette.current.primary
    CaimackTheme(dark = true, palette = PlayerPalette) {
        FullPlayerContent(state, savedColor, onClose)
    }
}

@Composable
private fun FullPlayerContent(state: PlayerState, savedColor: Color, onClose: () -> Unit) {
    val haptic = rememberPlayerHaptics()
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val player = container.player
    val track = state.current ?: return
    val scene = rememberPlayerScene(state)
    var panel by rememberSaveable { mutableStateOf(Panel.None) }
    var actions by remember { mutableStateOf(false) }
    var sleeping by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf(false) }
    var playlistsFor by remember { mutableStateOf<Track?>(null) }
    val sleepTimer = displayedSleepTimer()
    container.favorites.state.collectAsState().value
    val liked = container.favorites.isFavorite(track)
    val note = displayedRadio().notes[track.id]
    val peaks by produceState<List<Int>?>(null, track.id) {
        value = null
        while (true) {
            val response = try {
                container.api.waveform(track.id)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                break
            }
            val waveform = response.body()
            value = waveform?.takeIf { it.version == app.caimack.api.Waveform.VERSION }?.peaks?.takeIf { it.isNotEmpty() }
            if (value != null || (!response.isSuccessful && response.code() != 404)) break
            // Old waveforms are rebuilt in the background after an analysis
            // upgrade. Show the regular seekbar until fresh data is ready.
            delay(15_000)
        }
    }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val undo = stringResource(R.string.action_undo)
    val undoable: (String, QueueSnapshot) -> Unit = { message, snapshot ->
        scope.launch {
            snackbar.currentSnackbarData?.dismiss()
            if (snackbar.showSnackbar(message, undo, duration = SnackbarDuration.Short) == SnackbarResult.ActionPerformed) player.restore(snapshot)
        }
    }

    if (actions) TrackSheet(track, positionMs = player.position) { actions = false }
    playlistsFor?.let { PlaylistMembershipSheet(it) { playlistsFor = null } }
    if (sleeping) SleepSheet { sleeping = false }
    var scrub by remember { mutableStateOf<Long?>(null) }
    val live = rememberPosition(state)
    val position = scrub ?: live
    val duration = state.durationMs.takeIf { it > 0 } ?: (track.durationSeconds * 1000L)

    val stage: @Composable (Modifier) -> Unit = { modifier ->
        Box(modifier) {
            when (panel) {
                Panel.None -> PlayerArtwork(scene, { scrub = it }, Modifier.fillMaxSize())
                Panel.Lyrics -> LyricsPanel(track, position, state.playing)
                Panel.Queue -> QueuePanel(state, undoable)
            }
        }
    }

    val controls: @Composable (Modifier) -> Unit = { modifier ->
        Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.Bottom)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (panel == Panel.None) {
                        Text(track.title, style = displayStyle(track.title))
                    } else {
                        Text(track.title, style = Type.body, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Text(artistsOf(track), style = Type.body, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (panel == Panel.None) note?.let { RadioNoteLine(it) }
                    val delivery by container.playbackDelivery.collectAsStateWithLifecycle()
                    delivery?.takeIf { it.trackId == track.id && panel == Panel.None }?.let { stream ->
                        val label = when {
                            !stream.adaptive -> stringResource(R.string.player_delivery_original)
                            stream.bitrateKbps != null -> stringResource(R.string.player_delivery_aac, stream.bitrateKbps)
                            else -> stringResource(R.string.player_delivery_adaptive)
                        }
                        Text(label, style = Type.tiny, color = palette.muted)
                        val explanation = when (stream.reason) {
                            "waiting" -> R.string.player_delivery_waiting
                            "download" -> R.string.player_delivery_download
                            "network" -> R.string.player_delivery_network
                            else -> null
                        }
                        explanation?.let { Text(stringResource(it), style = Type.tiny, color = palette.muted) }
                    }
                }
                IconAction(
                    if (liked) Lucide.HeartFilled else Lucide.Heart,
                    stringResource(if (liked) R.string.menu_unlike else R.string.menu_like),
                    tint = if (liked) savedColor else palette.muted,
                ) { haptic(PlayerHaptic.Favorite); container.favorites.toggle(track) }
                IconAction(Lucide.Plus, stringResource(R.string.playlist_memberships)) { playlistsFor = track }
            }
            if (panel != Panel.Queue) {
                Seekbar(position, duration, peaks) { player.seekTo(it) }
                Row {
                    Text(clock(position), style = Type.tiny, color = palette.muted)
                    Spacer(Modifier.weight(1f))
                    Text(clock(duration), style = Type.tiny, color = palette.muted)
                }
            }
            PlayerTransport(
                playing = state.playing,
                buffering = state.buffering,
                toggle = player::toggle,
                leading = {
                    PlayerModeButton(Lucide.Shuffle, stringResource(R.string.player_shuffle), state.shuffle,
                        stringResource(if (state.shuffle) R.string.player_shuffle_on else R.string.player_shuffle_off)) {
                        haptic(PlayerHaptic.Button)
                        player.toggleShuffle()
                    }
                },
                previous = {
                    IconAction(Lucide.SkipBack, stringResource(R.string.player_previous), size = 26) {
                        haptic(PlayerHaptic.Skip)
                        player.previous()
                    }
                },
                next = {
                    IconAction(Lucide.SkipForward, stringResource(R.string.player_next), size = 26) {
                        haptic(PlayerHaptic.Skip)
                        player.next()
                    }
                },
                trailing = {
                    PlayerModeButton(
                        if (state.repeat == Player.REPEAT_MODE_ONE) Lucide.Repeat1 else Lucide.Repeat,
                        stringResource(R.string.player_repeat),
                        active = state.repeat != Player.REPEAT_MODE_OFF,
                        mode = stringResource(when (state.repeat) {
                            Player.REPEAT_MODE_ONE -> R.string.player_repeat_one
                            Player.REPEAT_MODE_ALL -> R.string.player_repeat_all
                            else -> R.string.player_repeat_off
                        }),
                    ) {
                        haptic(PlayerHaptic.Button)
                        player.cycleRepeat()
                    }
                },
            )
            Row(Modifier.fillMaxWidth().testTag("full-player-footer"), verticalAlignment = Alignment.CenterVertically) {
                PlaybackDevicesButton(Modifier.weight(1f))
                Box(Modifier.semantics { selected = panel == Panel.Lyrics }) {
                    IconAction(Lucide.MicVocal, stringResource(R.string.lyrics_title), tint = if (panel == Panel.Lyrics) palette.primary else palette.muted) { panel = if (panel == Panel.Lyrics) Panel.None else Panel.Lyrics }
                }
                Box(Modifier.semantics { selected = panel == Panel.Queue }) {
                    IconAction(Lucide.ListVideo, stringResource(R.string.queue_title), tint = if (panel == Panel.Queue) palette.primary else palette.muted) { panel = if (panel == Panel.Queue) Panel.None else Panel.Queue }
                }
            }
        }
    }

    FullPlayerLayout(
        panelOpen = panel != Panel.None,
        onBack = { if (panel != Panel.None) panel = Panel.None else onClose() },
        header = {
            PlayerHeader(stringResource(R.string.player_now_playing), onClose) {
                Box {
                    IconAction(Lucide.EllipsisVertical, stringResource(R.string.menu_more)) { options = true }
                    DropdownMenu(options, onDismissRequest = { options = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.menu_more)) }, onClick = { options = false; actions = true })
                        DropdownMenuItem(text = { Text(stringResource(R.string.sleep_title)) }, leadingIcon = { Icon(Lucide.Moon, null, tint = if (sleepTimer != null) palette.primary else palette.muted) }, onClick = { options = false; sleeping = true })
                    }
                }
            }
        },
        artwork = { modifier, inset -> PlayerArtwork(scene, { scrub = it }, modifier, inset) },
        background = { PlayerSceneBackground(scene, it) },
        stage = stage,
        controls = controls,
        overlay = { modifier ->
            SnackbarHost(snackbar, modifier) { data ->
                Snackbar(data, containerColor = palette.popover, contentColor = palette.foreground, actionColor = palette.primary)
            }
        },
    )
}

@Composable
internal fun PlayerHeader(title: String, onClose: () -> Unit, options: @Composable () -> Unit) {
    val palette = LocalPalette.current
    Row(Modifier.fillMaxWidth().testTag("full-player-header"), verticalAlignment = Alignment.CenterVertically) {
        IconAction(Lucide.ChevronDown, stringResource(R.string.player_close_full), onClick = onClose)
        Text(title, style = Type.small, color = palette.muted, modifier = Modifier.weight(1f).testTag("full-player-context"),
            textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
        options()
    }
}

@Composable
internal fun PlayerTransport(
    playing: Boolean,
    buffering: Boolean,
    toggle: () -> Unit,
    leading: @Composable () -> Unit,
    previous: @Composable () -> Unit,
    next: @Composable () -> Unit,
    trailing: @Composable () -> Unit,
) {
    val palette = LocalPalette.current
    val haptic = rememberPlayerHaptics()
    Row(Modifier.fillMaxWidth().testTag("full-player-transport"), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        leading()
        previous()
        Box(contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(68.dp).clip(CircleShape).background(palette.action).clickable { haptic(PlayerHaptic.Button); toggle() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (playing) Lucide.Pause else Lucide.Play,
                    stringResource(if (playing) R.string.action_pause else R.string.action_play),
                    tint = palette.onAction,
                    modifier = Modifier.size(28.dp),
                )
            }
            // A visual overlay must not enlarge the 68 dp button's layout slot.
            BufferingRing(buffering, Modifier.matchParentSize().requiredSize(78.dp).testTag("full-player-buffering"))
        }
        next()
        trailing()
    }
}

@Composable
internal fun FullPlayerLayout(
    panelOpen: Boolean,
    onBack: () -> Unit,
    header: @Composable () -> Unit,
    artwork: @Composable (Modifier, Dp) -> Unit,
    background: @Composable (Modifier) -> Unit,
    stage: @Composable (Modifier) -> Unit,
    controls: @Composable (Modifier) -> Unit,
    overlay: @Composable (Modifier) -> Unit = {},
) {
    val palette = LocalPalette.current
    BackHandler { onBack() }

    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }

    Surface(Modifier.fillMaxSize(), color = palette.background, contentColor = palette.foreground) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val viewportHeight = maxHeight
            val portrait = maxWidth <= maxHeight
            val safeInsets = WindowInsets.safeDrawing.asPaddingValues()
            val safeTop = safeInsets.calculateTopPadding() + 12.dp
            val artworkTop = safeTop + 48.dp
            // Use the seekbar's bottom-anchored block and two-line metadata as a
            // stable reference, so a longer title never shifts the artwork.
            val baselineTextHeight = with(LocalDensity.current) {
                Type.display.lineHeight.toDp() * 2 + Type.body.lineHeight.toDp() + Type.tiny.lineHeight.toDp() * 2
            }
            val baselineControlsHeight = baselineTextHeight + 48.dp + 68.dp + 48.dp + 24.dp
            val artworkBottom = (viewportHeight - safeInsets.calculateBottomPadding() - 12.dp - baselineControlsHeight).coerceAtLeast(artworkTop + 24.dp)
            background(Modifier.matchParentSize())
            if (portrait && !panelOpen) {
                artwork(
                    Modifier.fillMaxWidth().height((artworkBottom - artworkTop).coerceAtLeast(1.dp)).offset(y = artworkTop),
                    20.dp,
                )
            }
            BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 20.dp, vertical = 12.dp)) {
                val wide = !portrait
                // Centre the artwork in the space above the metadata, keeping the
                // lower block anchored to the seekbar as titles grow or scroll.
                val controlsTop = artworkBottom - safeTop
                val controlsHeight = (maxHeight - controlsTop).coerceAtLeast(96.dp)

                if (wide) {
                    Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        stage(Modifier.weight(1f).fillMaxHeight())
                        Column(Modifier.weight(1f).fillMaxHeight()) {
                            header()
                            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                                Spacer(Modifier.height(16.dp))
                                controls(Modifier)
                            }
                        }
                    }
                } else if (!panelOpen) {
                    Column(Modifier.fillMaxSize()) {
                        header()
                        Spacer(Modifier.weight(1f))
                        Box(Modifier.fillMaxWidth().height(controlsHeight).testTag("full-player-controls-region").verticalScroll(rememberScrollState())) {
                            controls(Modifier.fillMaxWidth().heightIn(min = controlsHeight))
                        }
                    }
                } else {
                    Column {
                        header()
                        stage(Modifier.weight(1f).fillMaxWidth())
                        controls(Modifier)
                    }
                }
            }
            overlay(Modifier.align(Alignment.BottomCenter).safeDrawingPadding().padding(16.dp))
        }
    }
}

@Composable
private fun PlayerArtwork(scene: PlayerScene, onScrub: (Long?) -> Unit, modifier: Modifier, horizontalInset: Dp = 0.dp) {
    val palette = LocalPalette.current
    PlayerSceneLayer(scene, modifier.testTag("player-artwork-scene")) { frame ->
        val frameTone = rememberPlayerCoverTone(frame.state.current?.let { trackCover(it) })
        val auraColor = frameTone?.playerColor() ?: palette.primary
        CompositionLocalProvider(LocalNowPlayingTone provides auraColor) {
            Deck(frame.state, onScrub, Modifier.fillMaxSize().padding(horizontal = horizontalInset))
        }
    }
}

@Composable
internal fun Seekbar(
    positionMs: Long,
    durationMs: Long,
    peaks: List<Int>?,
    onScrub: ((Long?) -> Unit)? = null,
    onSeek: (Long) -> Unit,
) {
    val haptic = rememberPlayerHaptics()
    val seekFeedback = remember(durationMs) { SeekHaptics(durationMs) }
    val palette = LocalPalette.current
    val label = stringResource(R.string.player_seek_position)
    val seek by rememberUpdatedState(onSeek)
    val scrub by rememberUpdatedState(onScrub)
    var dragging by remember { mutableStateOf<Float?>(null) }
    val progress = dragging ?: if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f

    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .progressSemantics(progress)
            .semantics {
                contentDescription = label
                if (durationMs > 0) setProgress { value ->
                    seek((value.coerceIn(0f, 1f) * durationMs).toLong())
                    true
                }
            }
            .systemGestureExclusion()
            .pointerInput(durationMs) {
                if (durationMs <= 0) return@pointerInput
                detectTapGestures {
                    haptic(PlayerHaptic.Button)
                    seek(((it.x / size.width).coerceIn(0f, 1f) * durationMs).toLong())
                }
            }
            .pointerInput(durationMs) {
                if (durationMs <= 0) return@pointerInput
                detectHorizontalDragGestures(
                    onDragStart = {
                        val fraction = (it.x / size.width).coerceIn(0f, 1f)
                        dragging = fraction
                        val time = (fraction * durationMs).toLong()
                        scrub?.invoke(time)
                        seekFeedback.start(time)
                    },
                    onDragEnd = {
                        dragging?.let { seek((it * durationMs).toLong()) }
                        haptic(PlayerHaptic.Confirm)
                        dragging = null
                        scrub?.invoke(null)
                    },
                    onDragCancel = {
                        dragging = null
                        scrub?.invoke(null)
                    },
                ) { change, _ ->
                    val fraction = (change.position.x / size.width).coerceIn(0f, 1f)
                    dragging = fraction
                    val time = (fraction * durationMs).toLong()
                    scrub?.invoke(time)
                    seekFeedback.move(time)?.let(haptic)
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        val fill = if (dragging != null) palette.primary else palette.foreground
        if (peaks != null) {
            val rest = palette.borderStrong
            Canvas(Modifier.fillMaxSize()) {
                val bar = size.width / peaks.size
                peaks.forEachIndexed { index, peak ->
                    val height = (peak / 255f).coerceAtLeast(0.06f) * size.height
                    drawRect(
                        if ((index + 0.5f) / peaks.size <= progress) fill else rest,
                        topLeft = Offset(index * bar + bar * 0.18f, (size.height - height) / 2),
                        size = Size(bar * 0.64f, height),
                    )
                }
            }
        } else {
            PlayerProgressTrack(progress, fill, palette.borderStrong)
        }
        if (dragging != null) {
            val width = with(LocalDensity.current) { maxWidth.toPx() }
            val thumb = with(LocalDensity.current) { 6.5.dp.toPx() }
            Box(Modifier.offset { IntOffset((width * progress - thumb).roundToInt(), 0) }.size(13.dp).clip(CircleShape).background(palette.foreground))
        }
    }
}

@Composable
internal fun PlayerProgressTrack(progress: Float, fill: Color, rail: Color, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(5.dp).clip(CircleShape).background(rail)) {
        Box(Modifier.fillMaxWidth(progress).fillMaxHeight().background(fill))
    }
}

@Composable
fun Record(
    track: Track,
    spinning: Boolean,
    modifier: Modifier = Modifier,
    out: Boolean = spinning,
    twist: Float = 0f,
    sleeve: (@Composable (Modifier) -> Unit)? = null,
    vertical: Boolean = false,
    jacket: Modifier = Modifier,
    aura: (@Composable (Modifier) -> Unit)? = null,
) {
    val artwork = PlayerArtworkRef(track.id, trackCover(track), track.albumTitle ?: track.title)
    RecordArtwork(artwork, spinning, modifier, out, twist, sleeve, vertical, jacket, aura, trackCover(track, small = false))
}

@Composable
internal fun RecordArtwork(
    artwork: PlayerArtworkRef,
    spinning: Boolean,
    modifier: Modifier = Modifier,
    out: Boolean = spinning,
    twist: Float = 0f,
    sleeve: (@Composable (Modifier) -> Unit)? = null,
    vertical: Boolean = false,
    jacket: Modifier = Modifier,
    aura: (@Composable (Modifier) -> Unit)? = null,
    largeCover: String? = artwork.url,
) {
    val motion = playerMotionEnabled()
    val slid by animateFloatAsState(if (out) RECORD_OUT else 0f, tween(if (motion) 650 else 0), label = "record-out")
    val angle = remember(artwork.id) { Animatable(0f) }

    LaunchedEffect(spinning, artwork.id, motion) {
        while (spinning && motion) {
            angle.animateTo(angle.value + 360f, tween(1800, easing = LinearEasing))
            angle.snapTo(angle.value % 360f)
        }
    }

    BoxWithConstraints(modifier.aspectRatio(1f)) {
        val edge = maxWidth
        val slide = with(LocalDensity.current) { edge.toPx() }
        val shift = (slide * slid * if (vertical) CRATE_OUT / RECORD_OUT else 1f).roundToInt()
        Box(Modifier.fillMaxSize().padding(edge * 0.02f).offset { if (vertical) IntOffset(0, -shift) else IntOffset(shift, 0) }) {
            aura?.invoke(Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().shadow(16.dp, CircleShape).graphicsLayer { rotationZ = angle.value + twist }.clip(CircleShape)) {
                Canvas(Modifier.fillMaxSize()) {
                    val radius = size.minDimension / 2
                    drawCircle(Color(0xFF121010), radius)
                    var groove = radius * 0.34f
                    while (groove < radius) {
                        drawCircle(Color(0xFF221E1C), groove, style = Stroke(width = 1.3.dp.toPx()))
                        groove += 2.4.dp.toPx()
                    }
                    drawCircle(Color(0xFF121010), radius * 0.66f * 0.5f, style = Stroke(width = radius * 0.015f))
                }
                Cover(artwork.url, artwork.title, Modifier.align(Alignment.Center).fillMaxSize(0.32f), round = true, fadeIn = false)
                Box(Modifier.align(Alignment.Center).fillMaxSize(0.032f).clip(CircleShape).background(LocalPalette.current.background))
            }
            Canvas(Modifier.fillMaxSize()) {
                val radius = size.minDimension / 2
                val sheen = Brush.sweepGradient(
                    0f to Color.Transparent,
                    0.08f to Color.Transparent,
                    0.12f to Color.White.copy(alpha = 0.09f),
                    0.17f to Color.Transparent,
                    0.50f to Color.Transparent,
                    0.62f to Color.White.copy(alpha = 0.07f),
                    0.67f to Color.Transparent,
                    1f to Color.Transparent,
                    center = center,
                )
                rotate(-70f) {
                    drawCircle(sheen, radius * 0.83f, style = Stroke(width = radius * 0.66f))
                }
            }
        }
        val sleeveModifier = jacket.fillMaxSize().shadow(18.dp, Radius.cover)
        if (sleeve != null) sleeve(sleeveModifier.clip(Radius.cover))
        else Cover(largeCover, artwork.title, sleeveModifier, fadeIn = false)
    }
}
@Composable
internal fun LyricsPanel(track: Track, positionMs: Long, playing: Boolean) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val motion = playerMotionEnabled()
    val framePosition = produceState(positionMs, track.id, playing, motion) {
        if (playing) while (true) withFrameNanos { value = container.player.position }
        else value = positionMs
    }
    LaunchedEffect(track.id) {
        while (true) {
            delay(15_000)
            val key = "lyrics:${track.id}"
            val current = Remote.cache[key] as? Lyrics
            if (current?.source == "Manual" || (current?.lines?.isNotEmpty() == true && current.lines.all { it.text.isBlank() || it.words.isNotEmpty() })) break
            try {
                Remote.update(key, container.lyrics(track.id))
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { /* Keep the last text while this source is unavailable. */ }
        }
    }

    Load(
        "lyrics:${track.id}",
        { container.lyrics(track.id) },
        isEmpty = { it.plain.isBlank() && it.lines.isEmpty() },
        empty = { Empty(stringResource(R.string.lyrics_none)) },
    ) { lyrics ->
        if (lyrics.lines.isEmpty()) {
            LazyColumn(Modifier.fillMaxSize().fadeEdges(), contentPadding = PaddingValues(vertical = 16.dp)) {
                item { Text(lyrics.plain, style = Type.body.copy(lineHeight = Type.body.lineHeight * 1.2f), color = palette.foreground) }
                item { LyricsCredit(lyrics) }
            }
            return@Load
        }

        val active by remember(lyrics.lines, framePosition, positionMs, playing) {
            androidx.compose.runtime.derivedStateOf { lyrics.lines.indexOfLast { it.at <= if (playing) framePosition.value else positionMs } }
        }
        val list = rememberLazyListState()
        LaunchedEffect(active) {
            if (active >= 0) {
                val target = (active - 2).coerceAtLeast(0)
                if (motion) list.animateScrollToItem(target) else list.scrollToItem(target)
            }
        }

        LazyColumn(Modifier.fillMaxSize().fadeEdges(24.dp), state = list, contentPadding = PaddingValues(vertical = 40.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            itemsIndexed(lyrics.lines) { index, line ->
                TimedLyricText(
                    line = line,
                    positionMs = {
                        when {
                            index < active -> Long.MAX_VALUE
                            index > active -> Long.MIN_VALUE
                            playing -> framePosition.value
                            else -> positionMs
                        }
                    },
                    style = Type.section.copy(fontSize = Type.section.fontSize * 1.15f),
                    foreground = Color.White,
                    upcoming = when {
                        index == active && line.words.isEmpty() -> Color.White
                        index == active -> Color.White.copy(alpha = 0.72f)
                        index < active -> Color.White.copy(alpha = 0.55f)
                        else -> Color.White.copy(alpha = 0.65f)
                    },
                    modifier = Modifier.testTag("lyrics-line-$index").semantics { selected = index == active }
                        .clickable { container.player.seekTo(line.at) },
                )
            }
            item { LyricsCredit(lyrics) }
        }
    }
}

@Composable
private fun LyricsCredit(lyrics: Lyrics) {
    val provider = lyrics.provider ?: return
    val palette = LocalPalette.current
    val uriHandler = LocalUriHandler.current
    val attribution = lyrics.attribution
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 16.dp)) {
        Text(provider, style = Type.small, color = palette.muted,
            modifier = Modifier.clickable(enabled = attribution?.url != null) {
                attribution?.url?.takeIf { it.startsWith("https://unison.betterlyrics.org/") }?.let(uriHandler::openUri)
            })
        attribution?.submitter?.takeIf { it.isNotBlank() }?.let { submitter ->
            Text("· $submitter", style = Type.small, color = palette.muted,
                modifier = Modifier.clickable(enabled = attribution.submitterUrl != null) {
                    attribution.submitterUrl?.takeIf { it.startsWith("https://unison.betterlyrics.org/") }?.let(uriHandler::openUri)
                })
        }
    }
}
internal fun Modifier.fadeEdges(edge: Dp = 40.dp): Modifier = graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        val fade = (edge.toPx() / size.height).coerceIn(0f, 0.5f)
        drawRect(
            Brush.verticalGradient(0f to Color.Transparent, fade to Color.Black, 1f - fade to Color.Black, 1f to Color.Transparent),
            blendMode = BlendMode.DstIn,
        )
    }
