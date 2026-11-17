// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import app.caimack.R
import app.caimack.api.User
import kotlin.math.roundToInt

/** The menu and the entire app share one translation, including the player and bottom bar. */
@Composable
internal fun SettingsDrawer(
    open: Boolean,
    onClose: () -> Unit,
    menu: @Composable () -> Unit,
    content: @Composable () -> Unit,
) {
    val palette = LocalPalette.current
    val focus = LocalFocusManager.current
    val close = { focus.clearFocus(); onClose() }
    val motion = systemMotionEnabled()
    var drag by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    val progress by animateFloatAsState(
        targetValue = if (open) 1f - drag else 0f,
        animationSpec = tween(if (motion && !dragging) 280 else 0, easing = FastOutSlowInEasing),
        label = "settings-drawer",
    )
    val visible = open || progress > 0f
    val title = stringResource(R.string.settings_title)
    val closeLabel = stringResource(R.string.settings_close)
    BoxWithConstraints(Modifier.fillMaxSize().clipToBounds().background(palette.background)) {
        val width = (maxWidth * 0.9f).coerceAtMost(560.dp)
        val widthPx = with(LocalDensity.current) { width.toPx() }
        val flingVelocity = with(LocalDensity.current) { 600.dp.toPx() }
        Box(
            Modifier.fillMaxSize()
                .absoluteOffset { IntOffset((-widthPx * progress).roundToInt(), 0) }
                .then(if (visible) Modifier.clearAndSetSemantics {} else Modifier),
        ) { content() }
        if (visible) {
            // Only horizontal drags are claimed; the menu can still scroll vertically.
            Box(Modifier.fillMaxSize().draggable(
                state = rememberDraggableState { delta -> drag = (drag + delta / widthPx).coerceIn(0f, 1f) },
                orientation = Orientation.Horizontal,
                enabled = open,
                onDragStarted = { dragging = true },
                onDragStopped = { velocity ->
                    val dismiss = drag > 0.35f || velocity > flingVelocity
                    dragging = false
                    drag = 0f
                    if (dismiss) close()
                },
            )) {
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f * progress))
                    .clickable(interactionSource = null, indication = null, role = Role.Button, onClickLabel = closeLabel, onClick = close)
                    .semantics { this.paneTitle = title })
                Box(
                    Modifier.align(AbsoluteAlignment.CenterRight).width(width).fillMaxHeight()
                        .absoluteOffset { IntOffset((widthPx * (1f - progress)).roundToInt(), 0) }
                        .background(palette.background)
                        // Consume taps in empty menu space instead of dismissing through to the scrim.
                        .clickable(interactionSource = null, indication = null) {}
                        .semantics { paneTitle = title },
                ) { menu() }
            }
        }
    }
    // Register on opening, after any back callbacks restored with the current screen.
    if (open) BackHandler(onBack = close)
}

@Composable
internal fun SettingsMenu(user: User, onClose: () -> Unit, onSignOut: () -> Unit) {
    val palette = LocalPalette.current
    var query by rememberSaveable { mutableStateOf("") }
    val scroll = rememberScrollState()
    LaunchedEffect(query) { scroll.scrollTo(0) }
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = 20.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.settings_title), style = Type.section, modifier = Modifier.weight(1f))
            IconButton(onClick = onClose) { Icon(Lucide.X, stringResource(R.string.settings_close)) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(palette.raised), contentAlignment = Alignment.Center) {
                Text(user.username.take(1).uppercase(), style = Type.heading)
            }
            Text(user.username, style = Type.body.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        SearchInput(query, { query = it }, stringResource(R.string.settings_search), Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
        Column(Modifier.weight(1f).verticalScroll(scroll)) {
            SettingsOverview(query)
            SettingsAbout()
        }
        HorizontalDivider(color = palette.border)
        TextButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).heightIn(min = 48.dp)) {
            Icon(Lucide.LogOut, null, Modifier.size(20.dp), tint = palette.foreground)
            Spacer(Modifier.width(10.dp))
            Text(stringResource(R.string.sign_out), color = palette.foreground)
        }
    }
}
