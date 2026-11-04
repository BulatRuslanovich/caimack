// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.session

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

class PersistentCookieJar(
    private val preferences: DataStore<Preferences>,
    private val scope: CoroutineScope,
) : CookieJar {
    private val cookies = ConcurrentHashMap<String, Cookie>()

    suspend fun restore() {
        val stored = preferences.data.first()[KEY] ?: return
        Json.decodeFromString<List<StoredCookie>>(stored).map(StoredCookie::toCookie).forEach { cookies[it.key] = it }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> =
        live().filter { it.matches(url) }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        for (cookie in cookies) {
            if (cookie.expiresAt < now) this.cookies.remove(cookie.key) else this.cookies[cookie.key] = cookie
        }
        persist()
    }

    fun value(name: String): String? = live().firstOrNull { it.name == name }?.value

    fun clear() {
        cookies.clear()
        persist()
    }

    private fun live(): List<Cookie> {
        val now = System.currentTimeMillis()
        return cookies.values.filter { it.expiresAt >= now }
    }

    private fun persist() {
        scope.launch {
            preferences.edit { it[KEY] = Json.encodeToString(cookies.values.map(::StoredCookie)) }
        }
    }

    private val Cookie.key get() = "$name|$domain|$path"

    @Serializable
    private data class StoredCookie(
        val name: String,
        val value: String,
        val expiresAt: Long,
        val domain: String,
        val path: String,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean,
    ) {
        constructor(cookie: Cookie) : this(
            cookie.name, cookie.value, cookie.expiresAt, cookie.domain, cookie.path,
            cookie.secure, cookie.httpOnly, cookie.hostOnly,
        )

        fun toCookie(): Cookie = Cookie.Builder()
            .name(name)
            .value(value)
            .expiresAt(expiresAt)
            .path(path)
            .apply { if (hostOnly) hostOnlyDomain(domain) else domain(domain) }
            .apply { if (secure) secure() }
            .apply { if (httpOnly) httpOnly() }
            .build()
    }

    private companion object {
        val KEY = stringPreferencesKey("cookies")
    }
}
