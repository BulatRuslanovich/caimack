// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Icon
import android.view.View
import android.widget.RemoteViews
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.edit
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.RadioRequest
import app.caimack.api.Track
import app.caimack.session.SessionState
import app.caimack.ui.Appearance
import app.caimack.ui.Colorway
import app.caimack.ui.Palette
import app.caimack.ui.artistsOf
import app.caimack.ui.color
import app.caimack.ui.coverCrop
import app.caimack.ui.playerBackdropTone
import app.caimack.ui.PlayerBackdropSettings
import app.caimack.ui.CoverTone
import app.caimack.ui.coverPlaceholder
import app.caimack.ui.drawVinyl
import app.caimack.ui.paletteOf
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class NowPlayingWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context)

    companion object {
        internal const val PREFERENCES = "widget"
        internal const val TRACK = "track"
        internal const val TITLE = "title"
        private const val ARTIST = "artist"
        private const val COVER = "cover"
        private const val ART_NAME = "art_name"
        internal const val LIKED = "liked"
        private const val PLAYING = "playing"
        private const val POSITION = "position"
        private const val DURATION = "duration"
        private const val ART_WIDTH = 312
        private const val ART_HEIGHT = 240
        private const val PROGRESS_MAX = 1000

        fun show(context: Context, track: Track?, isPlaying: Boolean, positionMs: Long = 0, durationMs: Long = 0) {
            val container = (context.applicationContext as CaimackApp).container
            preferences(context).edit {
                putBoolean(PLAYING, isPlaying && track != null)
                if (track != null) {
                    putString(TRACK, track.id)
                    putString(TITLE, track.title)
                    putString(ARTIST, artistsOf(track))
                    putString(COVER, container.media.cover(track.albumId, track.id, track.hasCover, small = true))
                    putString(ART_NAME, track.albumTitle ?: track.title)
                    putBoolean(LIKED, container.favorites.isFavorite(track))
                    putLong(POSITION, positionMs)
                    putLong(DURATION, durationMs.takeIf { it > 0 } ?: (track.durationSeconds * 1000L))
                }
            }
            refresh(context)
        }

        fun progress(context: Context, positionMs: Long, durationMs: Long) {
            val app = context.applicationContext
            val manager = AppWidgetManager.getInstance(app)
            val ids = manager.getAppWidgetIds(ComponentName(app, NowPlayingWidget::class.java))
            if (ids.isEmpty()) return

            preferences(app).edit { putLong(POSITION, positionMs); if (durationMs > 0) putLong(DURATION, durationMs) }
            val views = RemoteViews(app.packageName, R.layout.widget_now_playing)
            views.setProgressBar(R.id.widget_progress, PROGRESS_MAX, fraction(positionMs, durationMs), false)
            manager.partiallyUpdateAppWidget(ids, views)
        }

        fun refresh(context: Context) {
            val app = context.applicationContext
            val manager = AppWidgetManager.getInstance(app)
            val component = ComponentName(app, NowPlayingWidget::class.java)
            if (manager.getAppWidgetIds(component).isEmpty()) return

            val container = (app as CaimackApp).container
            container.scope.launch {
                val stored = preferences(app)
                val cover = stored.getString(COVER, null)?.let { url ->
                    val request = ImageRequest.Builder(app).data(url).size(240).allowHardware(false).build()
                    (SingletonImageLoader.get(app).execute(request) as? SuccessResult)?.image?.toBitmap()
                }
                manager.updateAppWidget(component, views(app, Look.of(app), stored, cover))
            }
        }

        private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

        private fun fraction(position: Long, duration: Long) =
            if (duration <= 0) 0 else (position * PROGRESS_MAX / duration).toInt().coerceIn(0, PROGRESS_MAX)

        private fun views(app: Context, look: Look, stored: android.content.SharedPreferences, cover: Bitmap?): RemoteViews {
            val context = Appearance.localized(app)
            val title = stored.getString(TITLE, null)
            val idle = title == null
            val playing = stored.getBoolean(PLAYING, false)
            val liked = stored.getBoolean(LIKED, false)
            val tone = cover?.takeIf { look.coverTone }?.let { bitmap ->
                val edge = PlayerBackdropSettings.sampleEdge
                val sample = Bitmap.createScaledBitmap(bitmap, edge, edge, true)
                IntArray(edge * edge).also { sample.getPixels(it, 0, edge, 0, 0, edge, edge) }
                    .let(::playerBackdropTone)?.let { CoverTone(it.hue, it.chroma) }
            }

            return RemoteViews(context.packageName, R.layout.widget_now_playing).apply {
                tint(R.id.widget_root, "setBackgroundTintList", look) { it.card }
                icon(R.id.widget_wash, look) { palette -> wash(tone?.color(palette, look.colorway)) }
                icon(R.id.widget_art, look) { palette ->
                    art(cover ?: coverPlaceholder(stored.getString(ART_NAME, null) ?: title ?: "Caimack", palette), palette)
                }

                setTextViewText(R.id.widget_title, title ?: "Caimack")
                colorInt(R.id.widget_title, "setTextColor", look) { it.foreground }
                setTextViewText(R.id.widget_subtitle, stored.getString(ARTIST, null) ?: context.getString(R.string.widget_idle))
                colorInt(R.id.widget_subtitle, "setTextColor", look) { it.muted }

                val open = PendingIntent.getActivity(
                    context, 0,
                    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE,
                )
                setOnClickPendingIntent(R.id.widget_art, open)
                setOnClickPendingIntent(R.id.widget_text, open)

                tint(R.id.widget_primary, "setBackgroundTintList", look) { it.action }
                colorInt(R.id.widget_primary, "setColorFilter", look) { it.onAction }
                tint(R.id.widget_secondary, "setBackgroundTintList", look) { it.raised }
                colorInt(R.id.widget_secondary, "setColorFilter", look) { it.foreground }
                colorInt(R.id.widget_previous, "setColorFilter", look) { it.foreground }
                colorInt(R.id.widget_like, "setColorFilter", look) { if (liked) it.primary else it.muted }

                val playingParts = if (idle) View.GONE else View.VISIBLE
                setViewVisibility(R.id.widget_previous, playingParts)
                setViewVisibility(R.id.widget_like, playingParts)
                setViewVisibility(R.id.widget_progress, playingParts)

                if (idle) {
                    val enabled = (app.applicationContext as CaimackApp).container.recommendationsEnabled.value
                    setViewVisibility(R.id.widget_primary, if (enabled) View.VISIBLE else View.GONE)
                    setViewVisibility(R.id.widget_secondary, if (enabled) View.VISIBLE else View.GONE)
                    button(context, R.id.widget_primary, R.drawable.widget_radio, R.string.widget_my_radio, WidgetActions.MY_RADIO)
                    button(context, R.id.widget_secondary, R.drawable.widget_mix, R.string.widget_daily_mix, WidgetActions.DAILY_MIX)
                    return@apply
                }

                button(context, R.id.widget_previous, R.drawable.widget_previous, R.string.player_previous, WidgetActions.PREVIOUS)
                button(
                    context, R.id.widget_primary,
                    if (playing) R.drawable.widget_pause else R.drawable.widget_play,
                    if (playing) R.string.widget_pause else R.string.widget_play,
                    WidgetActions.TOGGLE,
                )
                button(context, R.id.widget_secondary, R.drawable.widget_next, R.string.widget_next, WidgetActions.NEXT)
                button(
                    context, R.id.widget_like,
                    if (liked) R.drawable.widget_heart_filled else R.drawable.widget_heart,
                    if (liked) R.string.menu_unlike else R.string.menu_like,
                    WidgetActions.LIKE,
                )

                setProgressBar(R.id.widget_progress, PROGRESS_MAX, fraction(stored.getLong(POSITION, 0), stored.getLong(DURATION, 0)), false)
                tint(R.id.widget_progress, "setProgressTintList", look) { it.foreground }
                tint(R.id.widget_progress, "setProgressBackgroundTintList", look) { it.borderStrong }
            }
        }

        private fun RemoteViews.button(context: Context, id: Int, icon: Int, label: Int, action: String) {
            setImageViewResource(id, icon)
            setContentDescription(id, context.getString(label))
            val intent = Intent(context, WidgetActions::class.java).setAction(action)
            setOnClickPendingIntent(id, PendingIntent.getBroadcast(context, action.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE))
        }

        private fun RemoteViews.tint(id: Int, method: String, look: Look, pick: (Palette) -> Color) =
            setColorStateList(id, method, ColorStateList.valueOf(pick(look.day).toArgb()), ColorStateList.valueOf(pick(look.night).toArgb()))

        private fun RemoteViews.colorInt(id: Int, method: String, look: Look, pick: (Palette) -> Color) =
            setColorInt(id, method, pick(look.day).toArgb(), pick(look.night).toArgb())

        private fun RemoteViews.icon(id: Int, look: Look, draw: (Palette) -> Bitmap) {
            val day = Icon.createWithBitmap(draw(look.day))
            val night = if (look.night === look.day) day else Icon.createWithBitmap(draw(look.night))
            setIcon(id, "setImageIcon", day, night)
        }

        private fun wash(tone: Color?): Bitmap {
            val bitmap = Bitmap.createBitmap(WASH_WIDTH, 1, Bitmap.Config.ARGB_8888)
            if (tone == null) return bitmap
            val from = tone.copy(alpha = WASH_ALPHA).toArgb()
            val paint = Paint().apply {
                shader = LinearGradient(0f, 0f, WASH_WIDTH * 0.75f, 0f, from, android.graphics.Color.TRANSPARENT, Shader.TileMode.CLAMP)
            }
            Canvas(bitmap).drawRect(0f, 0f, WASH_WIDTH.toFloat(), 1f, paint)
            return bitmap
        }

        private const val WASH_WIDTH = 256
        private const val WASH_ALPHA = 0.4f

        private fun art(cover: Bitmap?, palette: Palette): Bitmap {
            val bitmap = Bitmap.createBitmap(ART_WIDTH, ART_HEIGHT, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val edge = ART_HEIGHT - 16f
            val top = 8f
            drawVinyl(canvas, edge * 0.86f, top + edge / 2, edge * 0.47f, cover, palette)

            val sleeve = RectF(4f, top, 4f + edge, top + edge)
            canvas.drawRoundRect(sleeve, 10f, 10f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = palette.raised.toArgb()
                setShadowLayer(14f, 0f, 6f, 0x66000000)
            })
            canvas.save()
            canvas.clipPath(Path().apply { addRoundRect(sleeve, 10f, 10f, Path.Direction.CW) })
            if (cover != null) canvas.drawBitmap(cover, coverCrop(cover), sleeve, Paint(Paint.FILTER_BITMAP_FLAG))
            canvas.restore()
            return bitmap
        }
    }

    private class Look(val day: Palette, val night: Palette, val colorway: Colorway, val coverTone: Boolean) {
        companion object {
            fun of(context: Context): Look {
                val appearance = (context.applicationContext as CaimackApp).container.appearance
                val colorway = appearance.colorway.value
                val light = paletteOf(colorway, false)
                val dark = paletteOf(colorway, true)
                return when (appearance.theme.value) {
                    Appearance.DARK -> Look(dark, dark, colorway, appearance.coverTone.value)
                    Appearance.LIGHT -> Look(light, light, colorway, appearance.coverTone.value)
                    else -> Look(light, dark, colorway, appearance.coverTone.value)
                }
            }
        }
    }
}

