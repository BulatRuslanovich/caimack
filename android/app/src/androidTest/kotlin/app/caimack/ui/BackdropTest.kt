// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class BackdropTest {
    @get:Rule val compose = createComposeRule()

    private var visible by mutableStateOf(true)
    private var url by mutableStateOf("")

    private fun start(): File {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File.createTempFile("backdrop-", ".png", context.cacheDir)
        val bitmap = Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.RED)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        url = file.toURI().toString()
        compose.setContent {
            CaimackTheme(dark = true) {
                Box(Modifier.size(160.dp).background(Color.Blue).testTag("background")) {
                    if (visible) ArtBackdrop(url, BackdropMode.Stage, Modifier.matchParentSize())
                }
            }
        }
        compose.waitUntil(timeoutMillis = 5_000) { centerColor().let { it.red > it.blue * 2 } }
        return file
    }

    private fun centerColor(): Color {
        val pixels = compose.onNodeWithTag("background").captureToImage().toPixelMap()
        return pixels[pixels.width / 2, pixels.height / 2]
    }

    @Test fun returningToACachedBackdropDoesNotStartFromTransparent() {
        val file = start()
        try {
            val loaded = centerColor()
            compose.runOnIdle { visible = false }
            compose.waitForIdle()
            compose.mainClock.autoAdvance = false
            compose.runOnIdle { visible = true }
            compose.mainClock.advanceTimeByFrame()
            val returned = centerColor()
            assertEquals(loaded.red, returned.red, 0.02f)
            assertEquals(loaded.blue, returned.blue, 0.02f)
        } finally {
            file.delete()
        }
    }

    @Test fun anUnavailableNewCoverDoesNotKeepThePreviousImage() {
        val file = start()
        try {
            compose.mainClock.autoAdvance = false
            compose.runOnIdle { url = File(file.parentFile, "missing-${file.name}").toURI().toString() }
            compose.mainClock.advanceTimeByFrame()
            val changed = centerColor()
            assertTrue("The previous red artwork must not remain: $changed", changed.blue > changed.red * 2)
        } finally {
            file.delete()
        }
    }
}
