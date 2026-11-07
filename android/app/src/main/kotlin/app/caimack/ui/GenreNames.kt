// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.caimack.R
import app.caimack.api.Genre
import java.util.Locale

private fun normalizedGenre(name: String) = name.lowercase(Locale.ROOT).replace(Regex("[^\\p{L}\\p{N}]"), "")
private val genreNames = mapOf(
    "allrock" to "Rock", "bassgenre" to "Bass music", "bestofjazz" to "Jazz essentials",
    "bigbands" to "Big bands", "classicalmasterpieces" to "Classical masterpieces",
    "classicmetal" to "Classic metal", "conjazz" to "Contemporary jazz", "deathmetal" to "Death metal",
    "edmgenre" to "Electronic", "epicmetal" to "Epic metal", "folkrock" to "Folk rock",
    "foreignbard" to "International songwriters", "foreignrap" to "International rap",
    "gothicmetal" to "Gothic metal", "hardrock" to "Hard rock", "japanesepop" to "Japanese pop",
    "latinfolk" to "Latin folk", "localindie" to "Local indie", "metalcoregenre" to "Metalcore",
    "numetal" to "Nu metal", "phonkgenre" to "Phonk", "rusestrada" to "Russian variety",
    "ruspop" to "Russian pop", "rusrap" to "Russian rap", "rusrock" to "Russian rock",
    "alternativemetal" to "Alternative metal", "electronics" to "Electronic", "rnb" to "R&B",
    "rnr" to "Rock and roll", "prog" to "Progressive rock", "dnb" to "Drum and bass",
    "idm" to "IDM", "edm" to "EDM", "kpop" to "K-pop", "postpunk" to "Post-punk",
    "postrock" to "Post-rock", "newwave" to "New wave",
)

internal fun readableGenre(name: String): String = genreNames[normalizedGenre(name)]
    ?: name.replace('_', ' ').replace('-', ' ').trim()
        .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }

@Composable
internal fun genreTitle(name: String): String = when (normalizedGenre(name)) {
    "rock", "allrock" -> stringResource(R.string.genre_rock)
    "pop" -> stringResource(R.string.genre_pop)
    "hiphop" -> stringResource(R.string.genre_hiphop)
    "electronic", "electronics", "edmgenre" -> stringResource(R.string.genre_electronic)
    "jazz" -> stringResource(R.string.genre_jazz)
    "classical" -> stringResource(R.string.genre_classical)
    "metal" -> stringResource(R.string.genre_metal)
    "indie" -> stringResource(R.string.genre_indie)
    "rnb" -> stringResource(R.string.genre_rnb)
    "folk" -> stringResource(R.string.genre_folk)
    else -> readableGenre(name)
}

internal fun previewGenres(genres: List<Genre>, limit: Int = 8): List<Genre> {
    val familiar = listOf("rock", "pop", "rap", "electronics", "jazz", "classical", "metal", "indie")
    return genres.sortedWith(compareBy<Genre> {
        familiar.indexOf(normalizedGenre(it.name)).takeIf { index -> index >= 0 } ?: familiar.size
    }.thenByDescending { it.trackCount }.thenBy { it.name })
        .distinctBy { readableGenre(it.name).lowercase(Locale.ROOT) }.take(limit)
}
