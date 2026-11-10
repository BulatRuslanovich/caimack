// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import app.caimack.R

@Composable
fun LibraryScreen(nav: NavController) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = playerContentPadding(bottom = 24.dp)) {
        item { PageTitle(stringResource(R.string.nav_library), stringResource(R.string.library_intro)) }
        item { LibraryShortcuts({ nav.navigate(FavoritesRoute) }, { nav.navigate(DownloadsRoute) }) }
        item { LibraryEntry(stringResource(R.string.nav_tracks), stringResource(R.string.library_tracks_hint), Lucide.AudioLines) { nav.navigate(TracksRoute) } }
        item { LibraryEntry(stringResource(R.string.nav_albums), stringResource(R.string.library_albums_hint), Lucide.Disc3) { nav.navigate(AlbumsRoute) } }
        item { LibraryEntry(stringResource(R.string.nav_artists), stringResource(R.string.library_artists_hint), Lucide.UsersRound) { nav.navigate(ArtistsRoute) } }
        item { LibraryEntry(stringResource(R.string.nav_playlists), stringResource(R.string.library_playlists_hint), Lucide.ListMusic) { nav.navigate(PlaylistsRoute) } }
        item { LibraryEntry(stringResource(R.string.nav_recently_played), null, Lucide.History) { nav.navigate(RecentRoute) } }
        item { LibraryEntry(stringResource(R.string.nav_genres), null, Lucide.Tags) { nav.navigate(GenresRoute) } }
    }
}

@Composable
internal fun LibraryEntry(title: String, hint: String?, icon: ImageVector, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 3.dp).fillMaxWidth()
            .clip(Radius.row).clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 64.dp).padding(vertical = 10.dp, horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(44.dp).clip(Radius.cover).background(palette.card), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = palette.primary, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = Type.body)
            hint?.let { Text(it, style = Type.small, color = palette.muted) }
        }
        Icon(Lucide.ChevronRight, null, tint = palette.muted, modifier = Modifier.size(18.dp))
    }
}
