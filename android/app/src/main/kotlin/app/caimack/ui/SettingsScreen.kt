// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.shape.CircleShape
import kotlin.math.abs
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Offset
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.Canvas
import kotlin.math.roundToInt
import app.caimack.playback.EqualizerState
import androidx.compose.ui.text.style.TextAlign
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.caimack.R
import app.caimack.BuildConfig
import app.caimack.playback.RadioTile
import app.caimack.api.SettingsChanges
import kotlinx.coroutines.launch

private data class Option(
    val value: String,
    val label: String,
    val hint: String? = null,
    val preview: (@Composable () -> Unit)? = null,
)

@Composable
fun SettingsScreen(category: SettingsCategory? = null) {
    val sourceContext = LocalContext.current
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val settings by container.settings.collectAsStateWithLifecycle()
    val theme by container.appearance.theme.collectAsStateWithLifecycle()
    val equalizer by container.equalizer.state.collectAsStateWithLifecycle()
    val connect by container.connect.state.collectAsStateWithLifecycle()
    val localSmartTransitions by container.playbackPrefs.smartTransitions.collectAsStateWithLifecycle()
    val smartTransitions = if (connect.selectedId != null) connect.playback?.smartTransitions ?: localSmartTransitions else localSmartTransitions
    val setSmartTransitions: (Boolean) -> Unit = { enabled ->
        if (!container.connect.route(app.caimack.api.ConnectCommand.SetSmartTransitions(enabled))) container.playbackPrefs.setSmartTransitions(enabled)
    }
    val setNormalizeVolume: (Boolean) -> Unit = { enabled ->
        if (!container.connect.route(app.caimack.api.ConnectCommand.SetNormalizeVolume(enabled))) container.playbackPrefs.setNormalizeVolume(enabled)
    }
    val activity = LocalActivity.current
    val scope = rememberCoroutineScope()
    var query by rememberSaveable { mutableStateOf("") }
    val resources = LocalResources.current
    val configuration = LocalConfiguration.current
    val recommendations = recommendationsEnabled()
    val visible = remember(query, configuration, category, recommendations) {
        matchingSettings(query, resources).filterTo(mutableSetOf()) {
            (query.isNotBlank() || category?.title == it.section) && (recommendations || it != SettingKey.Tile)
        }
    }
    val scroll = rememberScrollState()

    var permissionExplanation by remember { mutableStateOf(false) }
    var notificationsAllowed by remember { mutableStateOf(app.caimack.playback.Background.canNotify(sourceContext)) }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    androidx.compose.runtime.DisposableEffect(lifecycle) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                notificationsAllowed = app.caimack.playback.Background.canNotify(sourceContext)
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val permission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        notificationsAllowed = granted
        container.playbackPrefs.setRecapReminder(granted)
    }
    val reminderChange: (Boolean) -> Unit = { enabled ->
        if (!enabled) container.playbackPrefs.setRecapReminder(false)
        else if (notificationsAllowed) container.playbackPrefs.setRecapReminder(true)
        else permissionExplanation = true
    }
    if (permissionExplanation) androidx.compose.material3.AlertDialog(
        onDismissRequest = { permissionExplanation = false },
        title = { Text(stringResource(R.string.settings_recap_reminder)) },
        text = { Text(stringResource(R.string.notifications_explanation)) },
        confirmButton = { TextButton(onClick = {
            permissionExplanation = false
            permission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }) { Text(stringResource(R.string.notifications_enable)) } },
        dismissButton = { TextButton(onClick = { permissionExplanation = false }) { Text(stringResource(R.string.action_cancel)) } },
    )

    val update = { changes: SettingsChanges ->
        container.settings.value = settings.copy(quality = changes.quality ?: settings.quality)
        scope.launch { runCatching { container.api.updateSettings(changes) }.onSuccess { container.settings.value = it } }
        Unit
    }

    Column(Modifier.fillMaxSize()) {
        SearchInput(
            value = query,
            onValueChange = { query = it; scope.launch { scroll.scrollTo(0) } },
            label = stringResource(R.string.settings_search),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
        )
        Column(Modifier.weight(1f).verticalScroll(scroll).padding(bottom = 24.dp + LocalMiniPlayerInset.current)) {
            if (category == null && query.isBlank()) SettingsOverview()
            else if (visible.isEmpty()) Empty(stringResource(R.string.settings_search_empty))
            if (visible.any { it.section == R.string.settings_playback }) {
                Panel(stringResource(R.string.settings_playback)) {
                    PlaybackDevicesButton()
                    if (SettingKey.Quality in visible) {
                        Choice(
                            stringResource(R.string.settings_quality),
                            stringResource(R.string.settings_help_quality),
                            settings.quality,
                            listOf(
                                Option("Low", stringResource(R.string.settings_quality_low), stringResource(R.string.settings_quality_bitrate, 64)),
                                Option("Normal", stringResource(R.string.settings_quality_normal), stringResource(R.string.settings_quality_bitrate, 128)),
                                Option("Original", stringResource(R.string.settings_quality_original), stringResource(R.string.settings_quality_as_uploaded)),
                            ),
                        ) { update(SettingsChanges(quality = it)) }
                    }

                    if (SettingKey.Transitions in visible) {
                        Row(
                            Modifier.fillMaxWidth().clickable { setSmartTransitions(!smartTransitions) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            SettingLabel(
                                stringResource(R.string.settings_smart_transitions),
                                stringResource(R.string.settings_help_smartTransitions),
                                style = Type.body.copy(fontWeight = FontWeight.SemiBold),
                                modifier = Modifier.weight(1f).padding(end = 12.dp),
                            )
                            Toggle(smartTransitions) { setSmartTransitions(it) }
                        }
                    }

                    if (SettingKey.Loudness in visible) {
                        val localNormalizeVolume by container.playbackPrefs.normalizeVolume.collectAsStateWithLifecycle()
                        val normalizeVolume = if (connect.selectedId != null) connect.playback?.normalizeVolume ?: localNormalizeVolume else localNormalizeVolume
                        Row(
                            Modifier.fillMaxWidth().clickable { setNormalizeVolume(!normalizeVolume) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            SettingLabel(
                                stringResource(R.string.settings_normalize_volume),
                                stringResource(R.string.settings_help_normalizeVolume),
                                style = Type.body.copy(fontWeight = FontWeight.SemiBold),
                                modifier = Modifier.weight(1f).padding(end = 12.dp),
                            )
                            Toggle(normalizeVolume) { setNormalizeVolume(it) }
                        }
                    }

                    if (SettingKey.Tile in visible) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                stringResource(R.string.settings_tile),
                                style = Type.body.copy(fontWeight = FontWeight.SemiBold),
                                modifier = Modifier.weight(1f).padding(end = 12.dp),
                            )
                            var added by rememberSaveable { mutableStateOf(false) }
                            val context = LocalContext.current
                            Text(
                                stringResource(if (added) R.string.settings_tile_added else R.string.settings_tile_add),
                                style = Type.small.copy(fontWeight = FontWeight.Medium),
                                color = if (added) palette.muted else palette.foreground,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .border(1.dp, if (added) palette.border else palette.controlBorder, CircleShape)
                                    .clickable(enabled = !added) { RadioTile.requestAdd(context) { added = it } }
                                    .heightIn(min = 48.dp)
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }

                }
            }

            if (SettingKey.Downloads in visible) {
                Panel(stringResource(R.string.settings_downloads)) {
                    app.caimack.sync.SyncSettings()
                    if (SettingKey.Downloads in visible) {
                        val autoDownloads by container.playbackPrefs.autoDownloads.collectAsStateWithLifecycle()
                        Row(
                            Modifier.fillMaxWidth().clickable { container.playbackPrefs.setAutoDownloads(!autoDownloads) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                stringResource(R.string.settings_auto_downloads),
                                style = Type.body.copy(fontWeight = FontWeight.SemiBold),
                                modifier = Modifier.weight(1f).padding(end = 12.dp),
                            )
                            Toggle(autoDownloads) { container.playbackPrefs.setAutoDownloads(it) }
                        }
                    }

                }
            }
            if (SettingKey.Reminder in visible) {
                Panel(stringResource(R.string.nav_account)) {
                    if (SettingKey.Reminder in visible) {
                        val recapReminder by container.playbackPrefs.recapReminder.collectAsStateWithLifecycle()
                        Row(
                            Modifier.fillMaxWidth().clickable { reminderChange(!(recapReminder && notificationsAllowed)) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                stringResource(R.string.settings_recap_reminder),
                                style = Type.body.copy(fontWeight = FontWeight.SemiBold),
                                modifier = Modifier.weight(1f).padding(end = 12.dp),
                            )
                            Toggle(recapReminder && notificationsAllowed, reminderChange)
                        }
                    }

                }
            }

            if (SettingKey.Equalizer in visible) {
                Panel(stringResource(R.string.settings_equalizer), action = { Toggle(equalizer.enabled) { container.equalizer.setEnabled(it) } }) {
                    Text(stringResource(R.string.settings_help_equalizer), style = Type.small, color = palette.muted)

                    if (equalizer.enabled) {
                        OptionSelector(
                            stringResource(R.string.settings_preset), equalizer.preset ?: "custom",
                            listOf(
                                "custom" to stringResource(R.string.settings_preset_custom),
                                "flat" to stringResource(R.string.settings_equalizer_flat),
                                "bass" to stringResource(R.string.settings_equalizer_bass),
                                "vocal" to stringResource(R.string.settings_equalizer_vocal),
                                "treble" to stringResource(R.string.settings_equalizer_treble),
                                "rock" to stringResource(R.string.settings_equalizer_rock),
                                "electronic" to stringResource(R.string.settings_equalizer_electronic),
                                "acoustic" to stringResource(R.string.settings_equalizer_acoustic),
                                "warm" to stringResource(R.string.settings_equalizer_warm),
                            ), Modifier.fillMaxWidth(),
                        ) { if (it != "custom") container.equalizer.applyPreset(it) }

                        val locale = LocalConfiguration.current.locales[0]
                        val frequencies = EqualizerState.BANDS_HZ.map { hz ->
                            if (hz < 1000) stringResource(R.string.settings_equalizer_hz, hz)
                            else stringResource(R.string.settings_equalizer_khz, String.format(locale, "%.1f", hz / 1000.0).trimEnd('0').trimEnd('.', ','))
                        }
                        val decibels = equalizer.gains.map { stringResource(R.string.settings_equalizer_db, if (it > 0) "+$it" else "$it") }
                        BoxWithConstraints(Modifier.fillMaxWidth()) {
                            val curveWidth = maxOf(maxWidth, 600.dp)
                            Box(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 12.dp)) {
                                Column(Modifier.width(curveWidth)) {
                                    EqualizerCurve(equalizer.gains, frequencies, decibels) { band, gain -> container.equalizer.setGain(band, gain) }
                                }
                            }
                        }
                        val preampLabel = stringResource(R.string.settings_equalizer_preamp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(preampLabel, style = Type.body)
                            Text(stringResource(R.string.settings_equalizer_db, signedGain(equalizer.preampDb)), color = palette.primary, style = Type.body)
                        }
                        Slider(
                            value = equalizer.preampDb.toFloat(),
                            onValueChange = { container.equalizer.setPreamp(it.roundToInt()) },
                            valueRange = -EqualizerState.LIMIT_DB.toFloat()..EqualizerState.LIMIT_DB.toFloat(),
                            steps = EqualizerState.LIMIT_DB * 2 - 1,
                            modifier = Modifier.semantics { contentDescription = preampLabel },
                            colors = SliderDefaults.colors(thumbColor = palette.primary, activeTrackColor = palette.primary, inactiveTrackColor = palette.raised),
                        )
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(stringResource(R.string.settings_equalizer_headroom), style = Type.body)
                                Text(stringResource(R.string.settings_equalizer_headroom_hint), color = palette.muted, style = Type.small)
                            }
                            Toggle(equalizer.autoHeadroom) { container.equalizer.setAutoHeadroom(it) }
                        }
                        Text(stringResource(R.string.settings_equalizer_output, signedGain(equalizer.effectivePreampDb)), style = Type.small, color = palette.muted)
                        TextButton(onClick = { container.equalizer.reset() }) {
                            Text(stringResource(R.string.settings_equalizer_reset), color = palette.primary)
                        }
                    }
                }
            }

            if (visible.any { it.section == R.string.settings_appearance }) {
                Panel(stringResource(R.string.settings_appearance)) {
                    if (SettingKey.Theme in visible) {
                        Choice(
                            stringResource(R.string.settings_theme),
                            stringResource(R.string.settings_help_theme),
                            theme,
                            listOf(
                                Option(Appearance.SYSTEM, stringResource(R.string.settings_theme_system)),
                                Option(Appearance.DARK, stringResource(R.string.settings_theme_dark)),
                                Option(Appearance.LIGHT, stringResource(R.string.settings_theme_light)),
                            ),
                        ) { container.appearance.setTheme(it) }
                    }

                    if (SettingKey.Palette in visible) {
                        val colorway by container.appearance.colorway.collectAsStateWithLifecycle()
                        val dark = palette.dark
                        Choice(
                            stringResource(R.string.settings_colorway),
                            stringResource(R.string.settings_help_colorway),
                            colorway.key,
                            Colorway.entries.map { option ->
                                Option(option.key, stringResource(colorwayName(option)), preview = { ColorwaySwatch(paletteOf(option, dark)) })
                            },
                        ) { container.appearance.setColorway(Colorway.of(it)) }
                    }

                    if (SettingKey.Density in visible) {
                        val density by container.appearance.libraryDensity.collectAsStateWithLifecycle()
                        Choice(
                            stringResource(R.string.settings_library_density), null, density.key,
                            listOf(
                                Option("compact", stringResource(R.string.settings_density_compact)),
                                Option("comfortable", stringResource(R.string.settings_density_comfortable)),
                                Option("spacious", stringResource(R.string.settings_density_spacious)),
                            ),
                        ) { container.appearance.setLibraryDensity(LibraryDensity.of(it)) }
                    }

                    if (SettingKey.PlayerEffects in visible) {
                        val enabled by container.appearance.playerEffects.collectAsStateWithLifecycle()
                        Row(Modifier.fillMaxWidth().clickable { container.appearance.setPlayerEffects(!enabled) },
                            verticalAlignment = Alignment.CenterVertically) {
                            SettingLabel(stringResource(R.string.settings_player_effects),
                                stringResource(R.string.settings_help_player_effects),
                                style = Type.body.copy(fontWeight = FontWeight.SemiBold),
                                modifier = Modifier.weight(1f).padding(end = 12.dp))
                            Toggle(enabled) { container.appearance.setPlayerEffects(it) }
                        }
                    }

                    if (SettingKey.Cover in visible) {
                        val coverTone by container.appearance.coverTone.collectAsStateWithLifecycle()
                        Row(
                            Modifier.fillMaxWidth().clickable { container.appearance.setCoverTone(!coverTone) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            SettingLabel(
                                stringResource(R.string.settings_cover_tone),
                                stringResource(R.string.settings_help_coverTone),
                                style = Type.body.copy(fontWeight = FontWeight.SemiBold),
                                modifier = Modifier.weight(1f).padding(end = 12.dp),
                            )
                            Toggle(coverTone) { container.appearance.setCoverTone(it) }
                        }
                    }

                    if (SettingKey.Language in visible) {
                        val current = container.appearance.language.ifEmpty { LocalConfiguration.current.locales[0].language }
                        Choice(
                            stringResource(R.string.settings_language),
                            stringResource(R.string.settings_help_language),
                            if (current == "ru") "ru" else "en",
                            listOf(Option("en", stringResource(R.string.language_english)), Option("ru", stringResource(R.string.language_russian))),
                        ) {
                            container.appearance.setLanguage(it)
                            activity?.recreate()
                        }
                    }

                }
            }

            if (SettingKey.Updates in visible) UpdatesSettings()

            if (SettingKey.SignOut in visible) {
                TextButton(onClick = { scope.launch { Remote.cache.clear(); container.player.stop(); container.session.logout() } }, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text(stringResource(R.string.sign_out), color = palette.muted)
                }
            }
            Text(
                text = "Caimack v${BuildConfig.VERSION_NAME}",
                style = Type.tiny,
                color = palette.muted,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
            )
            TextButton(
                onClick = { sourceContext.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SOURCE_URL))) },
                modifier = Modifier.padding(horizontal = 8.dp),
            ) {
                Text(stringResource(R.string.settings_source_code) + " · AGPL-3.0", color = palette.muted)
            }
        }
    }
}

