// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::convert::Infallible;

use app::AppError;
use app::auth::tokens::Principal;
use app::auth::{AuthResult, Client};
use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, IntoResponseParts, Response, ResponseParts};
use axum_extra::extract::CookieJar;
use axum_extra::extract::cookie::{Cookie, Expiration, SameSite};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};

use crate::client::ClientInfo;
use crate::problem::{self, ApiError};
use crate::state::AppState;

pub const ACCESS_TOKEN_COOKIE: &str = "ms_access";
pub const REFRESH_TOKEN_COOKIE: &str = "ms_refresh";
pub const SESSION_HINT_COOKIE: &str = "ms_session";

pub async fn require_user(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    let jar = CookieJar::from_headers(request.headers());
    let Some(token) = bearer_token(request.headers()).or_else(|| jar.get(ACCESS_TOKEN_COOKIE).map(Cookie::value))
    else {
        return unauthorized("Bearer", "no access token");
    };

    let Some(principal) = state.auth.tokens().verify_access_token(token) else {
        return unauthorized(INVALID_TOKEN, "invalid access token");
    };

    match state.auth.session_alive(&principal).await {
        Ok(true) => {}
        Ok(false) => return unauthorized(INVALID_TOKEN, "session was revoked"),
        Err(error) => return ApiError::from(error).into_response(),
    }

    request.extensions_mut().insert(principal);
    next.run(request).await
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    scheme.eq_ignore_ascii_case("bearer").then(|| token.trim()).filter(|token| !token.is_empty())
}

const INVALID_TOKEN: &str = "Bearer error=\"invalid_token\"";

fn unauthorized(challenge: &'static str, reason: &str) -> Response {
    let mut response = problem::bare(StatusCode::UNAUTHORIZED, reason);
    response.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static(challenge));
    response
}

pub struct CurrentUser(pub Principal);

impl<S: Send + Sync> FromRequestParts<S> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<Principal>()
            .cloned()
            .map(Self)
            .ok_or_else(|| ApiError::from(AppError::Internal(anyhow::anyhow!("CurrentUser used outside require_user"))))
    }
}

pub struct Admin(pub Principal);

impl<S: Send + Sync> FromRequestParts<S> for Admin {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let CurrentUser(principal) =
            CurrentUser::from_request_parts(parts, state).await.map_err(IntoResponse::into_response)?;
        if principal.is_admin { Ok(Self(principal)) } else { Err(problem::bare(StatusCode::FORBIDDEN, "not an admin")) }
    }
}

pub fn require_secure(state: &AppState, client: Option<&ClientInfo>) -> bool {
    !state.config.is_development() || client.is_some_and(|client| client.https)
}

pub struct SetCookies(Vec<Cookie<'static>>);

impl IntoResponseParts for SetCookies {
    type Error = Infallible;

    fn into_response_parts(self, mut parts: ResponseParts) -> Result<ResponseParts, Self::Error> {
        for cookie in self.0 {
            if let Ok(value) = HeaderValue::from_str(&cookie.encoded().to_string()) {
                parts.headers_mut().append(header::SET_COOKIE, value);
            }
        }
        Ok(parts)
    }
}

pub fn write_session(auth: &AuthResult, secure: bool) -> SetCookies {
    let expires = Some(auth.refresh_token_expires_at);

    let hint = serde_json::to_vec(&auth.user).map(|json| URL_SAFE_NO_PAD.encode(json)).unwrap_or_default();

    SetCookies(vec![
        cookie(ACCESS_TOKEN_COOKIE, auth.access_token.clone(), "/", true, secure, expires),
        cookie(REFRESH_TOKEN_COOKIE, auth.refresh_token.clone(), "/", true, secure, expires),
        cookie(SESSION_HINT_COOKIE, hint, "/", false, secure, expires),
    ])
}

pub fn clear_session(secure: bool) -> SetCookies {
    SetCookies(vec![
        removal(ACCESS_TOKEN_COOKIE, "/", true, secure),
        removal(REFRESH_TOKEN_COOKIE, "/", true, secure),
        removal(SESSION_HINT_COOKIE, "/", false, secure),
    ])
}

pub fn refresh_token(headers: &HeaderMap) -> Option<String> {
    CookieJar::from_headers(headers).get(REFRESH_TOKEN_COOKIE).map(|cookie| cookie.value().to_owned())
}

fn cookie(
    name: &'static str,
    value: String,
    path: &'static str,
    http_only: bool,
    secure: bool,
    expires: Option<DateTime<Utc>>,
) -> Cookie<'static> {
    let mut cookie =
        Cookie::build((name, value)).http_only(http_only).secure(secure).same_site(SameSite::Lax).path(path).build();
    if let Some(at) = expires.and_then(|at| time::OffsetDateTime::from_unix_timestamp(at.timestamp()).ok()) {
        cookie.set_expires(Expiration::DateTime(at));
    }
    cookie
}

fn removal(name: &'static str, path: &'static str, http_only: bool, secure: bool) -> Cookie<'static> {
    let mut cookie = cookie(name, String::new(), path, http_only, secure, None);
    cookie.set_expires(Expiration::DateTime(time::OffsetDateTime::UNIX_EPOCH));
    cookie
}

pub fn client(info: Option<&ClientInfo>, headers: &HeaderMap, device_name: Option<String>, long_lived: bool) -> Client {
    Client {
        address: info.and_then(|info| info.ip),
        user_agent: headers.get(header::USER_AGENT).and_then(|value| value.to_str().ok()).map(str::to_owned),
        device_name,
        long_lived,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_token_is_read_case_insensitively() {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("bearer abc.def"));

        assert_eq!(bearer_token(&headers), Some("abc.def"));
    }

    #[test]
    fn other_schemes_are_ignored() {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Basic dXNlcg=="));

        assert_eq!(bearer_token(&headers), None);
    }
}
