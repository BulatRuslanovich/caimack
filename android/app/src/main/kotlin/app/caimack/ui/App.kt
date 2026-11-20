// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.FastOutSlowInEasing
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
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
import app.caimack.audiobooks.Audiobook
import app.caimack.playback.PlayerState
import kotlin.reflect.KClass
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable data object HomeRoute
@Serializable
data class SearchRoute(val category: String = "") {
    constructor(category: SearchCategory) : this(category.name)

    fun initialCategory(): SearchCategory? = SearchCategory.entries.firstOrNull { it.name == category }
}
@Serializable data object FavoritesRoute
@Serializable data object RecentRoute
@Serializable data object SettingsRoute
@Serializable data class ListeningRoute(val week: String = "", val view: String = "overview")
@Serializable data object DownloadsRoute
@Serializable data object LibraryRoute
@Serializable data object SavedAudiobooksRoute
@Serializable data class AudiobookRoute(val id: String)
@Serializable data class SettingsSectionRoute(val section: String)
@Serializable data class AlbumRoute(val id: String)
@Serializable data class ArtistRoute(val id: String)
@Serializable data class PlaylistRoute(val id: String)
@Serializable data class GenreRoute(val id: String, val name: String)
@Serializable data class MixRoute(val kind: String)

private data class Tab(val route: Any, val type: KClass<*>, val label: Int, val icon: ImageVector)

private val library = listOf(
    Tab(FavoritesRoute, FavoritesRoute::class, R.string.nav_favorites, Lucide.Heart),
    Tab(RecentRoute, RecentRoute::class, R.string.nav_recently_played, Lucide.History),
    Tab(DownloadsRoute, DownloadsRoute::class, R.string.downloads_title, Lucide.Download),
)

private val tabs = listOf(
    Tab(HomeRoute, HomeRoute::class, R.string.nav_home, Lucide.House),
    Tab(SearchRoute(), SearchRoute::class, R.string.nav_search, Lucide.Search),
    Tab(LibraryRoute, LibraryRoute::class, R.string.nav_library, Lucide.LibraryBig),
)

internal fun NavController.openSection(route: Any) {
    // Settings belongs to the account, not to a tab's saved navigation history.
    while (currentDestination?.let { it.hasRoute(SettingsRoute::class) || it.hasRoute(SettingsSectionRoute::class) || it.hasRoute(ListeningRoute::class) } == true) {
        if (!popBackStack()) break
    }
    if (currentDestination?.hasRoute(route::class) == true) return

    // Reselecting an open section returns to its root without duplicating it.
    if (route != HomeRoute && runCatching { getBackStackEntry(route::class) }.isSuccess) {
        popBackStack(route::class, inclusive = false)
        return
    }

    navigate(route) {
        popUpTo(HomeRoute) { saveState = true }
        launchSingleTop = true
        // Restoring Home can bring back the screen that was saved above it.
        restoreState = route != HomeRoute && route != LibraryRoute
    }
}

