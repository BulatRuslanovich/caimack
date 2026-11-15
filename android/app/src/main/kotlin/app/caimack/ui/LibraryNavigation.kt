// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavDestination.Companion.hasRoute
import app.caimack.R

private fun NavController.openLibraryArea(route: Any) {
    if (currentDestination?.hasRoute(route::class) == true) return
    if (runCatching { getBackStackEntry(route) }.isSuccess) popBackStack(route, inclusive = false)
    else navigate(route) { launchSingleTop = true }
}

@Composable
internal fun LibraryScopeSelector(nav: NavController, saved: Boolean) {
    val palette = LocalPalette.current
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().clip(Radius.panel).background(palette.card)
        .padding(4.dp).selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
        listOf(true to R.string.collection_saved, false to R.string.collection_catalog).forEach { (isSaved, label) ->
            Box(Modifier.weight(1f).heightIn(min = 48.dp).clip(Radius.row)
                .background(if (saved == isSaved) palette.raised else androidx.compose.ui.graphics.Color.Transparent)
                .selectable(selected = saved == isSaved, role = Role.Tab) {
                    if (saved != isSaved) nav.openLibraryArea(if (isSaved) LibraryRoute else TracksRoute)
                }.padding(horizontal = 12.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
                Text(stringResource(label), style = Type.small, color = if (saved == isSaved) palette.foreground else palette.muted)
            }
        }
    }
}

@Composable
internal fun LibraryCatalogFrame(nav: NavController, route: Any, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        LibraryScopeSelector(nav, saved = false)
        LazyRow(Modifier.fillMaxWidth().selectableGroup(), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(
                TracksRoute to R.string.nav_tracks, AlbumsRoute to R.string.nav_albums,
                ArtistsRoute to R.string.nav_artists, PlaylistsRoute to R.string.nav_playlists,
                GenresRoute to R.string.nav_genres,
            ).forEach { (destination, label) ->
                item {
                    Chip(stringResource(label), active = route == destination, Modifier.heightIn(min = 48.dp)) { nav.openLibraryArea(destination) }
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) { content() }
    }
}
