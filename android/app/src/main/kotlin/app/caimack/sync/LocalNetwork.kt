// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import app.caimack.session.Server
import app.caimack.session.SessionAuthenticator
import java.io.IOException
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import okhttp3.Dns
import okhttp3.OkHttpClient

class LocalNetwork(context: Context, private val server: Server) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)

    fun available(): Boolean = network() != null

    @Suppress("DEPRECATION")
    private fun network(): Network? = connectivity.allNetworks.firstOrNull(::allowed)

    private fun allowed(network: Network): Boolean {
        val caps = connectivity.getNetworkCapabilities(network) ?: return false
        return !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) &&
            (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
    }

    fun client(base: OkHttpClient): OkHttpClient {
        val network =
            network() ?: throw IOException("Waiting for a local Wi-Fi or Ethernet network")
        val target = server.url.value ?: throw IOException("No server address")
        val dns = Dns { host ->
            if (host != target.host || !allowed(network))
                throw IOException("Sync is restricted to the local server")
            network.getAllByName(host).toList().also { addresses ->
                if (addresses.isEmpty() || addresses.any { !isLocal(it) })
                    throw IOException("Sync server must have a local network address")
            }
        }
        // Resolve now as well as at connection time, including literal IPs
        // (OkHttp otherwise bypasses Dns for those).
        dns.lookup(target.host)
        val builder = base.newBuilder()
        builder.interceptors().clear()
        builder.networkInterceptors().clear()
        lateinit var client: OkHttpClient
        client =
            builder
                .socketFactory(network.socketFactory)
                .dns(dns)
                .connectionPool(okhttp3.ConnectionPool()) // never reuse a cellular/VPN connection
                .followRedirects(false)
                .followSslRedirects(false)
                .connectTimeout(8, TimeUnit.SECONDS)
                .readTimeout(45, TimeUnit.SECONDS)
                .addInterceptor { chain ->
                    val url = chain.request().url
                    if (
                        !allowed(network) ||
                            server.url.value != target ||
                            url.host != target.host ||
                            url.port != target.port ||
                            url.scheme != target.scheme
                    )
                        throw IOException("Local sync connection changed")
                    chain.proceed(
                        chain.request().newBuilder().header("X-Caimack-Sync", "1").build()
                    )
                }
                .authenticator(
                    SessionAuthenticator(server, { client }) {
                        /* Keep local playback available; sync reports 401. */
                    }
                )
                .build()
        return client
    }

    companion object {
        fun isLocal(address: InetAddress): Boolean {
            if (
                address.isLoopbackAddress || address.isAnyLocalAddress || address.isMulticastAddress
            )
                return false
            val bytes = address.address
            return address.isSiteLocalAddress ||
                address.isLinkLocalAddress ||
                (bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc)
        }
    }
}
