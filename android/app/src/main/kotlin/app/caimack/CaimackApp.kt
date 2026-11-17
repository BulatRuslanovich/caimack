// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack

import app.caimack.playback.Background
import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import kotlinx.coroutines.launch

class CaimackApp : Application(), SingletonImageLoader.Factory {
    val container by lazy { AppContainer(this) }

    override fun onCreate() {
        super.onCreate()
        container.scope.launch { container.session.restore() }
        container.connect.start()
        app.caimack.widget.observeWidgetPlayback(this, container)
        getSystemService(android.net.ConnectivityManager::class.java).registerNetworkCallback(
            android.net.NetworkRequest.Builder().build(),
            object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) { container.refreshDownloadMetadata(); container.refreshLibraryConnection() }
                override fun onLost(network: android.net.Network) {
                    container.libraryCache.offline.value = true
                    container.refreshLibraryConnection()
                }
            },
        )
        Background.schedule(this)
        app.caimack.sync.SyncScheduler.observe(this)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader = ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { container.http })) }
        .crossfade(true)
        .build()
}