class WidgetActions : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val container = (context.applicationContext as CaimackApp).container
        val player = container.player

        when (intent.action) {
            TOGGLE -> player.toggle()
            NEXT -> player.next()
            PREVIOUS -> player.previous()
            LIKE -> like(context)
            MY_RADIO, DAILY_MIX -> {
                val done = goAsync()
                container.scope.launch {
                    try {
                        val session = container.session.state.first { it !is SessionState.Restoring }
                        if (session !is SessionState.SignedIn) {
                            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            return@launch
                        }
                        runCatching { container.refreshCapabilities() }
                        if (!container.recommendationsEnabled.value) return@launch
                        if (intent.action == MY_RADIO) {
                            runCatching { container.radio(RadioRequest(null, emptyList())) }.getOrNull()
                                ?.takeIf { it.tracks.isNotEmpty() }
                                ?.let { player.playMyRadio(it) }
                        } else {
                            runCatching { container.api.homeMix("daily").tracks }.getOrNull()
                                ?.takeIf { it.isNotEmpty() }
                                ?.let { player.play(it, 0, "widget") }
                        }
                    } finally {
                        done.finish()
                    }
                }
            }
        }
    }

    private fun like(context: Context) {
        val container = (context.applicationContext as CaimackApp).container
        val stored = context.getSharedPreferences(NowPlayingWidget.PREFERENCES, Context.MODE_PRIVATE)
        val id = stored.getString(NowPlayingWidget.TRACK, null) ?: return
        val track = container.tracks[id] ?: Track(
            id = id,
            title = stored.getString(NowPlayingWidget.TITLE, null).orEmpty(),
            artistId = "",
            artistName = "",
            durationSeconds = 0,
            isFavorite = stored.getBoolean(NowPlayingWidget.LIKED, false),
        )
        container.favorites.toggle(track)
        stored.edit { putBoolean(NowPlayingWidget.LIKED, container.favorites.isFavorite(track)) }
        NowPlayingWidget.refresh(context)
    }

    companion object {
        const val TOGGLE = "app.caimack.widget.TOGGLE"
        const val NEXT = "app.caimack.widget.NEXT"
        const val PREVIOUS = "app.caimack.widget.PREVIOUS"
        const val LIKE = "app.caimack.widget.LIKE"
        const val MY_RADIO = "app.caimack.widget.MY_RADIO"
        const val DAILY_MIX = "app.caimack.widget.DAILY_MIX"
    }
}
