// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import com.google.common.util.concurrent.ListenableFuture
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.random.Random
import org.junit.Assert.*
import org.junit.Test

@OptIn(UnstableApi::class)
class QueuePlaybackDeviceTest {
    private fun items(count: Int = 12) = (0 until count).map {
        MediaItem.Builder().setMediaId("track-$it").setUri("file:///queue-test/$it.wav").build()
    }

    private fun ids(player: Player) = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }

    private fun assertVisibleOrder(player: Player) {
        val actual = buildList {
            var index = player.currentTimeline.getFirstWindowIndex(player.shuffleModeEnabled)
            while (index != C.INDEX_UNSET) {
                add(index)
                index = player.currentTimeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, player.shuffleModeEnabled)
            }
        }
        assertEquals("Playback must follow the displayed queue", (0 until player.mediaItemCount).toList(), actual)
    }

    private fun withPlayer(test: (ExoPlayer, QueuePlayback) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val player = ExoPlayer.Builder(instrumentation.targetContext).build()
            try { test(player, QueuePlayback(player, Random(13))) } finally { player.release() }
        }
    }

    @Test fun shuffleCreatesAVisibleRandomQueueAndPreservesThePlayingTrackAndPosition() = withPlayer { player, _ ->
        player.setMediaItems(items())
        player.seekTo(0, 1_337)
        val before = ids(player)
        player.shuffleModeEnabled = true
        assertEquals("track-0", player.currentMediaItem?.mediaId)
        assertEquals(1_337L, player.currentPosition)
        assertEquals(0, player.currentMediaItemIndex)
        assertNotEquals(before, ids(player))
        assertEquals(before.sorted(), ids(player).sorted())
        assertVisibleOrder(player)
        val expectedNext = ids(player)[1]
        player.seekToNextMediaItem()
        assertEquals(expectedNext, player.currentMediaItem?.mediaId)
    }

    @Test fun jumpingAheadKeepsEveryUnvisitedTrackUpcomingInBothModes() {
        for (shuffle in listOf(false, true)) withPlayer { player, queue ->
            player.setMediaItems(items())
            player.shuffleModeEnabled = shuffle
            val before = ids(player)
            queue.jumpTo(8)
            assertEquals(1, player.currentMediaItemIndex)
            assertEquals(before[8], player.currentMediaItem?.mediaId)
            assertEquals(listOf(before[0], before[8]) + before.drop(1).filterIndexed { index, _ -> index != 7 }, ids(player))
            assertVisibleOrder(player)
            player.seekToNextMediaItem()
            assertEquals(before[1], player.currentMediaItem?.mediaId)
        }
    }

    @Test fun repeatedBackSwipesWalkTheWholeHistoryWithoutAlternatingTwoSongs() {
        for (shuffle in listOf(false, true)) withPlayer { player, queue ->
            player.shuffleModeEnabled = shuffle
            player.setMediaItems(preserveQueue(items()), 6, 0)
            val before = ids(player)
            for (expected in 5 downTo 0) {
                queue.jumpTo(player.previousMediaItemIndex)
                assertEquals(expected, player.currentMediaItemIndex)
                assertEquals(before[expected], player.currentMediaItem?.mediaId)
                assertEquals("Navigating backwards must preserve history and upcoming songs", before, ids(player))
                assertVisibleOrder(player)
            }
            assertEquals(C.INDEX_UNSET, player.previousMediaItemIndex)
            player.repeatMode = Player.REPEAT_MODE_ALL
            queue.jumpTo(player.previousMediaItemIndex)
            assertEquals(before.last(), player.currentMediaItem?.mediaId)
            assertEquals(before, ids(player))
            queue.jumpTo(player.nextMediaItemIndex)
            assertEquals(before.first(), player.currentMediaItem?.mediaId)
            assertEquals(before, ids(player))
        }
    }

    @Test fun shuffleRebuildsTheWholeQueueIncludingItsOldHistory() = withPlayer { player, _ ->
        player.setMediaItems(preserveQueue(items()), 3, 2_000)
        val before = ids(player)
        player.shuffleModeEnabled = true
        assertEquals(0, player.currentMediaItemIndex)
        assertEquals(before.sorted(), ids(player).sorted())
        assertTrue(ids(player).drop(1).containsAll(before.take(3)))
        assertNotEquals(before.filter { it != "track-3" }, ids(player).drop(1))
        assertEquals("track-3", player.currentMediaItem?.mediaId)
        assertEquals(2_000L, player.currentPosition)
        assertVisibleOrder(player)
        player.shuffleModeEnabled = false
        assertEquals(before.drop(3) + before.take(3), ids(player))
        assertEquals(2_000L, player.currentPosition)
        assertVisibleOrder(player)
    }

    @Test fun shufflingAtTheLastTrackReturnsEveryOtherSongToTheNewQueue() = withPlayer { player, _ ->
        player.setMediaItems(preserveQueue(items()), 11, 4_000)
        player.shuffleModeEnabled = true
        assertEquals(0, player.currentMediaItemIndex)
        assertEquals("track-11", player.currentMediaItem?.mediaId)
        assertEquals(4_000L, player.currentPosition)
        assertEquals((0 until 11).map { "track-$it" }.sorted(), ids(player).drop(1).sorted())
        assertNotEquals((0 until 11).map { "track-$it" }, ids(player).drop(1))
        assertVisibleOrder(player)
    }

    @Test fun everyNextAndRepeatFollowsTheNewQueueWithoutShufflingItAgain() = withPlayer { player, _ ->
        player.setMediaItems(preserveQueue(items()), 6, 0)
        player.shuffleModeEnabled = true
        val shuffled = ids(player)
        assertEquals("track-6", shuffled.first())
        for (position in 1 until shuffled.size) {
            player.seekToNextMediaItem()
            assertEquals(position, player.currentMediaItemIndex)
            assertEquals(shuffled[position], player.currentMediaItem?.mediaId)
            assertEquals(shuffled, ids(player))
        }
        assertEquals(C.INDEX_UNSET, player.nextMediaItemIndex)
        player.repeatMode = Player.REPEAT_MODE_ALL
        player.seekToNextMediaItem()
        assertEquals(0, player.currentMediaItemIndex)
        assertEquals(shuffled.first(), player.currentMediaItem?.mediaId)
        assertEquals(shuffled, ids(player))
        assertVisibleOrder(player)
    }

    @Test fun aNewQueueWhileShuffleIsEnabledStartsWithTheChosenTrackWithoutInventingHistory() = withPlayer { player, _ ->
        player.shuffleModeEnabled = true
        player.setMediaItems(items(), 7, 0)
        assertEquals("track-7", player.currentMediaItem?.mediaId)
        assertEquals(0, player.currentMediaItemIndex)
        assertEquals(12, ids(player).toSet().size)
        assertNotEquals((8 until 12).map { "track-$it" } + (0 until 7).map { "track-$it" }, ids(player).drop(1))
        assertVisibleOrder(player)
    }

    @Test fun startingAnOrdinaryQueueAtTheMiddleKeepsEarlierUnvisitedSongsForLater() = withPlayer { player, _ ->
        player.setMediaItems(items(5), 2, 0)
        assertEquals(0, player.currentMediaItemIndex)
        assertEquals(listOf("track-2", "track-3", "track-4", "track-0", "track-1"), ids(player))
        assertVisibleOrder(player)
    }

    @Test fun addingRemovingAndDraggingInShuffleModeKeepsTheVisibleNextTrack() = withPlayer { player, _ ->
        player.setMediaItems(items())
        player.shuffleModeEnabled = true
        val before = ids(player)
        player.addMediaItem(1, MediaItem.Builder().setMediaId("manual-next").setUri("file:///queue-test/next.wav").build())
        assertEquals(listOf(before[0], "manual-next") + before.drop(1), ids(player))
        assertEquals(1, player.nextMediaItemIndex)
        player.removeMediaItem(3)
        val remaining = ids(player)
        player.moveMediaItem(remaining.lastIndex, 1)
        assertEquals(listOf(remaining[0], remaining.last()) + remaining.drop(1).dropLast(1), ids(player))
        assertVisibleOrder(player)
    }

    @Test fun replayingHistoryDoesNotConsumeUpcomingSongsAndDuplicateOccurrencesRemainSeparate() = withPlayer { player, queue ->
        val tracks = items(5).toMutableList().apply { this[4] = this[1] }
        player.setMediaItems(preserveQueue(tracks), 2, 0)
        queue.jumpTo(0)
        assertEquals(2, player.currentMediaItemIndex)
        assertEquals(listOf("track-1", "track-2", "track-0", "track-3", "track-1"), ids(player))
        assertEquals(2, ids(player).count { it == "track-1" })
        assertVisibleOrder(player)
    }

    @Test fun restoringAndTakingOverAnExplicitOrderPreservesItsHistoryAndPosition() = withPlayer { player, _ ->
        player.shuffleModeEnabled = true
        val order = listOf(3, 0, 4, 1, 2)
        val (tracks, index) = orderedQueue(items(5), 4, order)
        player.setMediaItems(tracks, index, 4_000)
        assertEquals(order.map { "track-$it" }, ids(player))
        assertEquals(2, player.currentMediaItemIndex)
        assertEquals("track-4", player.currentMediaItem?.mediaId)
        assertEquals(4_000L, player.currentPosition)
        assertVisibleOrder(player)
    }

    @Test fun aLargeShuffledQueueKeepsAllOccurrencesAndUsesTheDisplayedOrder() = withPlayer { player, _ ->
        player.setMediaItems(items(500))
        player.shuffleModeEnabled = true
        assertEquals(500, ids(player).size)
        assertEquals(500, ids(player).toSet().size)
        assertEquals("track-0", player.currentMediaItem?.mediaId)
        assertVisibleOrder(player)
    }

    @Test fun shufflingPreparedAudioKeepsItsBufferAndPlaybackPosition() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val file = File.createTempFile("queue-silence-", ".wav", context.cacheDir)
        val audio = ByteBuffer.allocate(44 + 8_000 * 2 * 15).order(ByteOrder.LITTLE_ENDIAN)
        audio.put("RIFF".toByteArray()).putInt(audio.capacity() - 8).put("WAVEfmt ".toByteArray())
            .putInt(16).putShort(1).putShort(1).putInt(8_000).putInt(16_000).putShort(2).putShort(16)
            .put("data".toByteArray()).putInt(audio.capacity() - 44)
        file.writeBytes(audio.array())
        lateinit var player: ExoPlayer
        val ready = CountDownLatch(1)
        instrumentation.runOnMainSync {
            player = ExoPlayer.Builder(context).build()
            QueuePlayback(player, Random(13))
            player.volume = 0f
            player.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_READY) ready.countDown()
                }
            })
            player.setMediaItems(preserveQueue((0 until 20).map {
                MediaItem.Builder().setMediaId("prepared-$it").setUri(file.toURI().toString()).build()
            }), 7, 1_337)
            player.prepare()
            player.play()
        }
        try {
            assertTrue("Silent audio should become ready", ready.await(10, TimeUnit.SECONDS))
            instrumentation.runOnMainSync {
                val position = player.currentPosition
                player.shuffleModeEnabled = true
                assertEquals(Player.STATE_READY, player.playbackState)
                assertEquals("prepared-7", player.currentMediaItem?.mediaId)
                assertEquals(0, player.currentMediaItemIndex)
                assertTrue(player.currentPosition >= position)
                assertTrue(player.currentPosition - position < 250)
                assertTrue(player.playWhenReady)
                assertVisibleOrder(player)
            }
        } finally {
            instrumentation.runOnMainSync { player.release() }
            file.delete()
        }
    }

    @Test fun queueJumpThroughTheMediaControllerPreservesUnvisitedSongs() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        lateinit var player: ExoPlayer
        lateinit var session: MediaLibrarySession
        lateinit var pending: ListenableFuture<MediaController>
        instrumentation.runOnMainSync {
            player = ExoPlayer.Builder(context).build()
            val queue = QueuePlayback(player, Random(13))
            player.setMediaItems(items())
            val tree = LibraryTree(context, (context.applicationContext as CaimackApp).container, onQueueJump = { index, id ->
                check(player.getMediaItemAt(index).mediaId == id)
                queue.jumpTo(index)
            }) { it }
            session = MediaLibrarySession.Builder(context, player, tree).build()
            pending = MediaController.Builder(context, session.token).buildAsync()
        }
        try {
            val controller = pending.get(10, TimeUnit.SECONDS)
            lateinit var reply: ListenableFuture<SessionResult>
            instrumentation.runOnMainSync {
                reply = controller.sendCustomCommand(SessionCommand(LibraryTree.QUEUE_JUMP, Bundle.EMPTY), Bundle().apply {
                    putInt("index", 8)
                    putString("trackId", "track-8")
                })
            }
            assertEquals(SessionResult.RESULT_SUCCESS, reply.get(10, TimeUnit.SECONDS).resultCode)
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync {
                assertEquals(1, controller.currentMediaItemIndex)
                assertEquals("track-8", controller.currentMediaItem?.mediaId)
                assertEquals("track-1", controller.getMediaItemAt(controller.nextMediaItemIndex).mediaId)
                assertVisibleOrder(player)
            }
        } finally {
            instrumentation.runOnMainSync {
                MediaController.releaseFuture(pending)
                session.release()
                player.release()
            }
        }
    }
}
