// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.audiobooks

import org.junit.Assert.assertEquals
import org.junit.Test

class AudiobookProgressTest {
    private val first = AudiobookChapter("one", "One", 120_000, 1, "/one")
    private val second = AudiobookChapter("two", "Two", 150_000, 1, "/two")
    private val book = Audiobook("book", "Book", durationMs = 270_000, chapters = listOf(first, second))

    @Test fun lateCatalogResponseKeepsTheNewerChapter() {
        val remote = AudiobookProgress(first.id, 55_000, updatedAtMs = 10)
        val locallyKnown = AudiobookProgress(second.id, 2_000, updatedAtMs = 25)
        val merged = book.copy(progress = remote).withLatestProgress(locallyKnown)
        assertEquals(locallyKnown, merged.progress)
        assertEquals(122_000L, merged.elapsedMs(locallyKnown))
    }

    @Test fun oldLocalWriteCannotReplaceLaterServerProgress() {
        val remote = AudiobookProgress(second.id, 1_000, updatedAtMs = 40)
        val local = AudiobookProgress(first.id, 55_000, updatedAtMs = 25)
        assertEquals(remote, book.copy(progress = remote).withLatestProgress(local).progress)
    }

    @Test fun checkpointForRemovedChapterDoesNotOverrideCurrentChapter() {
        val remote = AudiobookProgress(first.id, 55_000, updatedAtMs = 25)
        val removed = AudiobookProgress("removed", 1_000, updatedAtMs = 40)
        assertEquals(remote, book.copy(progress = remote).withLatestProgress(removed).progress)
    }
}