@Composable
private fun Panel(title: String, action: (@Composable () -> Unit)? = null, content: @Composable () -> Unit) {
    val palette = LocalPalette.current
    Column(
        Modifier.padding(horizontal = 20.dp, vertical = 16.dp).fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = Type.heading, modifier = Modifier.weight(1f))
            action?.invoke()
        }
        content()
    }
}

@Composable
private fun Choice(legend: String, hint: String?, value: String, options: List<Option>, onChange: (String) -> Unit) {
    val palette = LocalPalette.current
    if (options.none { it.preview != null }) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (hint != null) SettingLabel(legend, hint, Type.body.copy(fontWeight = FontWeight.Medium), Modifier.fillMaxWidth())
            else Text(legend, style = Type.body.copy(fontWeight = FontWeight.Medium))
            OptionSelector(legend, value, options.map { it.value to listOfNotNull(it.label, it.hint).joinToString(" · ") }, Modifier.fillMaxWidth(), onChange)
        }
        return
    }
    Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (hint != null) {
            SettingLabel(legend, hint, Type.body.copy(fontWeight = FontWeight.SemiBold), Modifier.fillMaxWidth())
        } else {
            Text(legend, style = Type.body.copy(fontWeight = FontWeight.SemiBold))
        }
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val preferredColumns = if (options.any { it.preview != null }) 2 else options.size
            val perRow = (maxWidth / (128.dp * LocalDensity.current.fontScale)).toInt().coerceIn(1, preferredColumns)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                options.chunked(perRow).forEach { row ->
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { option ->
                            val checked = option.value == value
                            Column(
                                Modifier
                                    .weight(1f)
                                    .fillMaxHeight()
                                    .clip(Radius.row)
                                    .background(if (checked) palette.primarySoft else palette.card)
                                    .border(1.dp, if (checked) palette.primary else palette.border, Radius.row)
                                    .selectable(selected = checked, role = Role.RadioButton, onClick = { onChange(option.value) })
                                    .heightIn(min = 48.dp)
                                    .padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                option.preview?.invoke()
                                Text(option.label, style = Type.body.copy(fontWeight = FontWeight.Medium))
                                option.hint?.let { Text(it, style = Type.tiny, color = palette.muted) }
                            }
                        }
                        repeat(perRow - row.size) { Box(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

private fun colorwayName(colorway: Colorway) = when (colorway) {
    Colorway.Coffee -> R.string.settings_colorway_coffee
    Colorway.Graphite -> R.string.settings_colorway_graphite
    Colorway.Midnight -> R.string.settings_colorway_midnight
    Colorway.Plum -> R.string.settings_colorway_plum
    Colorway.Studio -> R.string.settings_colorway_studio
}

@Composable
private fun ColorwaySwatch(palette: Palette) {
    Row(
        Modifier.fillMaxWidth().padding(bottom = 6.dp).height(28.dp).clip(Radius.tile).border(1.dp, LocalPalette.current.border, Radius.tile),
    ) {
        listOf(palette.background, palette.card, palette.raised, palette.foreground, palette.primary).forEach {
            Box(Modifier.weight(1f).fillMaxHeight().background(it))
        }
    }
}

private fun signedGain(value: Int): String = if (value > 0) "+$value" else "$value"

@Composable
private fun EqualizerCurve(gains: List<Int>, frequencies: List<String>, decibels: List<String>, onChange: (Int, Int) -> Unit) {
    val palette = LocalPalette.current
    val limit = EqualizerState.LIMIT_DB
    val update by rememberUpdatedState(onChange)
    val current by rememberUpdatedState(gains)

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth()) {
            decibels.forEach { Text(it, style = Type.micro, color = palette.muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) }
        }

        Box(Modifier.fillMaxWidth().height(200.dp)) {
            Canvas(Modifier.matchParentSize()) {
                val n = gains.size
                fun x(band: Int) = (band + 0.5f) / n * size.width
                fun y(gain: Int) = (limit - gain) / (2f * limit) * size.height

                listOf(limit, limit / 2, 0, -limit / 2, -limit).forEach { tick ->
                    drawLine(
                        palette.border,
                        Offset(0f, y(tick)),
                        Offset(size.width, y(tick)),
                        strokeWidth = 1.dp.toPx(),
                        pathEffect = if (tick == 0) null else PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
                    )
                }
                for (band in 0 until n) drawLine(palette.border, Offset(x(band), 0f), Offset(x(band), size.height), strokeWidth = 1.dp.toPx())

                val points = listOf(Offset(0f, y(gains.first()))) + gains.mapIndexed { band, gain -> Offset(x(band), y(gain)) } +
                    Offset(size.width, y(gains.last()))
                val line = Path().apply {
                    moveTo(points[0].x, points[0].y)
                    for (i in 1 until points.size) {
                        val before = points[(i - 2).coerceAtLeast(0)]
                        val from = points[i - 1]
                        val to = points[i]
                        val after = points[(i + 1).coerceAtMost(points.size - 1)]
                        cubicTo(
                            from.x + (to.x - before.x) / 6, from.y + (to.y - before.y) / 6,
                            to.x - (after.x - from.x) / 6, to.y - (after.y - from.y) / 6,
                            to.x, to.y,
                        )
                    }
                }
                val area = Path().apply {
                    addPath(line)
                    lineTo(size.width, size.height)
                    lineTo(0f, size.height)
                    close()
                }
                drawPath(area, Brush.verticalGradient(listOf(palette.primary.copy(alpha = 0.35f), palette.primary.copy(alpha = 0.02f))))
                drawPath(line, palette.primary, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))

                gains.forEachIndexed { band, gain ->
                    drawCircle(palette.card, radius = 9.dp.toPx(), center = Offset(x(band), y(gain)))
                    drawCircle(palette.primary, radius = 7.dp.toPx(), center = Offset(x(band), y(gain)))
                }
            }

            Row(Modifier.matchParentSize()) {
                gains.forEachIndexed { band, gain ->
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .semantics {
                                contentDescription = frequencies[band]
                                stateDescription = decibels[band]
                                progressBarRangeInfo = ProgressBarRangeInfo(gain.toFloat(), -limit.toFloat()..limit.toFloat(), limit * 2 - 1)
                                setProgress { value ->
                                    update(band, value.roundToInt().coerceIn(-limit, limit))
                                    true
                                }
                            }
                            .pointerInput(band) {
                                fun gainAt(y: Float) = (limit - y / size.height * 2 * limit).roundToInt().coerceIn(-limit, limit)
                                awaitEachGesture {
                                    val down = awaitFirstDown()
                                    val knob = (limit - current[band]) / (2f * limit) * size.height
                                    if (abs(down.position.y - knob) > 28.dp.toPx()) return@awaitEachGesture
                                    down.consume()
                                    update(band, gainAt(down.position.y))
                                    drag(down.id) { change ->
                                        change.consume()
                                        update(band, gainAt(change.position.y))
                                    }
                                }
                            },
                    )
                }
            }
        }

        Row(Modifier.fillMaxWidth()) {
            frequencies.forEach { Text(it, style = Type.micro, color = palette.muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) }
        }
    }
}

@Composable
private fun SettingLabel(text: String, hint: String, style: androidx.compose.ui.text.TextStyle, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(text, style = style)
        Text(hint, style = Type.small, color = palette.muted)
    }
}
