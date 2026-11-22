// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.widget

import android.app.PendingIntent
import app.caimack.audiobooks.AudiobookPlayback
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
import android.os.Bundle
import android.os.SystemClock
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
import app.caimack.ui.coverPalette
import app.caimack.ui.coverPaletteSeed
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class NowPlayingWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context)

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) = refresh(context)

    companion object {
        internal const val PREFERENCES = "widget"
        internal const val TRACK = "track"
        internal const val TITLE = "title"
        private const val ARTIST = "artist"
        private const val COVER = "cover"
        private const val ART_NAME = "art_name"
        internal const val LIKED = "liked"
        private const val PLAYING = "playing"
        private const val REVERSE = "reverse"
        private const val POSITION = "position"
        private const val DURATION = "duration"
        private const val ART_WIDTH = 312
        private const val ART_HEIGHT = 240
        private const val PROGRESS_MAX = 1000

        fun show(context: Context, track: Track?, isPlaying: Boolean, positionMs: Long = 0, durationMs: Long = 0) {
            val container = (context.applicationContext as CaimackApp).container
            val stored = preferences(context)
            val from = stored.getString(TRACK, null)
            val changed = track != null && track.id != from
            val reverse = changed && pendingNavigation?.isPrevious(from, track?.id, SystemClock.elapsedRealtime()) == true
            if (changed) pendingNavigation = null
            stored.edit {
                if (changed) putBoolean(REVERSE, reverse)
                putBoolean(PLAYING, isPlaying && track != null)
                if (track != null) {
                    putString(TRACK, track.id)
                    putString(TITLE, track.title)
                    putString(ARTIST, artistsOf(track))
                    putString(COVER, container.media.cover(track.albumId, track.id, track.hasCover, small = true, revision = track.coverRevision))
                    putString(ART_NAME, track.albumTitle ?: track.title)
                    putBoolean(LIKED, container.favorites.isFavorite(track))
                    putLong(POSITION, positionMs)
                    putLong(DURATION, durationMs.takeIf { it > 0 } ?: (track.durationSeconds * 1000L))
                }
            }
            refresh(context)
        }

        internal fun navigation(context: Context, previous: Boolean) {
            val player = (context.applicationContext as CaimackApp).container.player.state.value
            pendingNavigation = WidgetTrackNavigation(
                preferences(context).getString(TRACK, null),
                if (previous) player.previous?.id else player.next?.id,
                previous, SystemClock.elapsedRealtime(),
            )
        }

        private var pendingNavigation: WidgetTrackNavigation? = null

        fun progress(context: Context, positionMs: Long, durationMs: Long, audiobook: Boolean = false) {
            val app = context.applicationContext
            val manager = AppWidgetManager.getInstance(app)
            val ids = manager.getAppWidgetIds(ComponentName(app, NowPlayingWidget::class.java))
            if (ids.isEmpty()) return

            val container = (app as CaimackApp).container
            if (audiobook != (container.audiobooksEnabled.value && container.audiobookPlayback.state.value != null)) return
            if (!audiobook) preferences(app).edit { putLong(POSITION, positionMs); if (durationMs > 0) putLong(DURATION, durationMs) }
            // The system merges partial updates into its cached full RemoteViews. Remove
            // transition commands first, so a progress tick cannot replay an old animation.
            settle()
            val views = RemoteViews(app.packageName, R.layout.widget_now_playing)
            views.setProgressBar(R.id.widget_progress, PROGRESS_MAX, fraction(positionMs, durationMs), false)
            manager.partiallyUpdateAppWidget(ids, views)
        }

        fun refresh(context: Context) {
            val app = context.applicationContext
            val manager = AppWidgetManager.getInstance(app)
            val wide = ComponentName(app, NowPlayingWidget::class.java)
            val square = ComponentName(app, RecordWidget::class.java)
            val wideIds = manager.getAppWidgetIds(wide)
            val hasWide = wideIds.isNotEmpty()
            val hasSquare = manager.getAppWidgetIds(square).isNotEmpty()
            if (!hasWide && !hasSquare) return

            val container = (app as CaimackApp).container
            val playback = container.audiobookPlayback.state.value.takeIf { container.audiobooksEnabled.value }
            val book = playback?.let { state -> container.audiobookStore.state.value.books.find { it.id == state.bookId } }
            val stored = if (book != null) Snapshot(mapOf(
                TRACK to book.id, TITLE to book.title,
                ARTIST to book.chapters.find { it.id == playback.chapterId }?.title,
                ART_NAME to book.title, COVER to container.audiobookStore.cover(book),
                PLAYING to playback.playing, POSITION to playback.positionMs, DURATION to playback.durationMs,
            ), audiobook = true) else Snapshot(preferences(app).all)
            latestUpdate.submit(container.scope) {
                val cover = stored.getString(COVER, null)?.let { url ->
                    val request = ImageRequest.Builder(app).data(url).size(240).allowHardware(false).build()
                    try { (SingletonImageLoader.get(app).execute(request) as? SuccessResult)?.image?.toBitmap() }
                    catch (cancel: kotlinx.coroutines.CancellationException) { throw cancel }
                    catch (_: Exception) { null }
                }
                val look = Look.of(app)
                val frame = RecordFrame(
                    stored.getString(TRACK, null),
                    stored.getString(ART_NAME, null) ?: stored.getString(TITLE, null) ?: "Caimack",
                    cover, stored.getBoolean(PLAYING, false),
                )
                val next = recordFrames.next(frame, frame.id)
                val compactIds = wideIds.filter {
                    manager.getAppWidgetOptions(it).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 120) < 100
                }.toIntArray()
                val expandedIds = wideIds.filter { it !in compactIds }.toIntArray()
                val bindArtwork = if (stored.audiobook) bookArtwork(app, look, frame, scale = 0.76f)
                    else artwork(app, look, next, stored.getBoolean(REVERSE, false))
                val squareArtwork = if (hasSquare && stored.audiobook) bookArtwork(app, look, frame, scale = 1f) else bindArtwork
                fun render(animate: Boolean): () -> Unit {
                    val artwork: (RemoteViews) -> Unit = { bindArtwork(it, animate) }
                    val compact = if (compactIds.isNotEmpty()) views(app, look, stored, R.layout.widget_now_playing_compact, cover, artwork) else null
                    val expanded = if (expandedIds.isNotEmpty()) views(app, look, stored, R.layout.widget_now_playing, cover, artwork) else null
                    val record = if (hasSquare) views(app, look, stored, R.layout.widget_record, cover) { squareArtwork(it, animate) } else null
                    return {
                        if (compact != null) manager.updateAppWidget(compactIds, compact)
                        if (expanded != null) manager.updateAppWidget(expandedIds, expanded)
                        if (record != null) manager.updateAppWidget(square, record)
                    }
                }
                val changed = !stored.audiobook && recordFrames.current?.let { old -> next.slot != recordFrames.slot || old.playing != frame.playing } == true
                val still = render(false)
                val animated = if (changed) render(true) else still
                val publish: () -> Unit = {
                    settleJob?.cancel()
                    pendingSteady = null
                    recordFrames = if (stored.audiobook) WidgetRecordFrames() else next
                    animated()
                    if (changed) {
                        pendingSteady = still
                        // One bounded update after the launcher finishes its native animation.
                        // No frame timers, playback rotation, or periodic work for the square.
                        settleJob = container.scope.launch { delay(600); settle() }
                    }
                }
                publish
            }
        }

        private var settleJob: Job? = null
        private var pendingSteady: (() -> Unit)? = null

        private fun settle() {
            val publish = pendingSteady ?: return
            pendingSteady = null
            settleJob?.cancel()
            settleJob = null
            publish()
        }

        private val latestUpdate = LatestWidgetUpdate()
        private data class RecordFrame(val id: String?, val name: String, val cover: Bitmap?, val playing: Boolean)
        private var recordFrames = WidgetRecordFrames<RecordFrame>()
        private class Snapshot(private val values: Map<String, *>, val audiobook: Boolean = false) {
            fun getString(key: String, default: String?): String? = values[key] as? String ?: default
            fun getBoolean(key: String, default: Boolean) = values[key] as? Boolean ?: default
            fun getLong(key: String, default: Long) = values[key] as? Long ?: default
        }

        private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

        private fun fraction(position: Long, duration: Long) =
            if (duration <= 0) 0 else (position * PROGRESS_MAX / duration).toInt().coerceIn(0, PROGRESS_MAX)

        private fun views(app: Context, look: Look, stored: Snapshot, layout: Int, cover: Bitmap?, artwork: (RemoteViews) -> Unit): RemoteViews {
            val square = layout == R.layout.widget_record
            val context = Appearance.localized(app)
            val title = stored.getString(TITLE, null)
            val idle = title == null
            val playing = stored.getBoolean(PLAYING, false)
            val liked = stored.getBoolean(LIKED, false)
            val tone = cover?.takeIf { look.coverTone || look.colorway == Colorway.Cover }?.let { bitmap ->
                val edge = PlayerBackdropSettings.sampleEdge
                val sample = Bitmap.createScaledBitmap(bitmap, edge, edge, true)
                IntArray(edge * edge).also { sample.getPixels(it, 0, edge, 0, 0, edge, edge) }
                    .let(::playerBackdropTone)
            }

            val washTone = tone?.takeIf { look.coverTone }?.let { CoverTone(it.hue, it.chroma) }
            val savedSeed = tone?.takeIf { look.colorway == Colorway.Cover && liked }?.let(::coverPaletteSeed)

            return RemoteViews(context.packageName, layout).apply {
                tint(R.id.widget_root, "setBackgroundTintList", look) { it.card }
                icon(R.id.widget_wash, look) { palette -> wash(washTone?.color(palette, look.colorway)) }
                artwork(this)

                setTextViewText(R.id.widget_title, title ?: "Caimack")
                colorInt(R.id.widget_title, "setTextColor", look) { it.foreground }
                setTextViewText(R.id.widget_subtitle, stored.getString(ARTIST, null) ?: context.getString(R.string.widget_idle))
                colorInt(R.id.widget_subtitle, "setTextColor", look) { it.muted }

                val open = PendingIntent.getActivity(
                    context, 0,
                    Intent(context, MainActivity::class.java).apply { if (stored.audiobook) action = AudiobookPlayback.OPEN }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE,
                )
                setOnClickPendingIntent(R.id.widget_art, open)
                setOnClickPendingIntent(R.id.widget_text, open)
                if (square) {
                    val label = context.getString(if (playing) R.string.widget_pause else R.string.widget_play)
                    setContentDescription(R.id.widget_art, if (idle) context.getString(R.string.widget_idle) else "$label · $title")
                    val toggle = if (idle) open else WidgetActions.pending(context, WidgetActions.TOGGLE)
                    setOnClickPendingIntent(R.id.widget_root, toggle)
                    setOnClickPendingIntent(R.id.widget_art, toggle)
                    setOnClickPendingIntent(R.id.widget_text, toggle)
                    colorInt(R.id.widget_previous, "setColorFilter", look) { it.foreground }
                    colorInt(R.id.widget_secondary, "setColorFilter", look) { it.foreground }
                    setViewVisibility(R.id.widget_previous, if (idle) View.INVISIBLE else View.VISIBLE)
                    setViewVisibility(R.id.widget_secondary, if (idle) View.INVISIBLE else View.VISIBLE)
                    if (!idle) {
                        button(context, R.id.widget_previous, R.drawable.widget_previous, R.string.player_previous, WidgetActions.PREVIOUS)
                        button(context, R.id.widget_secondary, R.drawable.widget_next, R.string.widget_next, WidgetActions.NEXT)
                    }
                    return@apply
                }

                tint(R.id.widget_primary, "setBackgroundTintList", look) { it.action }
                colorInt(R.id.widget_primary, "setColorFilter", look) { it.onAction }
                tint(R.id.widget_secondary, "setBackgroundTintList", look) { it.raised }
                colorInt(R.id.widget_secondary, "setColorFilter", look) { it.foreground }
                colorInt(R.id.widget_previous, "setColorFilter", look) { it.foreground }
                colorInt(R.id.widget_like, "setColorFilter", look) { palette ->
                    when {
                        !liked -> palette.muted
                        savedSeed != null -> coverPalette(palette.dark, savedSeed).primary
                        else -> palette.primary
                    }
                }

                val playingParts = if (idle) View.GONE else View.VISIBLE
                setViewVisibility(R.id.widget_previous, playingParts)
                setViewVisibility(R.id.widget_like, if (stored.audiobook) View.GONE else playingParts)
                setViewVisibility(R.id.widget_progress, playingParts)

                if (idle) {
                    val enabled = (app.applicationContext as CaimackApp).container.recommendationsEnabled.value
                    setViewVisibility(R.id.widget_primary, if (enabled) View.VISIBLE else View.GONE)
                    setViewVisibility(R.id.widget_secondary, if (enabled) View.VISIBLE else View.GONE)
                    button(context, R.id.widget_primary, R.drawable.widget_radio, R.string.widget_my_radio, WidgetActions.MY_RADIO)
                    button(context, R.id.widget_secondary, R.drawable.widget_mix, R.string.widget_daily_mix, WidgetActions.DAILY_MIX)
                    return@apply
                }

                setViewVisibility(R.id.widget_primary, View.VISIBLE)
                setViewVisibility(R.id.widget_secondary, View.VISIBLE)
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
            setOnClickPendingIntent(id, WidgetActions.pending(context, action))
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

        private fun bookArtwork(context: Context, look: Look, frame: RecordFrame, scale: Float): (RemoteViews, Boolean) -> Unit {
            val layer = RemoteViews(context.packageName, R.layout.widget_book_art)
            layer.icon(R.id.widget_book_cover, look) { palette ->
                val bitmap = Bitmap.createBitmap(ART_HEIGHT, ART_HEIGHT, Bitmap.Config.ARGB_8888)
                val bounds = RectF(0f, 0f, ART_HEIGHT.toFloat(), ART_HEIGHT.toFloat())
                Canvas(bitmap).apply {
                    scale(scale, scale, bounds.centerX(), bounds.centerY())
                    clipPath(Path().apply { addRoundRect(bounds, 18f, 18f, Path.Direction.CW) })
                    val image = frame.cover
                    if (image != null) drawBitmap(image, coverCrop(image), bounds, Paint(Paint.FILTER_BITMAP_FLAG))
                    else {
                        drawColor(app.caimack.ui.sleeveColor(frame.name, palette).toArgb())
                        val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                            color = palette.foreground.toArgb()
                            textSize = ART_HEIGHT * .32f
                            textAlign = Paint.Align.CENTER
                        }
                        drawText(app.caimack.ui.sleeveLetter(frame.name).orEmpty(), bounds.centerX(),
                            bounds.centerY() - (ink.ascent() + ink.descent()) / 2, ink)
                    }
                }
                bitmap
            }
            return { views, _ ->
                views.removeAllViews(R.id.widget_art)
                views.addStableView(R.id.widget_art, layer, 1)
            }
        }

        private fun artwork(context: Context, look: Look, frames: WidgetRecordFrames<RecordFrame>, reverse: Boolean): (RemoteViews, Boolean) -> Unit {
            val previous = recordFrames
            val iconsByFrame = mutableMapOf<RecordFrame, Array<Icon>>()
            val layers = frames.frames.map { frame -> iconsByFrame.getOrPut(frame) {
                val dayCover = frame.cover ?: coverPlaceholder(frame.name, look.day)
                val nightCover = frame.cover ?: if (look.day === look.night) dayCover else coverPlaceholder(frame.name, look.night)
                fun layer(palette: Palette, disc: Boolean) = Icon.createWithBitmap(art(
                    if (palette === look.day) dayCover else nightCover, palette, disc,
                ))
                val daySleeve = layer(look.day, false)
                val dayDisc = layer(look.day, true)
                val nightSleeve = if (look.day === look.night) daySleeve else layer(look.night, false)
                val nightDisc = if (look.day === look.night) dayDisc else layer(look.night, true)
                arrayOf(daySleeve, nightSleeve, dayDisc, nightDisc)
            } }
            return { views, animate ->
                // RemoteViews cannot change a ViewFlipper's animations at runtime. Recycle
                // a nested layout with the requested direction and retain both record slots.
                val layer = RemoteViews(context.packageName, if (reverse) R.layout.widget_record_reverse else R.layout.widget_record_forward)
                frames.frames.forEachIndexed { index, frame ->
                    val sleeve = if (index == 0) R.id.widget_sleeve_a else R.id.widget_sleeve_b
                    val disc = if (index == 0) R.id.widget_disc_image_a else R.id.widget_disc_image_b
                    val flipper = if (index == 0) R.id.widget_disc_a else R.id.widget_disc_b
                    val icons = layers[index]
                    layer.setIcon(sleeve, "setImageIcon", icons[0], icons[1])
                    layer.setIcon(disc, "setImageIcon", icons[2], icons[3])
                    val empty = if (index == 0) R.id.widget_disc_empty_a else R.id.widget_disc_empty_b
                    // Selecting the same ViewFlipper child restarts its animation. Use visibility
                    // for a steady state, and animate only a real play/pause transition.
                    val old = previous.frames.getOrNull(index)
                    if (animate && frames.slot == previous.slot && index == frames.slot && old != null && old.playing != frame.playing) {
                        layer.setDisplayedChild(flipper, if (frame.playing) 1 else 0)
                    } else {
                        layer.setViewVisibility(empty, if (frame.playing) View.GONE else View.VISIBLE)
                        layer.setViewVisibility(disc, if (frame.playing) View.VISIBLE else View.GONE)
                    }
                }
                if (animate && previous.current != null && frames.slot != previous.slot) {
                    // A direction change may inflate a fresh flipper. Restore its outgoing
                    // child before starting the transition in either direction.
                    layer.setViewVisibility(R.id.widget_record_a, if (previous.slot == 0) View.VISIBLE else View.GONE)
                    layer.setViewVisibility(R.id.widget_record_b, if (previous.slot == 1) View.VISIBLE else View.GONE)
                    layer.setDisplayedChild(R.id.widget_art_tracks, frames.slot)
                    // ViewAnimator marks the outgoing child GONE. In a freshly inflated
                    // direction layout it would then never be laid out (0×0), so its exit
                    // animation has nothing to draw. INVISIBLE still participates in layout;
                    // ViewGroup draws it while the exit animation runs, then hides it.
                    layer.setViewVisibility(if (previous.slot == 0) R.id.widget_record_a else R.id.widget_record_b, View.INVISIBLE)
                } else {
                    layer.setViewVisibility(R.id.widget_record_a, if (frames.slot == 0) View.VISIBLE else View.GONE)
                    layer.setViewVisibility(R.id.widget_record_b, if (frames.slot == 1) View.VISIBLE else View.GONE)
                }
                views.removeAllViews(R.id.widget_art)
                views.addStableView(R.id.widget_art, layer, 0)
            }
        }

        private fun art(cover: Bitmap?, palette: Palette, disc: Boolean): Bitmap {
            val bitmap = Bitmap.createBitmap(ART_WIDTH, ART_HEIGHT, Bitmap.Config.ARGB_8888).apply {
                // Remote ImageViews measure both layers from the same, sufficiently large
                // intrinsic size before scaling them to the available widget space.
                density = android.util.DisplayMetrics.DENSITY_DEFAULT
            }
            val canvas = Canvas(bitmap)
            val edge = ART_HEIGHT - 16f
            val top = 8f
            if (disc) {
                val x = edge * 0.86f
                val y = top + edge / 2
                val radius = edge * 0.47f
                // Keep the disc's shadow close enough to fit inside the sleeve when hidden.
                canvas.clipPath(Path().apply { addCircle(x, y, radius + 4f, Path.Direction.CW) })
                drawVinyl(canvas, x, y, radius, cover, palette)
                return bitmap
            }

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
        val playback = container.audiobookPlayback.state.value.takeIf { container.audiobooksEnabled.value }
        if (playback != null) {
            val book = container.audiobookStore.state.value.books.find { it.id == playback.bookId } ?: return
            when (intent.action) {
                TOGGLE -> container.audiobookPlayback.toggle(book)
                NEXT -> container.audiobookPlayback.skipChapter(true)
                PREVIOUS -> container.audiobookPlayback.skipChapter(false)
            }
            return
        }
        val player = container.player

        when (intent.action) {
            TOGGLE -> player.toggle()
            NEXT -> { NowPlayingWidget.navigation(context, previous = false); player.next() }
            PREVIOUS -> { NowPlayingWidget.navigation(context, previous = true); player.previous() }
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
        internal fun pending(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(
            context, action.hashCode(), Intent(context, WidgetActions::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE,
        )

        const val TOGGLE = "app.caimack.widget.TOGGLE"
        const val NEXT = "app.caimack.widget.NEXT"
        const val PREVIOUS = "app.caimack.widget.PREVIOUS"
        const val LIKE = "app.caimack.widget.LIKE"
        const val MY_RADIO = "app.caimack.widget.MY_RADIO"
        const val DAILY_MIX = "app.caimack.widget.DAILY_MIX"
    }
}
