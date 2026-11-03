// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import app.caimack.playback.Background
import androidx.core.content.edit
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.rememberLauncherForActivityResult
import android.content.Context
import android.Manifest
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.caimack.R
import app.caimack.api.Track
import app.caimack.api.User
import kotlin.reflect.KClass
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable data object HomeRoute
@Serializable data object SearchRoute
@Serializable data object TracksRoute
@Serializable data object PlaylistsRoute
@Serializable data object FavoritesRoute
@Serializable data object AlbumsRoute
@Serializable data object ArtistsRoute
@Serializable data object GenresRoute
@Serializable data object RecentRoute
@Serializable data object SettingsRoute
@Serializable data object DownloadsRoute
@Serializable data object MapRoute
@Serializable data class AlbumRoute(val id: String)
@Serializable data class ArtistRoute(val id: String)
@Serializable data class PlaylistRoute(val id: String)
@Serializable data class GenreRoute(val id: String, val name: String)
@Serializable data class MixRoute(val kind: String)

private data class Tab(val route: Any, val type: KClass<*>, val label: Int, val icon: ImageVector)

private val library = listOf(
    Tab(PlaylistsRoute, PlaylistsRoute::class, R.string.nav_playlists, Lucide.ListMusic),
    Tab(AlbumsRoute, AlbumsRoute::class, R.string.nav_albums, Lucide.Disc3),
    Tab(ArtistsRoute, ArtistsRoute::class, R.string.nav_artists, Lucide.UsersRound),
    Tab(TracksRoute, TracksRoute::class, R.string.nav_tracks, Lucide.AudioLines),
    Tab(FavoritesRoute, FavoritesRoute::class, R.string.nav_favorites, Lucide.Heart),
    Tab(RecentRoute, RecentRoute::class, R.string.nav_recently_played, Lucide.History),
    Tab(GenresRoute, GenresRoute::class, R.string.nav_genres, Lucide.Tags),
    Tab(MapRoute, MapRoute::class, R.string.nav_map, Lucide.Map),
    Tab(DownloadsRoute, DownloadsRoute::class, R.string.downloads_title, Lucide.Download),
)

private val tabs = listOf(
    Tab(HomeRoute, HomeRoute::class, R.string.nav_home, Lucide.House),
    Tab(SearchRoute, SearchRoute::class, R.string.nav_search, Lucide.Search),
    Tab(PlaylistsRoute, PlaylistsRoute::class, R.string.nav_library, Lucide.LibraryBig),
)

