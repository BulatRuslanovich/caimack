// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
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
@OptIn(ExperimentalLayoutApi::class)
internal fun LibraryScopeSelector(nav: NavController, saved: Boolean) {
    val palette = LocalPalette.current
    Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).width(IntrinsicSize.Max)) {
        // The track is inset inside full touch targets; large labels wrap as whole segments.
        Box(Modifier.matchParentSize().padding(vertical = 4.dp).clip(Radius.panel).background(palette.card))
        FlowRow(Modifier.selectableGroup()) {
            listOf(true to R.string.collection_saved, false to R.string.collection_catalog).forEach { (isSaved, label) ->
                val active = saved == isSaved
                Box(
                    Modifier.heightIn(min = 48.dp).clip(Radius.panel)
                        .selectable(selected = active, role = Role.Tab) {
                            if (!active) nav.openLibraryArea(if (isSaved) LibraryRoute else TracksRoute)
                        }.padding(horizontal = 3.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.clip(Radius.row)
                            .then(if (active) Modifier.background(palette.raised).border(1.dp, palette.borderStrong, Radius.row) else Modifier)
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(stringResource(label), style = Type.small.copy(fontWeight = FontWeight.Medium),
                            color = if (active) palette.foreground else palette.muted)
                    }
                }
            }
        }
    }
}

/** A compact visual capsule with an explicit, non-overlapping 48dp touch target. */
@Composable
private fun LibraryCategory(label: String, active: Boolean, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Box(
        Modifier.heightIn(min = 48.dp).clip(CircleShape)
            .selectable(selected = active, role = Role.Tab, onClick = onClick)
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.clip(CircleShape).background(if (active) palette.selection else palette.raised)
                .then(if (active) Modifier.border(1.dp, palette.primary, CircleShape) else Modifier)
                .padding(horizontal = 12.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(label, style = Type.small.copy(fontWeight = FontWeight.Medium),
                color = if (active) palette.primary else palette.foreground)
        }
    }
}

@Composable
internal fun LibraryCatalogFrame(nav: NavController, route: Any, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        LibraryScopeSelector(nav, saved = false)
        LazyRow(Modifier.fillMaxWidth().selectableGroup(), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(
                TracksRoute to R.string.nav_tracks, AlbumsRoute to R.string.nav_albums,
                ArtistsRoute to R.string.nav_artists, PlaylistsRoute to R.string.nav_playlists,
                GenresRoute to R.string.nav_genres,
            ).forEach { (destination, label) ->
                item {
                    LibraryCategory(stringResource(label), active = route == destination) { nav.openLibraryArea(destination) }
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) { content() }
    }
}
