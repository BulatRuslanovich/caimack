// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.sync

import android.content.ContextWrapper
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.platform.app.InstrumentationRegistry
import app.caimack.api.User
import app.caimack.playback.Downloads
import app.caimack.session.Server
import java.io.File
import java.net.Inet4Address
import java.net.InetAddress
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.Assume.assumeNotNull

internal class SyncDeviceFixture(
    val context: ContextWrapper,
    val server: Server,
    val web: MockWebServer,
) {
    val json = Json { ignoreUnknownKeys = true }
    val user = User("sync-user", "Sync test")
    val store = SyncStore(context, json, server)
    private val http = OkHttpClient()
    var downloads = newDownloads()
        private set
    val sync = LibrarySync(context, store, server, { downloads }) { http }

    private fun newDownloads() = Downloads(context, http, server, json, { store.downloadOwner }) { !store.active }

    fun manifest(content: JsonObjectBuilder.() -> Unit): JsonObject = buildJsonObject {
        put("protocol", 1)
        put("serverId", "sync-server")
        put("user", json.encodeToJsonElement(user))
        content()
    }

    suspend fun restartDownloads() = withContext(Dispatchers.Main) {
        downloads.release()
        downloads = newDownloads()
    }
}

internal suspend fun withLibrarySync(test: suspend SyncDeviceFixture.() -> Unit) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val target = instrumentation.targetContext
    check(target.packageName.endsWith(".uitest"))
    if (Build.VERSION.SDK_INT >= 37) instrumentation.uiAutomation.grantRuntimePermission(target.packageName, "android.permission.ACCESS_LOCAL_NETWORK")
    val connectivity = target.getSystemService(ConnectivityManager::class.java)
    @Suppress("DEPRECATION")
    val network = connectivity.allNetworks.firstOrNull { network ->
        connectivity.getNetworkCapabilities(network)?.let {
            !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                (it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || it.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        } == true
    }
    val address = network?.let { connectivity.getLinkProperties(it)?.linkAddresses }
        ?.firstOrNull { it.address is Inet4Address && LocalNetwork.isLocal(it.address) }?.address?.hostAddress
    assumeNotNull(address)

    val name = "sync-${UUID.randomUUID()}"
    val directory = File(target.cacheDir, name).apply { mkdirs() }
    val isolated = object : ContextWrapper(target) {
        override fun getFilesDir() = directory
        override fun getDatabasePath(name: String) = File(directory, name)
        override fun getSharedPreferences(name: String, mode: Int) = target.getSharedPreferences("${directory.name}-$name", mode)
    }
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val prefs = PreferenceDataStoreFactory.create(scope = scope) { File(directory, "server.preferences_pb") }
    val server = Server(prefs)
    val web = MockWebServer().apply { start(InetAddress.getByName("0.0.0.0"), 0) }
    server.remember(web.url("/").newBuilder().host(checkNotNull(address)).build().toString())
    val fixture = withContext(Dispatchers.Main) { SyncDeviceFixture(isolated, server, web) }
    try {
        fixture.store.configure(fixture.user)
        fixture.store.enable(true)
        fixture.test()
    } finally {
        fixture.sync.pause()
        withContext(Dispatchers.Main) { fixture.downloads.release() }
        web.close()
        scope.coroutineContext.job.cancelAndJoin()
        target.deleteSharedPreferences("$name-library-sync")
        directory.deleteRecursively()
    }
}