internal fun NavController.openSection(route: Any) {
    // Settings belongs to the account, not to a tab's saved navigation history.
    if (currentDestination?.hasRoute(SettingsRoute::class) == true) popBackStack()
    if (currentDestination?.hasRoute(route::class) == true) return

    // Reselecting an open section returns to its root without duplicating it.
    if (route != HomeRoute && runCatching { getBackStackEntry(route) }.isSuccess) {
        popBackStack(route, inclusive = false)
        return
    }

    navigate(route) {
        popUpTo(HomeRoute) { saveState = true }
        launchSingleTop = true
        // Restoring Home can bring back the screen that was saved above it.
        restoreState = route != HomeRoute
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun App(user: User) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val nav = rememberNavController()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var account by remember { mutableStateOf(false) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    val playback by container.player.state.collectAsStateWithLifecycle()
    val play: (List<Track>, Int) -> Unit = { tracks, index ->
        container.player.play(tracks, index, sourceOf(nav.currentBackStackEntry))
    }

    val full = expanded && playback.current != null
    val libraryDensity by container.appearance.libraryDensity.collectAsStateWithLifecycle()

    val colorway = LocalColorway.current
    val toneEnabled by container.appearance.coverTone.collectAsStateWithLifecycle()
    val tone = rememberCoverTone(playback.current?.takeIf { toneEnabled }?.let { trackCover(it) })
    val toneTarget = if (colorway == Colorway.Graphite && palette.dark) Color.Transparent else tone?.color(palette, colorway) ?: Color.Transparent
    val nowPlayingTone by animateColorAsState(toneTarget, tween(900), label = "tone")

    LaunchedEffect(Unit) { container.player.connect() }

    LaunchedEffect(playback.current == null) {
        if (playback.current == null) expanded = false
    }

    LaunchedEffect(user.id) {
        runCatching { withNetworkRetries { container.api.settings() } }.onSuccess { container.settings.value = it }
    }

    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        val asked = context.getSharedPreferences("permissions", Context.MODE_PRIVATE)
        if (container.playbackPrefs.recapReminder.value && !Background.canNotify(context) && !asked.getBoolean("notifications", false)) {
            asked.edit { putBoolean("notifications", true) }
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    val navigate: (Any) -> Unit = { route ->
        expanded = false
        nav.navigate(route) { launchSingleTop = true }
    }

    SharedTransitionLayout {
    CompositionLocalProvider(
        LocalNowPlayingTransition provides NowPlayingTransition(this, full),
        LocalLibraryDensity provides libraryDensity,
        LocalNavigate provides navigate,
        LocalNowPlayingTone provides nowPlayingTone,
        LocalToneEnabled provides toneEnabled,
        LocalSnackbar provides snackbar,
    ) {
    Scaffold(
        modifier = Modifier
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
            .then(if (full) Modifier.clearAndSetSemantics {} else Modifier),
        containerColor = palette.background,
        contentWindowInsets = WindowInsets(0),
        snackbarHost = {
            SnackbarHost(snackbar) { data ->
                Snackbar(
                    snackbarData = data,
                    shape = Radius.panel,
                    containerColor = palette.raised,
                    contentColor = palette.foreground,
                    actionColor = palette.primary,
                    dismissActionContentColor = palette.muted,
                )
            }
        },
        topBar = { Header(nav, user) { account = true } },
        bottomBar = {
            Column {
                HandoffBar(playback.playing)
                MiniPlayer(playback) { expanded = true }
                BottomBar(nav)
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = HomeRoute, modifier = Modifier.padding(padding)) {
            composable<HomeRoute> { HomeScreen(nav) }
            composable<SearchRoute> { SearchScreen(nav, play) }
            composable<TracksRoute> { TracksScreen(play) }
            composable<PlaylistsRoute> { PlaylistsScreen(nav) }
            composable<FavoritesRoute> { FavoritesScreen(play) }
            composable<AlbumsRoute> { AlbumsScreen(nav) }
            composable<ArtistsRoute> { ArtistsScreen(nav) }
            composable<GenresRoute> { GenresScreen(nav) }
            composable<RecentRoute> { RecentScreen(play) }
            composable<SettingsRoute> { SettingsScreen() }
            composable<DownloadsRoute> { DownloadsScreen(play) }
            composable<MapRoute> { MapScreen() }
            composable<AlbumRoute> { AlbumScreen(it.toRoute<AlbumRoute>().id, nav, play) }
            composable<ArtistRoute> { ArtistScreen(it.toRoute<ArtistRoute>().id, nav, play) }
            composable<PlaylistRoute> { PlaylistScreen(it.toRoute<PlaylistRoute>().id, play) { nav.popBackStack() } }
            composable<GenreRoute> { it.toRoute<GenreRoute>().let { route -> GenreScreen(route.id, route.name, play) } }
            composable<MixRoute> { MixScreen(it.toRoute<MixRoute>().kind, play) }
        }
    }

    AnimatedVisibility(full, enter = fadeIn(tween(360)), exit = fadeOut(tween(NOW_PLAYING_TRANSITION_MS))) {
        CompositionLocalProvider(LocalFullPlayerVisibility provides this) {
            FullPlayer(playback) { expanded = false }
        }
    }
    }
    }

    if (account) {
        ModalBottomSheet(onDismissRequest = { account = false }, containerColor = palette.card) {
            Column(Modifier.navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
                SheetRow(stringResource(R.string.settings_title), Lucide.Settings) {
                    account = false
                    nav.navigate(SettingsRoute) { launchSingleTop = true }
                }
                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = palette.border)
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(32.dp).clip(CircleShape).background(palette.raised), contentAlignment = Alignment.Center) {
                        Text(user.username.take(1).uppercase(), style = Type.tiny.copy(fontWeight = FontWeight.SemiBold))
                    }
                    Text(user.username, style = Type.small.copy(fontWeight = FontWeight.Medium), modifier = Modifier.weight(1f).padding(horizontal = 10.dp))
                    Icon(
                        Lucide.LogOut,
                        stringResource(R.string.sign_out),
                        tint = palette.muted,
                        modifier = Modifier.clip(Radius.row).clickable {
                            account = false
                            Remote.cache.clear()
                            container.player.stop()
                            scope.launch { container.session.logout() }
                        }.padding(8.dp),
                    )
                }
            }
        }
    }
}

@Composable
internal fun SheetRow(label: String, icon: ImageVector, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().clip(Radius.row).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, tint = palette.muted)
        Text(label, style = Type.small.copy(fontWeight = FontWeight.Medium), color = palette.muted)
    }
}

