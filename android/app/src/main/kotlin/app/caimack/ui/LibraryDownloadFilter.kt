// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import app.caimack.api.LibraryFolder
import app.caimack.api.LibraryItem

/** Include ancestors so downloaded collections remain reachable in nested folders. */
internal fun libraryFolderAncestors(items: List<LibraryItem>, folders: List<LibraryFolder>): Set<String> {
    val parents = folders.associate { it.id to it.parentId }
    return buildSet {
        items.forEach { item ->
            var id = item.folderId
            while (id != null && id in parents && add(id)) id = parents[id]
        }
    }
}
