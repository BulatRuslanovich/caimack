// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.RadioBatch
import app.caimack.api.RecommendedTrack
import app.caimack.api.Track
import app.caimack.playback.PlayerState
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class RadioHeroTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun startingAndPausingRadioKeepTheHeroAndPlayButtonInPlace() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = (context.applicationContext as CaimackApp).container
        val states = container.player.state as MutableStateFlow<PlayerState>
        val previous = states.value
        val previousRadio = container.radio.state.value
        val songs = listOf(Track("hero-test", "A very long title that must fit in the fixed footer", "artist", "Artist", durationSeconds = 200))
        compose.mainClock.autoAdvance = false
        try {
            states.value = PlayerState()
            container.radio.reset()
            compose.setContent {
                CaimackTheme(dark = true) {
                    CompositionLocalProvider(LocalContainer provides container) { RadioHero(songs) }
                }
            }
            compose.mainClock.advanceTimeBy(1000)
            val hero = compose.onNodeWithTag("personal-radio").fetchSemanticsNode().boundsInRoot
            val button = compose.onNodeWithTag("radio-toggle").fetchSemanticsNode().boundsInRoot
            assertTrue(button.height / context.resources.displayMetrics.density >= 48f)
            for (playing in listOf(true, false)) {
                compose.runOnIdle {
                    container.radio.start(null, RadioBatch(songs.map { RecommendedTrack(it) }))
                    states.value = PlayerState(queue = songs, playing = playing)
                }
                compose.mainClock.advanceTimeBy(1000)
                assertEquals(hero, compose.onNodeWithTag("personal-radio").fetchSemanticsNode().boundsInRoot)
                assertEquals(button.top, compose.onNodeWithTag("radio-toggle").fetchSemanticsNode().boundsInRoot.top, 0.5f)
            }
            // A song can also be played manually after it has appeared in radio.
            compose.runOnIdle { container.radio.reset() }
            compose.mainClock.advanceTimeBy(1000)
            compose.onNodeWithTag("radio-toggle").assertContentDescriptionEquals(
                "${context.getString(R.string.radio_mine)}: ${context.getString(R.string.radio_hero_start)}",
            )
        } finally {
            compose.runOnIdle {
                states.value = previous
                container.radio.restore(previousRadio)
            }
        }
    }
}