@Composable
fun App(user: User, dark: Boolean, colorway: Colorway) {
    val container = LocalContainer.current
    val playback by container.player.state.collectAsStateWithLifecycle()
    val audiobookPlayback by container.audiobookPlayback.state.collectAsStateWithLifecycle()
    val audiobookCatalog by container.audiobookStore.state.collectAsStateWithLifecycle()
    val activeAudiobook by remember(container) {
        derivedStateOf { audiobookCatalog.books.firstOrNull { it.id == audiobookPlayback?.bookId } }
    }
    val activeBookDownloaded by remember(container) {
        derivedStateOf { activeAudiobook?.id in audiobookCatalog.downloaded }
    }
    val bookCover = remember(activeAudiobook?.id, activeAudiobook?.coverUrl, activeBookDownloaded) {
        activeAudiobook?.let(container.audiobookStore::cover)
    }
    val toneEnabled by container.appearance.coverTone.collectAsStateWithLifecycle()
    val artworkRevision by container.downloadedCatalog.revision.collectAsStateWithLifecycle()
    val syncArtworkRevision by container.syncStore.artworkRevision.collectAsStateWithLifecycle()
    val resolveArtwork = remember(container, user.id) { container::cachedArtwork }
    CompositionLocalProvider(
        LocalArtworkRevision provides (artworkRevision + syncArtworkRevision),
        LocalArtworkResolver provides resolveArtwork,
    ) {
        val adaptive = colorway == Colorway.Cover
        val cover = if (toneEnabled || adaptive) {
            if (activeAudiobook != null) bookCover else playback.current?.let { trackCover(it) }
        } else null
        val loadedTone = rememberLoadedPlayerTone(cover)
        val palette = if (adaptive) {
            rememberCoverPalette(dark, cover, loadedTone)
        } else {
            paletteOf(colorway, dark)
        }
        CaimackTheme(dark = dark, colorway = colorway, palette = palette) {
            Surface(Modifier.fillMaxSize()) {
                AppContent(user, playback, activeAudiobook, bookCover, toneEnabled, loadedTone.takeIf { toneEnabled })
            }
        }
    }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun AppContent(
    user: User,
    playback: PlayerState,
    activeAudiobook: Audiobook?,
    bookCover: String?,
    toneEnabled: Boolean,
    loadedTone: LoadedPlayerTone?,
) {
    val palette = LocalPalette.current
    val container = LocalContainer.current
    val nav = rememberNavController()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var account by rememberSaveable { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    var expanded by rememberSaveable { mutableStateOf(false) }
    val offlineLibrary by container.libraryCache.offline.collectAsStateWithLifecycle()
    val audiobookPlayback by container.audiobookPlayback.state.collectAsStateWithLifecycle()
    val openAudiobook by container.audiobookPlayback.openFromNotification.collectAsStateWithLifecycle()
    val bookPlayback = audiobookPlayback?.takeIf { it.bookId == activeAudiobook?.id }
    val catalog by container.localLibrary.collectAsStateWithLifecycle()
    val localLibrary = catalog.takeIf { it.account == container.accountKey } ?: app.caimack.playback.LocalLibrary()
    val availableTracks = localLibrary.trackIds
    val appUpdate by container.updates.state.collectAsStateWithLifecycle()
    var updateDetails by rememberSaveable { mutableStateOf(false) }
    val play: (List<Track>, Int) -> Unit = { tracks, index ->
        val playable = container.playable(tracks)
        if (playable.isNotEmpty()) {
            val selected = tracks.getOrNull(index)?.id
            container.player.play(playable, playable.indexOfFirst { it.id == selected }.coerceAtLeast(0), sourceOf(nav.currentBackStackEntry))
        }
    }

    val hasPlayback = bookPlayback != null || playback.current != null
    val full = expanded && hasPlayback
    val libraryDensity by container.appearance.libraryDensity.collectAsStateWithLifecycle()

    val colorway = LocalColorway.current
    val tone = loadedTone?.tone?.let { CoverTone(it.hue, it.chroma) }
    val toneTarget = if (colorway == Colorway.Graphite && palette.dark) Color.Transparent else tone?.color(palette, colorway) ?: Color.Transparent
    val motion = playerMotionEnabled()
    val nowPlayingTone by animateColorAsState(toneTarget, tween(if (motion) 900 else 0), label = "tone")

    LaunchedEffect(Unit) { container.player.connect() }

    LaunchedEffect(hasPlayback) {
        if (!hasPlayback) expanded = false
    }

    LaunchedEffect(user.id) {
        runCatching { withNetworkRetries { container.api.settings() } }.onSuccess { container.settings.value = it }
    }

    val navigate: (Any) -> Unit = { route ->
        focus.clearFocus()
        account = false
        expanded = false
        nav.navigate(route) { launchSingleTop = true }
    }

    LaunchedEffect(openAudiobook, activeAudiobook?.id) {
        if (openAudiobook && activeAudiobook != null) {
            container.audiobookPlayback.openFromNotification.value = false
            focus.clearFocus()
            account = false
            expanded = true
        }
    }

    SharedTransitionLayout {
    CompositionLocalProvider(
        LocalNowPlayingTransition provides NowPlayingTransition(this, full),
        LocalLibraryDensity provides libraryDensity,
        LocalNavigate provides navigate,
        LocalOfflineLibrary provides offlineLibrary,
        LocalAvailableTracks provides availableTracks,
        LocalAvailableCollections provides localLibrary.collections,
        LocalNowPlayingTone provides nowPlayingTone,
        LocalNowPlayingCoverTone provides loadedTone,
        LocalToneEnabled provides toneEnabled,
        LocalSnackbar provides snackbar,
    ) {
    SettingsDrawer(
        open = account,
        onClose = { account = false },
        menu = {
            SettingsMenu(user, onClose = { focus.clearFocus(); account = false }, onSignOut = {
                account = false
                Remote.cache.clear()
                container.audiobookPlayback.pauseForMusic()
                container.player.stop()
                scope.launch { container.session.logout() }
            })
        },
    ) {
    PlayerScaffold(
        modifier = Modifier
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
            .then(if (full) Modifier.clearAndSetSemantics {} else Modifier),
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
        topBar = {
            Column {
                Header(nav, user, onBack = { nav.popBackStack() }) { focus.clearFocus(); account = true }
                UpdateBanner(appUpdate, onDetails = { updateDetails = true }, onDismiss = { container.updates.dismiss() })
            }
        },
        bottomBar = { BottomBar(nav) },
        miniPlayer = {
            if (activeAudiobook != null && bookPlayback != null) {
                AudiobookMiniPlayer(activeAudiobook, bookPlayback, bookCover,
                    onOpen = { expanded = true }, onBook = { navigate(AudiobookRoute(activeAudiobook.id)) })
            } else MiniPlayer(playback) { expanded = true }
        },
    ) { padding ->
        NavHost(
            nav,
            startDestination = HomeRoute,
            modifier = Modifier.padding(padding).fillMaxSize().background(palette.background),
        ) {
            composable<HomeRoute> { HomeScreen(nav) }
            composable<SearchRoute> { SearchScreen(nav, play, it.toRoute<SearchRoute>().initialCategory()) }
            composable<LibraryRoute> { LibraryScreen(nav) }
            composable<SavedAudiobooksRoute> { AudiobookBrowse(savedOnly = true) }
            composable<AudiobookRoute> { AudiobookDetail(it.toRoute<AudiobookRoute>().id) }
            composable<FavoritesRoute> { FavoritesScreen(play) }
            composable<RecentRoute> { RecentScreen(play) }
            composable<ListeningRoute> { entry ->
                val route = entry.toRoute<ListeningRoute>()
                ListeningScreen(route.week, route.view) { week, view -> nav.navigate(ListeningRoute(week, view)) }
            }
            composable<DownloadsRoute> { DownloadsScreen(play) }
            composable<SettingsSectionRoute> { SettingsScreen(SettingsCategory.of(it.toRoute<SettingsSectionRoute>().section)) }
            composable<AlbumRoute> { AlbumScreen(it.toRoute<AlbumRoute>().id, nav, play) }
            composable<ArtistRoute> { ArtistScreen(it.toRoute<ArtistRoute>().id, nav, play) }
            composable<PlaylistRoute> { PlaylistScreen(it.toRoute<PlaylistRoute>().id, play) { nav.popBackStack() } }
            composable<GenreRoute> { it.toRoute<GenreRoute>().let { route -> GenreScreen(route.id, route.name, play) } }
            composable<MixRoute> { MixScreen(it.toRoute<MixRoute>().kind, play) }
        }
    }

    AnimatedVisibility(
        full,
        enter = slideInVertically(tween(if (motion) NOW_PLAYING_TRANSITION_MS else 0, easing = FastOutSlowInEasing)) { it },
        exit = slideOutVertically(tween(if (motion) NOW_PLAYING_TRANSITION_MS else 0, easing = FastOutSlowInEasing)) { it },
    ) {
        CompositionLocalProvider(LocalFullPlayerVisibility provides this) {
            if (activeAudiobook != null && bookPlayback != null) {
                AudiobookFullPlayer(activeAudiobook, bookPlayback, bookCover,
                    onOpenBook = { navigate(AudiobookRoute(activeAudiobook.id)) }, onClose = { expanded = false })
            } else FullPlayer(playback) { expanded = false }
        }
    }
    }
    }
    }

    if (updateDetails) appUpdate.release?.let { UpdateDetails(it) { updateDetails = false } }

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
private fun Header(nav: NavController, user: User, onBack: () -> Unit, onAccount: () -> Unit) {
    val palette = LocalPalette.current
    val entry = nav.currentBackStackEntryAsState().value
    val destination = entry?.destination
    val listening = entry?.takeIf { destination?.hasRoute(ListeningRoute::class) == true }?.toRoute<ListeningRoute>()
    val settingsCategory = entry?.takeIf { destination?.hasRoute(SettingsSectionRoute::class) == true }
        ?.toRoute<SettingsSectionRoute>()?.section?.let(SettingsCategory::of)
    val isSettings = destination?.let { it.hasRoute(SettingsRoute::class) || it.hasRoute(SettingsSectionRoute::class) || it.hasRoute(ListeningRoute::class) } == true
    val showBack = isSettings || (tabs.none { destination?.hasRoute(it.type) == true } && destination != null)

    Column(Modifier.background(palette.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(start = if (showBack) 4.dp else 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (showBack) {
                IconButton(onClick = onBack) {
                    Icon(Lucide.ArrowLeft, stringResource(R.string.nav_back), tint = palette.foreground)
                }
            } else {
                BrandMark(palette.foreground, palette.primary, Modifier.size(28.dp))
            }
            if (isSettings) {
                Text(
                    stringResource(when (listening?.view) {
                        "minutes" -> R.string.listening_minutes
                        "artists" -> R.string.listening_artists
                        "songs" -> R.string.listening_songs
                        "decade", "artistShare", "variety" -> R.string.listening_insights
                        "overview" -> R.string.listening_header
                        else -> settingsCategory?.title ?: R.string.settings_title
                    }),
                    style = if (listening != null) Type.body.copy(fontSize = 18.sp, fontWeight = FontWeight.Bold) else Type.title.copy(fontSize = 18.sp, letterSpacing = (-0.025).em),
                    textAlign = if (listening != null) androidx.compose.ui.text.style.TextAlign.Center else androidx.compose.ui.text.style.TextAlign.Start,
                    modifier = Modifier.padding(start = 8.dp).weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            } else {
                Box(Modifier.padding(start = 8.dp).weight(1f)) {
                    BrandWordmark(palette.foreground, Modifier.width(127.dp).height(24.dp))
                }
            }
            if (listening != null) {
                androidx.compose.foundation.layout.Spacer(Modifier.width(48.dp))
            } else Box(
                Modifier.size(48.dp).clip(CircleShape).clickable(onClickLabel = stringResource(R.string.nav_account), onClick = onAccount),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(32.dp).clip(CircleShape).background(palette.raised), contentAlignment = Alignment.Center) {
                    Text(user.username.take(1).uppercase(), style = Type.tiny.copy(fontWeight = FontWeight.SemiBold))
                }
            }
        }
        HorizontalDivider(color = palette.border)
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
                runCatching { nav.getBackStackEntry(tab.type).destination }.getOrNull()
            }
    }
    val inLibrary = section?.hasRoute(LibraryRoute::class) == true || library.any { section?.hasRoute(it.type) == true }
    Column(Modifier.background(palette.card).navigationBarsPadding()) {
        HorizontalDivider(color = palette.border)
        Row(Modifier.fillMaxWidth().height(62.dp).selectableGroup()) {
            tabs.forEach { tab ->
                val active = if (tab.route == LibraryRoute) inLibrary else section?.hasRoute(tab.type) == true
                TabItem(stringResource(tab.label), tab.icon, active) {
                    focus.clearFocus()
                    nav.openSection(tab.route)
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
        destination.hasRoute(DownloadsRoute::class) -> "downloads"
        else -> null
    }
}
