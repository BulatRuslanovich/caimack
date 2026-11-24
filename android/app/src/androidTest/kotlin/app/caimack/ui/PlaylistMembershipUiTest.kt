// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.R
import app.caimack.api.CaimackApi
import app.caimack.api.Playlist
import app.caimack.api.PlaylistMembership
import app.caimack.api.PlaylistMembershipChange
import app.caimack.api.PlaylistMembershipResult
import app.caimack.api.Track
import java.io.IOException
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test

class PlaylistMembershipUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun checkedRowsRetryOnlyTheFailedPlaylist() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val edits = mutableListOf<Pair<String, Boolean>>()
        val hostingPlaylist = Any()
        val hostingKey = "playlist:a"
        Remote.cache[hostingKey] = hostingPlaylist
        val track = Track("track", "Track", "artist", "Artist", durationSeconds = 180)
        val api = Proxy.newProxyInstance(CaimackApi::class.java.classLoader, arrayOf(CaimackApi::class.java)) { proxy, method, args ->
            when (method.name) {
                "equals" -> proxy === args[0]
                "hashCode" -> System.identityHashCode(proxy)
                "toString" -> "Playlist membership test API"
                "playlistMemberships" -> listOf(
                    PlaylistMembership(Playlist("a", "First list"), true),
                    PlaylistMembership(Playlist("b", "Second list"), false),
                    PlaylistMembership(Playlist("c", "Third list"), false),
                )
                "changePlaylistMembership" -> {
                    val id = args[0] as String
                    val change = args[1] as PlaylistMembershipChange
                    assertEquals(listOf(track.id), change.trackIds)
                    val retry = edits.any { it.first == id }
                    edits += id to change.present
                    if (id == "b" && !retry) throw IOException("Request failed")
                    PlaylistMembershipResult(changed = 1, unchanged = 0)
                }
                else -> error("Unexpected call to ${method.name}")
            }
        } as CaimackApi
        var open by mutableStateOf(true)
        compose.setContent {
            CaimackTheme { if (open) PlaylistMembershipSheet(track, api) { open = false } }
        }

        compose.onNodeWithText("First list").assertIsOn().performClick()
        compose.onNodeWithText("Second list").assertIsOff().performClick()
        compose.onNodeWithText("Third list").assertIsOff().performClick()
        compose.onNodeWithText(context.getString(R.string.action_done)).performClick()
        compose.onNodeWithText(context.getString(R.string.playlist_membership_partial)).assertIsDisplayed()
        compose.onNodeWithText("First list").assertIsOff()
        compose.onNodeWithText("Third list").assertIsOn()
        compose.runOnIdle { assertSame(hostingPlaylist, Remote.cache[hostingKey]) }
        compose.onNodeWithText(context.getString(R.string.action_try_again)).performClick()
        compose.runOnIdle {
            assertFalse(open)
            assertEquals(listOf("a" to false, "b" to true, "c" to true, "b" to true), edits)
            assertNull(Remote.cache[hostingKey])
        }
    }
}
