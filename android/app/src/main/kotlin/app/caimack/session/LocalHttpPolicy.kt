// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.session

import android.content.Context
import java.io.IOException
import java.net.InetAddress
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.HttpUrl
import okhttp3.Interceptor

class ConnectionPreferences(context: Context, file: String = "connection") {
    private val preferences = context.getSharedPreferences(file, Context.MODE_PRIVATE)
    private val localHttp = MutableStateFlow(preferences.getBoolean("allow_local_http", false))
    val allowLocalHttp: StateFlow<Boolean> = localHttp

    fun setAllowLocalHttp(value: Boolean) {
        preferences.edit().putBoolean("allow_local_http", value).apply()
        localHttp.value = value
    }
}

/** Every HTTP request is checked before connection and again before bytes are sent. */
class LocalHttpPolicy(
    private val enabled: () -> Boolean,
    private val server: () -> HttpUrl? = { null },
) {
    class Denied(val disabled: Boolean) : IOException(
        if (disabled) "Local HTTP is disabled" else "HTTP is restricted to the selected local server"
    )

    private fun check(url: HttpUrl) {
        if (url.scheme != "http") return
        if (!enabled()) throw Denied(disabled = true)
        if (!isLocalHost(url.host)) throw Denied(disabled = false)
        val selected = server() ?: throw Denied(disabled = false)
        if (selected.scheme != "http" || selected.host != url.host || selected.port != url.port) {
            throw Denied(disabled = false)
        }
    }

    val interceptor = Interceptor { chain ->
        check(chain.request().url)
        chain.proceed(chain.request())
    }

    val networkInterceptor = Interceptor { chain ->
        val url = chain.request().url
        check(url)
        if (url.scheme == "http") {
            val destination = chain.connection()?.route()?.socketAddress?.address
            if (destination == null || !isLocalAddress(destination)) throw Denied(disabled = false)
        }
        chain.proceed(chain.request())
    }

    companion object {
        fun isLocalHost(host: String): Boolean {
            if (host == "localhost") return true
            val literal = host.removeSurrounding("[", "]")
            if (literal.contains(':')) {
                if (!literal.matches(Regex("[0-9a-fA-F:.]+"))) return false
                return runCatching { isLocalAddress(InetAddress.getByName(literal)) }.getOrDefault(false)
            }
            val parts = literal.split('.')
            if (parts.size != 4 || parts.any { !it.matches(Regex("0|[1-9][0-9]{0,2}")) }) return false
            val bytes = parts.map { it.toInt() }
            if (bytes.any { it !in 0..255 }) return false
            return runCatching { isLocalAddress(InetAddress.getByAddress(bytes.map { it.toByte() }.toByteArray())) }.getOrDefault(false)
        }

        private fun isLocalAddress(address: InetAddress): Boolean {
            if (address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress) return true
            val bytes = address.address
            return bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc
        }
    }
}
