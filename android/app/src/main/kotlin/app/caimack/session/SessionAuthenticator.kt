// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.session

import java.io.IOException
import okhttp3.Authenticator
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

class SessionAuthenticator(
    private val server: Server,
    private val client: () -> OkHttpClient,
    private val onExpired: () -> Unit,
) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.url.encodedPath.endsWith(LOGIN) || response.request.url.encodedPath.endsWith(REFRESH)) {
            return null
        }
        if (response.priorResponse?.code == UNAUTHORIZED) return null

        val sentToken = accessTokenIn(response.networkResponse?.request ?: response.request)

        synchronized(this) {
            val currentToken = client().cookieJar.loadForRequest(response.request.url)
                .firstOrNull { it.name == ACCESS_COOKIE }?.value
            if (currentToken != null && currentToken != sentToken) return response.request

            val url = server.resolve(REFRESH.trimStart('/')) ?: return null
            val refresh = Request.Builder().url(url).post(ByteArray(0).toRequestBody()).build()

            val status = try {
                client().newBuilder().authenticator(Authenticator.NONE).build().newCall(refresh).execute().use { it.code }
            } catch (_: IOException) {
                return null
            }

            if (status == UNAUTHORIZED) {
                onExpired()
                return null
            }
            if (status !in 200..299) return null

            return response.request
        }
    }

    private fun accessTokenIn(request: Request): String? =
        request.header("Cookie")
            ?.split(';')
            ?.map(String::trim)
            ?.firstOrNull { it.startsWith("$ACCESS_COOKIE=") }
            ?.substringAfter('=')

    private companion object {
        const val ACCESS_COOKIE = "ms_access"
        const val UNAUTHORIZED = 401
        const val LOGIN = "/api/auth/login"
        const val REFRESH = "/api/auth/refresh"
    }
}
