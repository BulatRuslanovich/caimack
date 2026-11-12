// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.session

import app.caimack.api.CaimackApi
import app.caimack.api.LoginRequest
import app.caimack.api.Problem
import app.caimack.api.User
import java.io.IOException
import java.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import retrofit2.HttpException

sealed interface SessionState {
    data object Restoring : SessionState

    data class SignedOut(val expired: Boolean = false) : SessionState

    data class SignedIn(val user: User) : SessionState
}

sealed interface LoginFailure {
    data object BadAddress : LoginFailure

    data object Unreachable : LoginFailure

    data class Refused(val reason: String?) : LoginFailure
}

class Session(
    private val api: CaimackApi,
    private val server: Server,
    private val cookies: PersistentCookieJar,
    private val json: Json,
    private val deviceName: () -> String,
    private val offlineUser: () -> User? = { null },
    private val onLogin: (User) -> Unit = {},
    private val onLogout: () -> Unit = {},
) {
    private val current = MutableStateFlow<SessionState>(SessionState.Restoring)

    val state: StateFlow<SessionState> = current

    suspend fun restore() {
        server.restore()
        cookies.restore()

        val hinted = cookies.value(HINT_COOKIE)?.let { hint ->
            runCatching { json.decodeFromString<User>(String(Base64.getUrlDecoder().decode(hint))) }.getOrNull()
        } ?: offlineUser()

        // Restore the local UI before checking the server, including accounts
        // with individual downloads but no full library synchronization.
        if (server.url.value != null && hinted != null) {
            current.value = SessionState.SignedIn(hinted)
        }

        current.value = when {
            server.url.value == null || hinted == null -> SessionState.SignedOut()
            else -> try {
                SessionState.SignedIn(api.me())
            } catch (_: IOException) {
                SessionState.SignedIn(hinted)
            } catch (failure: HttpException) {
                if (failure.code() == UNAUTHORIZED) offlineUser()?.let { SessionState.SignedIn(it) } ?: SessionState.SignedOut(expired = true) else SessionState.SignedIn(hinted)
            }
        }
    }

    suspend fun login(address: String, username: String, password: String): LoginFailure? {
        server.remember(address) ?: return LoginFailure.BadAddress
        cookies.clear()

        return try {
            val user = api.login(LoginRequest(username.trim(), password, deviceName(), longLived = true))
            onLogin(user)
            current.value = SessionState.SignedIn(user)
            null
        } catch (_: IOException) {
            LoginFailure.Unreachable
        } catch (refused: HttpException) {
            val body = refused.response()?.errorBody()?.string()
            LoginFailure.Refused(body?.let { runCatching { json.decodeFromString<Problem>(it).detail }.getOrNull() })
        }
    }

    suspend fun logout() {
        onLogout()
        try {
            api.logout()
        } catch (_: IOException) {
        } catch (_: HttpException) {
        }
        cookies.clear()
        current.value = SessionState.SignedOut()
    }

    fun expire() {
        offlineUser()?.let { current.value = SessionState.SignedIn(it); return }
        cookies.clear()
        current.value = SessionState.SignedOut(expired = true)
    }

    private companion object {
        const val HINT_COOKIE = "ms_session"
        const val UNAUTHORIZED = 401
    }
}
