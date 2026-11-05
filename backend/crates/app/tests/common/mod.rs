// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;

use app::AppResult;
use app::auth::sessions::LiveSessions;
use app::auth::tokens::{Principal, TokenService};
use app::auth::{AuthResult, AuthService, Client};
use app::config::JwtConfig;
use sqlx::PgPool;
use uuid::Uuid;

pub fn auth(db: &PgPool) -> AuthService {
    let tokens = TokenService::new(&JwtConfig {
        signing_key: "test-signing-key-with-at-least-32-bytes".to_owned(),
        access_token_minutes: 10,
        refresh_token_days: 30,
    });
    AuthService::new(db.clone(), Arc::new(tokens), LiveSessions::default())
}

pub async fn user(db: &PgPool, username: &str, admin: bool) -> AppResult<Uuid> {
    let id = Uuid::now_v7();
    // This existing low-cost test hash verifies the password "password".
    let hash = "$2a$04$UuTkLRZZ6QofpDOlMz32MuuxEHA43WOemOYHPz6.SjsVsyO1tDU96";
    sqlx::query("INSERT INTO users(id,username,password_hash,is_admin,created_at) VALUES ($1,$2,$3,$4,now())")
        .bind(id)
        .bind(username)
        .bind(hash)
        .bind(admin)
        .execute(db)
        .await?;
    Ok(id)
}

pub async fn login(auth: &AuthService, username: &str) -> AppResult<AuthResult> {
    auth.login(username, "password", &Client::default()).await
}

pub fn principal(auth: &AuthService, result: &AuthResult) -> AppResult<Principal> {
    auth.tokens()
        .verify_access_token(&result.access_token)
        .ok_or_else(|| app::AppError::authentication("Invalid access token."))
}
