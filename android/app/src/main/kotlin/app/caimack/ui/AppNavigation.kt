// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedContentTransitionScope.SlideDirection
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost

private const val SCREEN_TRANSITION_MS = 240

@Composable
internal fun AppNavHost(
    nav: NavHostController,
    modifier: Modifier = Modifier,
    builder: NavGraphBuilder.() -> Unit,
) {
    NavHost(
        navController = nav,
        startDestination = HomeRoute,
        modifier = modifier.clipToBounds(),
        enterTransition = { slideIntoContainer(navigateDirection(), tween(SCREEN_TRANSITION_MS)) },
        exitTransition = { slideOutOfContainer(navigateDirection(), tween(SCREEN_TRANSITION_MS)) },
        popEnterTransition = { slideIntoContainer(SlideDirection.End, tween(SCREEN_TRANSITION_MS)) },
        popExitTransition = { slideOutOfContainer(SlideDirection.End, tween(SCREEN_TRANSITION_MS)) },
        // Returning follows the stack direction even when the gesture starts on the other edge.
        predictivePopEnterTransition = { slideIntoContainer(SlideDirection.End, tween(SCREEN_TRANSITION_MS)) },
        predictivePopExitTransition = { slideOutOfContainer(SlideDirection.End, tween(SCREEN_TRANSITION_MS)) },
        builder = builder,
    )
}

private fun AnimatedContentTransitionScope<NavBackStackEntry>.navigateDirection(): SlideDirection {
    val from = initialState.destination.primaryTabIndex()
    val destination = targetState.destination
    val to = destination.primaryTabIndex()
    val returning = destination.hasRoute(HomeRoute::class) || (to >= 0 && from > to)
    return if (returning) SlideDirection.End else SlideDirection.Start
}
