package app.caimack.ui

import androidx.compose.runtime.*

@Composable
internal fun recommendationsEnabled(): Boolean {
    val container = LocalContainer.current
    val enabled by container.recommendationsEnabled.collectAsState()
    val address by container.server.url.collectAsState()
    LaunchedEffect(container, address) { runCatching { container.refreshCapabilities() } }
    return enabled
}
