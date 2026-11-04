// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Density
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TabLayoutTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun captionsStayCentredInTheirTabsWithLargerText() {
        val scale = mutableFloatStateOf(1f)
        val labels = listOf("Карта", "Альбомы", "Треки")
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, scale.floatValue)) {
                CaimackTheme(dark = true) {
                    Tabs { labels.forEach { Tab(it, active = it == labels[0], onClick = {}) } }
                }
            }
        }
        for (fontScale in listOf(1f, 1.3f)) {
            compose.runOnIdle { scale.floatValue = fontScale }
            labels.forEach { label ->
                val tab = compose.onNode(hasText(label) and hasClickAction()).fetchSemanticsNode().boundsInRoot
                val text = compose.onNodeWithText(label, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
                assertEquals("The underline must be centred under its caption", tab.center.x, text.center.x, 1f)
                assertEquals("The caption must be vertically centred", tab.center.y, text.center.y, 1f)
            }
        }
    }
}
