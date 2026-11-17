// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.widget

import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetHostView
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.RectF
import android.graphics.drawable.BitmapDrawable
import android.os.Bundle
import android.view.View
import android.view.animation.Animation
import android.view.animation.AnimationUtils
import android.view.animation.Transformation
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ViewFlipper
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.api.Track
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Exercise RemoteViews through the system widget service, including launcher reapply. */
class NowPlayingWidgetDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun inkBounds(view: ImageView, minimumAlpha: Int): RectF {
        val drawable = view.drawable as BitmapDrawable
        val bitmap = drawable.bitmap
        var left = bitmap.width
        var top = bitmap.height
        var right = 0
        var bottom = 0
        for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
            if (Color.alpha(bitmap.getPixel(x, y)) >= minimumAlpha) {
                left = minOf(left, x); top = minOf(top, y)
                right = maxOf(right, x + 1); bottom = maxOf(bottom, y + 1)
            }
        }
        assertTrue("Artwork must have visible pixels", right > left && bottom > top)
        val sx = drawable.bounds.width().toFloat() / bitmap.width
        val sy = drawable.bounds.height().toFloat() / bitmap.height
        return RectF(left * sx, top * sy, right * sx, bottom * sy).also { view.imageMatrix.mapRect(it) }
    }

    /** Check actual rendered pixels at both ends and throughout the native slide. */
    private fun assertDiscOnlyEmergesFromTheRight(host: AppWidgetHostView) {
        val image = host.findViewById<ImageView>(R.id.widget_disc_image_a)
        val sleeve = host.findViewById<ImageView>(R.id.widget_sleeve_a)
        val cover = inkBounds(sleeve, 250).apply { offset(sleeve.left.toFloat(), sleeve.top.toFloat()) }
        val disc = inkBounds(image, 16)
        for (resource in listOf(R.anim.widget_disc_out, R.anim.widget_disc_in)) {
            val slide = AnimationUtils.loadAnimation(host.context, resource)
            val parent = image.parent as View
            slide.initialize(image.width, image.height, parent.width, parent.height)
            slide.startTime = 0
            for (time in listOf(0L, 110L, 275L, 440L, 550L)) {
                val transformation = Transformation()
                slide.getTransformation(time, transformation)
                val bounds = RectF(disc).also { transformation.matrix.mapRect(it) }
                bounds.offset(image.left.toFloat() + parent.left, image.top.toFloat() + parent.top)
                val message = "Disc must not peek out on the left ($resource at $time ms): $bounds vs $cover"
                assertTrue(message, bounds.left >= cover.left - 1f)
                assertTrue(message, bounds.top >= cover.top - 1f && bounds.bottom <= cover.bottom + 1f)
                val hidden = if (resource == R.anim.widget_disc_out) time == 0L else time == 550L
                if (hidden) assertTrue("Hidden disc must fit completely inside sleeve: $bounds vs $cover", bounds.right <= cover.right + 1f)
            }
        }
    }

    /** Verify the actual screen, including Android's disappearing-child drawing path. */
    private fun assertBothCoversOnScreen(host: AppWidgetHostView, incomingId: Int, outgoingId: Int) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val location = IntArray(2)
        var width = 0
        var height = 0
        val animations = mutableListOf<Animation>()
        instrumentation.runOnMainSync {
            val flipper = host.findViewById<ViewFlipper>(R.id.widget_art_tracks)
            flipper.getLocationOnScreen(location)
            width = flipper.width
            height = flipper.height
            for (id in listOf(incomingId, outgoingId)) {
                val frame = host.findViewById<View>(id)
                val animation = frame.animation
                assertNotNull(animation)
                animation.initialize(frame.width, frame.height, flipper.width, flipper.height)
                animation.duration = 3_000
                animation.startTime = AnimationUtils.currentAnimationTimeMillis() - 1_000
                animations += animation
                frame.invalidate()
            }
            flipper.invalidate()
        }
        try {
            Thread.sleep(100) // let the window renderer produce the intermediate frame
            val screen = instrumentation.uiAutomation.takeScreenshot()!!
            java.io.File(host.context.getExternalFilesDir(null), "widget-screen-transition-$outgoingId.png")
                .outputStream().use { screen.compress(Bitmap.CompressFormat.PNG, 100, it) }
            fun count(color: Int): Int {
                var count = 0
                for (y in location[1].coerceAtLeast(0) until (location[1] + height).coerceAtMost(screen.height)) {
                    for (x in location[0].coerceAtLeast(0) until (location[0] + width).coerceAtMost(screen.width)) {
                        val pixel = screen.getPixel(x, y)
                        if (listOf(0, 8, 16).all { shift -> kotlin.math.abs(((pixel shr shift) and 255) - ((color shr shift) and 255)) <= 8 }) count++
                    }
                }
                return count
            }
            val red = count(Color.rgb(170, 62, 44))
            val blue = count(Color.rgb(38, 104, 190))
            assertTrue("Both old and new covers must be on screen together: red=$red blue=$blue", red > 20 && blue > 20)
        } finally {
            instrumentation.runOnMainSync {
                animations.forEach { it.duration = 300; it.startTime = AnimationUtils.currentAnimationTimeMillis() - 300 }
            }
        }
    }

    private fun assertTrackDirection(host: AppWidgetHostView, incoming: Int, outgoing: Int, fromRight: Boolean) {
        fun translation(id: Int, end: Boolean): Float {
            val view = host.findViewById<View>(id)
            assertTrue("Animating record must be laid out and drawable ($id): ${view.width}×${view.height}", view.width > 0 && view.height > 0)
            assertNotNull("Both the incoming and outgoing record must animate", view.animation)
            val animation = view.animation
            val parent = view.parent as View
            animation.initialize(view.width, view.height, parent.width, parent.height)
            animation.startTime = 0
            val transform = Transformation()
            animation.getTransformation(if (end) animation.duration else 0L, transform)
            val x = FloatArray(2).also { transform.matrix.mapPoints(it) }[0]
            animation.initialize(view.width, view.height, parent.width, parent.height)
            animation.startTime = AnimationUtils.currentAnimationTimeMillis()
            return x
        }
        val start = translation(incoming, end = false)
        val finish = translation(outgoing, end = true)
        if (fromRight) {
            assertTrue("Next record must enter from the right", start > 0)
            assertTrue("Outgoing record must leave to the left", finish < 0)
        } else {
            assertTrue("Previous record must enter from the left", start < 0)
            assertTrue("Outgoing record must leave to the right", finish > 0)
        }
    }

    @Test fun widgetNavigationDirectionSurvivesDuplicatePlaybackEvents() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assertTrue(context.packageName.endsWith(".uitest"))
        val prefs = context.getSharedPreferences("widget", 0)
        fun track(id: String) = Track(id, id, "artist", "Artist", durationSeconds = 180)
        instrumentation.runOnMainSync {
            NowPlayingWidget.show(context, track("two"), true)
            NowPlayingWidget.navigation(context, previous = true)
            NowPlayingWidget.show(context, track("one"), true)
            assertTrue("Previous button must select the reverse layout", prefs.getBoolean("reverse", false))
            NowPlayingWidget.show(context, track("one"), false)
            NowPlayingWidget.show(context, track("one"), true)
            assertTrue("Buffering/playback events must retain the pending transition direction", prefs.getBoolean("reverse", false))
            NowPlayingWidget.navigation(context, previous = false)
            NowPlayingWidget.show(context, track("two"), true)
            assertFalse(prefs.getBoolean("reverse", true))
            prefs.edit().clear().apply()
        }
    }

    @Test fun widgetsResizeAnimateOnlyOnTransitionsAndRetainStateAfterProgress() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assertTrue("Never run widget tests in the user's installed package", context.packageName.endsWith(".uitest"))
        val manager = AppWidgetManager.getInstance(context)
        val host = AppWidgetHost(context, 7301)
        val prefs = context.getSharedPreferences("widget", 0)
        // Distinct solid covers let intermediate-frame assertions identify the old track
        // without sensitivity to filtering at text or illustration edges.
        val coverFiles = listOf("one" to Color.rgb(170, 62, 44), "two" to Color.rgb(38, 104, 190)).associate { (id, color) ->
            val file = java.io.File(context.cacheDir, "widget-cover-$id.png")
            val cover = Bitmap.createBitmap(240, 240, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
            file.outputStream().use { cover.compress(Bitmap.CompressFormat.PNG, 100, it) }
            id to file
        }
        val ids = mutableListOf<Int>()
        val widgets = mutableListOf<AppWidgetHostView>()
        lateinit var root: LinearLayout
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        fun options(width: Int, height: Int) = Bundle().apply {
            putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, width)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, width)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, height)
            putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, height)
        }
        fun publish(track: String = "one", playing: Boolean = true, reverse: Boolean = false) {
            prefs.edit().putString("track", track).putString("title", if (track == "one") "Тёплый свет" else "Новая волна")
                .putString("artist", "Caimack Ensemble").putString("art_name", track)
                .putString("cover", coverFiles.getValue(track).toURI().toString()).putBoolean("playing", playing).putBoolean("reverse", reverse).apply()
            NowPlayingWidget.refresh(context)
        }
        fun awaitState(check: () -> Boolean) {
            compose.waitUntil(10_000) {
                var result = false
                instrumentation.runOnMainSync {
                    root.measure(View.MeasureSpec.makeMeasureSpec(dp(390), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(dp(700), View.MeasureSpec.EXACTLY))
                    root.layout(0, 0, root.measuredWidth, root.measuredHeight)
                    result = check()
                }
                result
            }
        }
        fun widget(index: Int, id: Int): View = widgets[index].findViewById(id)
        try {
            instrumentation.uiAutomation.adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET")
            instrumentation.runOnMainSync {
                root = LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(24), dp(24), dp(24), dp(24))
                    setBackgroundColor(Color.rgb(20, 19, 18))
                }
                compose.activity.setContentView(root)
                host.startListening()
                listOf(
                    Triple(NowPlayingWidget::class.java, 340, 60),
                    Triple(NowPlayingWidget::class.java, 340, 160),
                    Triple(RecordWidget::class.java, 170, 170),
                ).forEach { (provider, width, height) ->
                    val id = host.allocateAppWidgetId().also { ids += it }
                    assertTrue(manager.bindAppWidgetIdIfAllowed(id, ComponentName(context, provider), options(width, height)))
                    val info = manager.getAppWidgetInfo(id)
                    val view = host.createView(context, id, info)
                    view.setPadding(0, 0, 0, 0)
                    root.addView(view, LinearLayout.LayoutParams(dp(width), dp(height)).apply { bottomMargin = dp(20) })
                    widgets += view
                }
                publish()
            }
            awaitState { widgets.all { it.findViewById<TextView>(R.id.widget_title)?.text == "Тёплый свет" } }
            instrumentation.runOnMainSync {
                assertNull(widgets[0].findViewById<View>(R.id.widget_like)) // compact layout selected
                assertNotNull(widgets[1].findViewById<View>(R.id.widget_like))
                assertTrue(widget(2, R.id.widget_art).hasOnClickListeners())
                assertTrue(widget(2, R.id.widget_previous).hasOnClickListeners())
                assertTrue(widget(2, R.id.widget_secondary).hasOnClickListeners())
                widgets.forEach { hostView ->
                    listOf(R.id.widget_art_tracks, R.id.widget_disc_a, R.id.widget_disc_b).forEach { id ->
                        assertFalse(hostView.findViewById<ViewFlipper>(id).isFlipping)
                    }
                    assertEquals(View.VISIBLE, hostView.findViewById<View>(R.id.widget_disc_image_a).visibility)
                    assertDiscOnlyEmergesFromTheRight(hostView)
                }
                publish(playing = false)
            }
            awaitState { widget(2, R.id.widget_disc_image_a).visibility == View.GONE }
            instrumentation.runOnMainSync {
                val disc = widget(2, R.id.widget_disc_image_a)
                assertNotNull("Pause must slide the record into its sleeve", disc.animation)
                assertEquals(550L, disc.animation.duration)
                assertEquals(0, disc.animation.repeatCount)
                publish(playing = true)
            }
            awaitState { widget(2, R.id.widget_disc_image_a).visibility == View.VISIBLE }
            instrumentation.runOnMainSync {
                assertNotNull(widget(2, R.id.widget_disc_image_a).animation)
                publish("two")
            }
            awaitState { widget(2, R.id.widget_record_b).visibility == View.VISIBLE }
            instrumentation.runOnMainSync {
                widgets.forEach { assertTrackDirection(it, R.id.widget_record_b, R.id.widget_record_a, fromRight = true) }
                assertEquals(View.INVISIBLE, widget(2, R.id.widget_record_a).visibility)
            }
            assertBothCoversOnScreen(widgets[0], R.id.widget_record_b, R.id.widget_record_a)
            instrumentation.runOnMainSync {
                publish("one", reverse = true)
            }
            awaitState { widget(2, R.id.widget_record_a).visibility == View.VISIBLE }
            instrumentation.runOnMainSync {
                widgets.forEach { assertTrackDirection(it, R.id.widget_record_a, R.id.widget_record_b, fromRight = false) }
            }
            assertBothCoversOnScreen(widgets[0], R.id.widget_record_a, R.id.widget_record_b)
            instrumentation.runOnMainSync {
                publish("two")
            }
            awaitState { widget(2, R.id.widget_record_b).visibility == View.VISIBLE }
            instrumentation.runOnMainSync {
                widgets.forEach { assertTrackDirection(it, R.id.widget_record_b, R.id.widget_record_a, fromRight = true) }
                widgets.forEach { hostView ->
                    listOf(R.id.widget_record_a, R.id.widget_record_b, R.id.widget_disc_image_a, R.id.widget_disc_image_b).forEach { id ->
                        hostView.findViewById<View>(id).clearAnimation()
                    }
                }
                NowPlayingWidget.progress(context, 45_000, 180_000)
            }
            awaitState { widgets[0].findViewById<android.widget.ProgressBar>(R.id.widget_progress).progress == 250 }
            instrumentation.runOnMainSync {
                assertEquals(250, widgets[1].findViewById<android.widget.ProgressBar>(R.id.widget_progress).progress)
                assertNull(widget(0, R.id.widget_record_b).animation)
                assertNull(widget(2, R.id.widget_record_b).animation)
            }
            // A metadata/appearance refresh must leave the sleeve and disc completely still.
            instrumentation.runOnMainSync {
                widgets.forEach { hostView ->
                    listOf(R.id.widget_record_a, R.id.widget_record_b, R.id.widget_disc_image_a, R.id.widget_disc_image_b).forEach { id ->
                        hostView.findViewById<View>(id).clearAnimation()
                    }
                }
                publish("two")
            }
            instrumentation.waitForIdleSync()
            Thread.sleep(400)
            instrumentation.runOnMainSync {
                assertNull(widget(2, R.id.widget_record_b).animation)
                assertNull(widget(2, R.id.widget_disc_image_b).animation)
                assertEquals(View.VISIBLE, widget(2, R.id.widget_record_b).visibility)
                assertEquals(View.VISIBLE, widget(2, R.id.widget_disc_image_b).visibility)
            }
            // Resize an existing instance in both directions, as the launcher does.
            instrumentation.runOnMainSync { manager.updateAppWidgetOptions(ids[1], options(340, 60)) }
            awaitState { widgets[1].findViewById<View>(R.id.widget_like) == null }
            instrumentation.runOnMainSync { manager.updateAppWidgetOptions(ids[1], options(340, 160)) }
            awaitState { widgets[1].findViewById<View>(R.id.widget_like) != null }
            instrumentation.runOnMainSync {
                val render = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
                root.draw(Canvas(render))
                java.io.File(context.getExternalFilesDir(null), "widgets.png").outputStream().use { render.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            instrumentation.uiAutomation.takeScreenshot()?.let { screenshot ->
                java.io.File(context.getExternalFilesDir(null), "widgets-screen.png").outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        } finally {
            instrumentation.runOnMainSync { host.stopListening(); ids.forEach(host::deleteAppWidgetId) }
            instrumentation.uiAutomation.dropShellPermissionIdentity()
            coverFiles.values.forEach { it.delete() }
        }
    }
}
