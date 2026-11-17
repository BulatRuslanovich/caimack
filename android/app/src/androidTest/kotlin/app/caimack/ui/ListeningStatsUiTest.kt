// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.R
import app.caimack.api.*
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ListeningStatsUiTest {
    @get:Rule val compose = createComposeRule()
    private val context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val container
        get() = (context.applicationContext as CaimackApp).container

    private val artist = Artist("artist", "Stats artist")
    private val song = Track("song", "Stats song", "artist", "Stats artist", durationSeconds = 180)
    private val week =
        ListeningWeek(
            "2026-11-09",
            "2026-11-15",
            true,
            10500,
            50,
            46,
            26,
            9000,
            listOf(1200, 1800, 2100, 1200, 1800, 1200, 1200),
            listOf(ListeningTrack(song, 5, 900, 2, 3)),
            listOf(ListeningArtist(artist, 20, 7200, 2, 4)),
            2010,
            70,
            69,
        )

    private fun show(
        data: ListeningOverview,
        view: String = "overview",
        open: (String, String) -> Unit = { _, _ -> },
    ) {
        compose.setContent {
            CaimackTheme(dark = true) {
                CompositionLocalProvider(LocalContainer provides container) {
                    ListeningContent(
                        data,
                        view = view,
                        open = open,
                        refresh = {},
                        play = { _, _ -> },
                    )
                }
            }
        }
    }

    @Test
    fun overviewLinksToDetailsAndArchivedWeek() {
        var destination = ""
        val past = week.copy(startDate = "2026-11-02", endDate = "2026-11-08", current = false)
        show(
            ListeningOverview(
                timeZone = "Europe/Moscow",
                retentionDays = 180,
                weeks = listOf(week, past),
            ),
            open = { date, view -> destination = "$date/$view" },
        )
        compose.onNodeWithText("175").performClick()
        assertEquals("2026-11-09/minutes", destination)
        compose
            .onNodeWithText(context.getString(R.string.listening_past_weeks))
            .performScrollTo()
            .assertIsDisplayed()
        compose.onAllNodesWithText(song.title).onLast().performScrollTo().performClick()
        assertEquals("2026-11-02/overview", destination)
    }

    @Test
    fun rankingsShowPositionAndWeeksInTopFive() {
        show(
            ListeningOverview(timeZone = "UTC", retentionDays = 180, weeks = listOf(week)),
            "artists",
        )
        compose.onNodeWithText(artist.name).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.listening_refresh)).assertDoesNotExist()
        compose
            .onNodeWithText(
                context.resources.getQuantityString(R.plurals.listening_top_weeks, 4, 4)
            )
            .assertIsDisplayed()
        compose
            .onNodeWithContentDescription(context.getString(R.string.listening_moved_up, 1))
            .assertExists()
    }

    @Test
    fun firstWeekHasHonestEmptyState() {
        show(
            ListeningOverview(
                timeZone = "UTC",
                retentionDays = 180,
                weeks =
                    listOf(
                        week.copy(
                            listenedSeconds = 0,
                            topTracks = emptyList(),
                            topArtists = emptyList(),
                        )
                    ),
            )
        )
        compose.onNodeWithText(context.getString(R.string.listening_empty)).assertIsDisplayed()
        compose
            .onNodeWithText(context.getString(R.string.listening_refresh))
            .performScrollTo()
            .assertIsDisplayed()
    }
}
