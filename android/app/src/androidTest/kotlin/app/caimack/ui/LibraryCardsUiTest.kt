// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class LibraryCardsUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun metadataAndMenuRemainUsableInListAndGrid() {
        var list by mutableStateOf(true)
        var opened = 0
        var menuOpened = 0
        compose.setContent {
            CaimackTheme(dark = true) {
                Column(Modifier.fillMaxWidth().background(LocalPalette.current.background).padding(16.dp)) {
                    Card("Long album title", "Album · Artist · 2024", { opened++ },
                        modifier = if (list) Modifier.fillMaxWidth() else Modifier.width(180.dp),
                        list = list, details = "12 tracks · 42 min",
                        menu = { IconButton(onClick = { menuOpened++ }) { Icon(Lucide.EllipsisVertical, "Collection menu") } },
                    ) { Box(it.background(LocalPalette.current.raised)) }
                }
            }
        }
        for (asList in listOf(true, false)) {
            compose.runOnIdle { list = asList }
            compose.onNodeWithText("Long album title").assertIsDisplayed()
            compose.onNodeWithText("Album · Artist · 2024").assertIsDisplayed()
            compose.onNodeWithText("12 tracks · 42 min").assertIsDisplayed()
            compose.onNodeWithContentDescription("Collection menu").performClick()
            compose.runOnIdle { assertEquals(0, opened) }
            val file = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, if (asList) "library-list.png" else "library-grid.png")
            file.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        compose.runOnIdle { assertEquals(2, menuOpened) }
        compose.onNodeWithText("Long album title").performClick()
        compose.runOnIdle { assertEquals(1, opened) }
    }
}
