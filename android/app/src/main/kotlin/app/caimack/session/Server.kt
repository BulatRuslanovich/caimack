// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.session

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import java.io.IOException
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor

class Server(
    private val preferences: DataStore<Preferences>,
    private val language: () -> String = { Locale.getDefault().toLanguageTag() },
) {
    private val address = MutableStateFlow<HttpUrl?>(null)

    val url: StateFlow<HttpUrl?> = address

    val interceptor = Interceptor { chain ->
        val request = chain.request().newBuilder().header("Accept-Language", language()).build()
        if (request.url.host != PLACEHOLDER_HOST) return@Interceptor chain.proceed(request)

        val target = resolve(request.url.encodedPath.trimStart('/'))
            ?.newBuilder()
            ?.encodedQuery(request.url.encodedQuery)
            ?.build()
            ?: throw IOException("No server address is set.")

        chain.proceed(request.newBuilder().url(target).build())
    }

    suspend fun restore() {
        address.value = preferences.data.first()[KEY]?.toHttpUrlOrNull()
    }

    suspend fun remember(input: String): HttpUrl? {
        val trimmed = input.trim().trimEnd('/')
        if (trimmed.isEmpty()) return null

        val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
        val parsed = "$withScheme/".toHttpUrlOrNull() ?: return null

        preferences.edit { it[KEY] = parsed.toString() }
        address.value = parsed
        return parsed
    }

    fun resolve(path: String): HttpUrl? = address.value?.newBuilder()?.addEncodedPathSegments(path)?.build()

    companion object {
        private const val PLACEHOLDER_HOST = "server.caimack.invalid"

        const val PLACEHOLDER = "http://$PLACEHOLDER_HOST/"
        private val KEY = stringPreferencesKey("server")
    }
}
