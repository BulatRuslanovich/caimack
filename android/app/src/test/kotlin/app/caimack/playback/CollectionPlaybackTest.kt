// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.playback

import org.junit.Assert.*
import org.junit.Test

class CollectionPlaybackTest {
    @Test fun shuffledAndReorderedCollectionsStayActive() {
        assertTrue(matchesCollection(listOf("a", "b", "c"), listOf("c", "a", "b"), "a"))
    }

    @Test fun sharingTheCurrentSongDoesNotMakeAnotherCollectionActive() {
        assertFalse(matchesCollection(listOf("a", "b"), listOf("a", "c"), "a"))
    }

    @Test fun duplicateOccurrenceCountsMustMatch() {
        assertTrue(matchesCollection(listOf("a", "a", "b"), listOf("b", "a", "a"), "b"))
        assertFalse(matchesCollection(listOf("a", "a", "b"), listOf("b", "b", "a"), "a"))
    }

    @Test fun emptyOrInactiveQueuesAreNotPlayingTheCollection() {
        assertFalse(matchesCollection(emptyList(), emptyList(), null))
        assertFalse(matchesCollection(listOf("a"), listOf("a"), null))
        assertFalse(matchesCollection(listOf("a"), listOf("a"), "other"))
    }

    @Test fun automaticRecommendationsDoNotDeactivateThePlayingCollection() {
        assertTrue(matchesCollection(listOf("a", "b"), listOf("b", "a", "radio"), "a", setOf("radio")))
        assertFalse(matchesCollection(listOf("a", "b"), listOf("b", "a", "manual"), "a", setOf("radio")))
        assertFalse(matchesCollection(listOf("a", "b"), listOf("b", "a", "radio"), "radio", setOf("radio")))
    }
}