@Composable
private fun Header(nav: NavController, user: User, onAccount: () -> Unit) {
    val palette = LocalPalette.current
    val destination = nav.currentBackStackEntryAsState().value?.destination
    val inLibrary = library.any { destination?.hasRoute(it.type) == true }
    val isSettings = destination?.hasRoute(SettingsRoute::class) == true
    val showBack = isSettings || (!inLibrary && tabs.none { destination?.hasRoute(it.type) == true } && destination != null)

    Column(Modifier.background(palette.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(start = if (showBack) 4.dp else 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (showBack) {
                IconButton(onClick = { nav.popBackStack() }) {
                    Icon(Lucide.ArrowLeft, stringResource(R.string.nav_back), tint = palette.foreground)
                }
            } else {
                BrandMark(palette.foreground, palette.primary, Modifier.size(28.dp))
            }
            if (isSettings) {
                Text(
                    stringResource(R.string.settings_title),
                    style = Type.title.copy(fontSize = 18.sp, letterSpacing = (-0.025).em),
                    modifier = Modifier.padding(start = 8.dp).weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            } else {
                Box(Modifier.padding(start = 8.dp).weight(1f)) {
                    BrandWordmark(palette.foreground, Modifier.width(127.dp).height(24.dp))
                }
            }
            Box(
                Modifier.size(48.dp).clip(CircleShape).clickable(onClickLabel = stringResource(R.string.nav_account), onClick = onAccount),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(32.dp).clip(CircleShape).background(palette.raised), contentAlignment = Alignment.Center) {
                    Text(user.username.take(1).uppercase(), style = Type.tiny.copy(fontWeight = FontWeight.SemiBold))
                }
            }
        }
        if (inLibrary) {
            Tabs {
                library.forEach { entry ->
                    Tab(stringResource(entry.label), destination?.hasRoute(entry.type) == true) { nav.openSection(entry.route) }
                }
            }
        } else {
            HorizontalDivider(color = palette.border)
        }
    }
}

@Composable
internal fun BottomBar(nav: NavController) {
    val palette = LocalPalette.current
    val focus = LocalFocusManager.current
    val entry by nav.currentBackStackEntryAsState()
    val section = remember(entry) {
        val sections = tabs + library
        entry?.destination?.takeIf { destination -> sections.any { destination.hasRoute(it.type) } }
            // Home stays at the bottom of every stack, so check it last.
            ?: (library + tabs.asReversed()).firstNotNullOfOrNull { tab ->
                runCatching { nav.getBackStackEntry(tab.route).destination }.getOrNull()
            }
    }
    val inLibrary = library.any { section?.hasRoute(it.type) == true }
    var libraryIndex by rememberSaveable { mutableIntStateOf(0) }
    LaunchedEffect(section) {
        library.indexOfFirst { section?.hasRoute(it.type) == true }.takeIf { it >= 0 }?.let { libraryIndex = it }
    }

    Column(Modifier.background(palette.card).navigationBarsPadding()) {
        HorizontalDivider(color = palette.border)
        Row(Modifier.fillMaxWidth().height(62.dp).selectableGroup()) {
            tabs.forEach { tab ->
                val active = if (tab.route == PlaylistsRoute) inLibrary else section?.hasRoute(tab.type) == true
                TabItem(stringResource(tab.label), tab.icon, active) {
                    focus.clearFocus()
                    nav.openSection(if (tab.route == PlaylistsRoute) library[libraryIndex].route else tab.route)
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(label: String, icon: ImageVector, active: Boolean, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Column(
        Modifier.weight(1f).fillMaxSize().selectable(selected = active, role = Role.Tab, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        Box(
            Modifier.clip(CircleShape).background(if (active) palette.primarySoft else Color.Transparent).padding(horizontal = 18.dp, vertical = 4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = if (active) palette.primary else palette.muted)
        }
        Text(
            label,
            style = Type.micro.copy(fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal),
            color = if (active) palette.foreground else palette.muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun sourceOf(entry: NavBackStackEntry?): String? {
    val destination = entry?.destination ?: return null
    return when {
        destination.hasRoute(HomeRoute::class) -> "home"
        destination.hasRoute(AlbumRoute::class) -> "album"
        destination.hasRoute(ArtistRoute::class) -> "artist"
        destination.hasRoute(PlaylistRoute::class) -> "playlist"
        destination.hasRoute(MixRoute::class) -> "mix:${entry.toRoute<MixRoute>().kind}"
        destination.hasRoute(GenreRoute::class) -> "genre"
        destination.hasRoute(FavoritesRoute::class) -> "favorites"
        destination.hasRoute(RecentRoute::class) -> "history"
        destination.hasRoute(SearchRoute::class) -> "search"
        destination.hasRoute(TracksRoute::class) -> "tracks"
        destination.hasRoute(DownloadsRoute::class) -> "downloads"
        else -> null
    }
}
