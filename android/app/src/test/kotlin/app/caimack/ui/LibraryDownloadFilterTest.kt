// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import app.caimack.api.LibraryFolder
import app.caimack.api.LibraryItem
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryDownloadFilterTest {
    @Test fun nestedDownloadedCollectionsKeepOnlyTheirAncestors() {
        val folders = listOf(
            LibraryFolder("root", "Root", createdAt = ""),
            LibraryFolder("child", "Child", "root", ""),
            LibraryFolder("empty", "Empty", createdAt = ""),
        )
        val saved = listOf(LibraryItem("album", "a", "Album", savedAt = "", folderId = "child"))
        assertEquals(setOf("root", "child"), libraryFolderAncestors(saved, folders))
        assertEquals(emptySet<String>(), libraryFolderAncestors(emptyList(), folders))
    }

    @Test fun malformedFolderCyclesDoNotHangFiltering() {
        val folders = listOf(LibraryFolder("a", "A", "b", ""), LibraryFolder("b", "B", "a", ""))
        val saved = listOf(LibraryItem("album", "a", "Album", savedAt = "", folderId = "a"))
        assertEquals(setOf("a", "b"), libraryFolderAncestors(saved, folders))
    }
}
