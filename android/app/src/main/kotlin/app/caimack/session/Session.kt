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
    data object LocalHttpDisabled : LoginFailure
    data object NonLocalHttp : LoginFailure
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
    private var revision = 0L

    private fun nextRevision(): Long = synchronized(current) { ++revision }

    private fun publish(version: Long, state: SessionState) = synchronized(current) {
        if (revision == version) current.value = state
    }

    val state: StateFlow<SessionState> = current

    suspend fun restore() {
        val version = nextRevision()
        server.restore()
        cookies.restore()

        val hinted = cookies.value(HINT_COOKIE)?.let { hint ->
            runCatching { json.decodeFromString<User>(String(Base64.getUrlDecoder().decode(hint))) }.getOrNull()
        } ?: offlineUser()

        // Reach individual downloads immediately while validating the saved session.
        if (server.url.value != null && hinted != null) publish(version, SessionState.SignedIn(hinted))

        val restored = when {
            server.url.value == null || hinted == null -> SessionState.SignedOut()
            else -> try {
                SessionState.SignedIn(api.me())
            } catch (_: IOException) {
                SessionState.SignedIn(hinted)
            } catch (failure: HttpException) {
                if (failure.code() == UNAUTHORIZED) offlineUser()?.let { SessionState.SignedIn(it) } ?: SessionState.SignedOut(expired = true) else SessionState.SignedIn(hinted)
            }
        }
        publish(version, restored)
    }

    suspend fun login(address: String, username: String, password: String): LoginFailure? {
        val version = nextRevision()
        server.remember(address) ?: return LoginFailure.BadAddress
        cookies.clear()

        return try {
            val user = api.login(LoginRequest(username.trim(), password, deviceName(), longLived = true))
            onLogin(user)
            publish(version, SessionState.SignedIn(user))
            null
        } catch (denied: LocalHttpPolicy.Denied) {
            if (denied.disabled) LoginFailure.LocalHttpDisabled else LoginFailure.NonLocalHttp
        } catch (_: IOException) {
            LoginFailure.Unreachable
        } catch (refused: HttpException) {
            val body = refused.response()?.errorBody()?.string()
            LoginFailure.Refused(body?.let { runCatching { json.decodeFromString<Problem>(it).detail }.getOrNull() })
        }
    }

    suspend fun logout() {
        val version = nextRevision()
        onLogout()
        try {
            api.logout()
        } catch (_: IOException) {
        } catch (_: HttpException) {
        }
        cookies.clear()
        publish(version, SessionState.SignedOut())
    }

    fun expire() {
        val version = nextRevision()
        offlineUser()?.let { publish(version, SessionState.SignedIn(it)); return }
        cookies.clear()
        publish(version, SessionState.SignedOut(expired = true))
    }

    private companion object {
        const val HINT_COOKIE = "ms_session"
        const val UNAUTHORIZED = 401
    }
}
