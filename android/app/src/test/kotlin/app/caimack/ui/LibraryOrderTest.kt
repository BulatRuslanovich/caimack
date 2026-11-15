// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui
import org.junit.Assert.assertEquals
import org.junit.Test
class LibraryOrderTest {
    @Test fun filteredReorderKeepsHiddenEntriesInPlace() {
        assertEquals(listOf("favorites", "album:c", "artist:b", "album:a", "downloads"),
            mergeVisibleLibraryOrder(listOf("favorites", "album:a", "artist:b", "album:c", "downloads"), listOf("album:c", "album:a")))
    }
    @Test fun staleKeysAreIgnoredAndNewEntriesRemainVisible() {
        assertEquals(listOf("b", "a", "c"), orderedLibraryKeys(listOf("a", "b", "c"), listOf("b", "gone", "b")))
    }
}
