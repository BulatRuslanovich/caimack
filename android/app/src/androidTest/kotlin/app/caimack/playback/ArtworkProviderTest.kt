// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.MediaMetadata
import android.media.session.MediaController
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaSession
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.CaimackApp
import app.caimack.api.Media
import app.caimack.api.Track
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

@OptIn(UnstableApi::class)
class ArtworkProviderTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun syncedArtworkReachesPlatformMediaSession() = runBlocking {
        val container = (context.applicationContext as CaimackApp).container
        val file = File(container.syncStore.directory, "asset-artwork-test-${UUID.randomUUID()}")
        val original = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.MAGENTA) }
        file.outputStream().use { original.compress(Bitmap.CompressFormat.PNG, 100, it) }
        original.recycle()
        var session: MediaSession? = null
        var player: ExoPlayer? = null
        try {
            // Media uses the same file: URI returned by SyncStore.asset, without a server.
            val media = Media(container.server) { file.toURI().toString() }
            val track = Track("artwork-test", "Artwork test", "artist", "Artist", durationSeconds = 1, hasCover = true)
            val item = track.toMediaItem(media)
            val uri = checkNotNull(item.mediaMetadata.artworkUri)
            assertEquals("content", uri.scheme)
            assertEquals("synced", uri.pathSegments.first())
            context.contentResolver.openInputStream(uri).use {
                val bitmap = checkNotNull(BitmapFactory.decodeStream(it))
                assertEquals(Color.MAGENTA, bitmap.getPixel(0, 0))
                bitmap.recycle()
            }
            val controller = withContext(Dispatchers.Main) {
                val output = ExoPlayer.Builder(context).build().also { player = it }
                val built = MediaSession.Builder(context, output)
                    .setId("artwork-test-${UUID.randomUUID()}")
                    .setBitmapLoader(CacheBitmapLoader(DataSourceBitmapLoader.Builder(context).build()))
                    .build().also { session = it }
                // Do not prepare or play: only publish metadata, without any network or audio.
                output.setMediaItem(item.buildUpon().setUri("https://example.invalid/test.mp3").build())
                MediaController(context, built.platformToken)
            }
            withTimeout(10_000) {
                while (controller.metadata?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) == null) delay(50)
            }
            val bitmap = checkNotNull(controller.metadata?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART))
            assertEquals(Color.MAGENTA, bitmap.getPixel(0, 0))
        } finally {
            withContext(Dispatchers.Main) {
                session?.release()
                player?.release()
            }
            file.delete()
        }
    }

    @Test
    fun remoteArtworkAndMissingCoverKeepTheirExistingUris() {
        val remote = checkNotNull(ArtworkProvider.uriFor("https://example.org/api/albums/abc-def/cover?size=thumb"))
        assertEquals(ArtworkProvider.AUTHORITY, remote.authority)
        assertEquals("/api/albums/abc-def/cover", remote.path)
        assertEquals("thumb", remote.getQueryParameter("size"))
        assertEquals("/placeholder", ArtworkProvider.uriFor(null, "Album")?.path)
        assertNull(ArtworkProvider.uriFor(null))
    }

    @Test
    fun syncedEndpointRejectsPrivateFilesTraversalAndWrites() {
        val base = Uri.Builder().scheme("content").authority(ArtworkProvider.AUTHORITY).appendPath("synced").build()
        val uris = listOf(
            base.buildUpon().appendPath("snapshot.json").build(),
            base.buildUpon().appendPath("asset-ignored/../snapshot.json").build(),
        )
        for (uri in uris) {
            assertThrows(FileNotFoundException::class.java) { context.contentResolver.openFileDescriptor(uri, "r")?.close() }
        }
        val uri = checkNotNull(ArtworkProvider.uriFor(null, "Album"))
        assertThrows(FileNotFoundException::class.java) { context.contentResolver.openFileDescriptor(uri, "w")?.close() }
        assertEquals("/placeholder", ArtworkProvider.uriFor(File(context.filesDir, "queue.json").toURI().toString(), "Album")?.path)
    }
}
