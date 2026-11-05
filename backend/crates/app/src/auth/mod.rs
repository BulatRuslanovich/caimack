// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

pub mod invitations;
pub mod journal;
pub mod password;
pub mod sessions;
pub mod throttle;
pub mod tokens;

use std::net::IpAddr;
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::text::normalize_username;
use crate::{AppError, AppResult, json};
use journal::{Attempt, Method};
use sessions::LiveSessions;
use throttle::Throttle;
use tokens::{Principal, TokenService, hash_refresh_token};

const REUSE_GRACE: Duration = Duration::seconds(20);

const STALE_TOKEN_AGE: Duration = Duration::days(1);

const DEVICE_SESSION: Duration = Duration::days(180);
const MAX_USER_AGENT: usize = 400;
const MAX_DEVICE_NAME: usize = 100;

#[derive(Debug, Clone, Default)]
pub struct Client {
    pub address: Option<IpAddr>,
    pub user_agent: Option<String>,
    pub device_name: Option<String>,
    pub long_lived: bool,
}

impl Client {
    fn user_agent(&self) -> Option<String> {
        clip(self.user_agent.as_deref(), MAX_USER_AGENT)
    }

    fn device_name(&self) -> Option<String> {
        clip(self.device_name.as_deref(), MAX_DEVICE_NAME)
    }
}

fn clip(value: Option<&str>, limit: usize) -> Option<String> {
    value.map(str::trim).filter(|value| !value.is_empty()).map(|value| value.chars().take(limit).collect())
}

pub(crate) async fn lock_user(conn: &mut PgConnection, user: Uuid) -> AppResult<()> {
    // Rotation and revocation lock the user first, so a refresh cannot survive a concurrent logout.
    sqlx::query!("SELECT id FROM users WHERE id = $1 FOR UPDATE", user)
        .fetch_optional(conn)
        .await?
        .map(|_| ())
        .ok_or_else(|| AppError::not_found("User not found."))
}

async fn lock_token_owner(conn: &mut PgConnection, token_hash: &str) -> AppResult<Option<Uuid>> {
    let owner = sqlx::query_scalar!("SELECT user_id FROM refresh_tokens WHERE token_hash = $1", token_hash)
        .fetch_optional(&mut *conn)
        .await?;
    if let Some(user) = owner {
        lock_user(conn, user).await?;
    }
    Ok(owner)
}

struct SessionStart {
    session_id: Uuid,
    device_name: Option<String>,
    user_agent: Option<String>,
    ip: Option<String>,
    long_lived: bool,
    signed_in_at: DateTime<Utc>,
}

impl SessionStart {
    fn new(client: &Client) -> Self {
        Self {
            session_id: Uuid::now_v7(),
            device_name: client.device_name(),
            user_agent: client.user_agent(),
            ip: client.address.map(|address| address.to_string()),
            long_lived: client.long_lived,
            signed_in_at: Utc::now(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub id: Uuid,
    pub device_name: Option<String>,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
    pub long_lived: bool,
    #[serde(serialize_with = "json::time")]
    pub signed_in_at: DateTime<Utc>,
    #[serde(serialize_with = "json::time")]
    pub last_used_at: DateTime<Utc>,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    pub id: Uuid,
    pub username: String,
    pub is_admin: bool,
}

pub struct AuthResult {
    pub user: UserDto,
    pub access_token: String,
    pub access_token_expires_at: DateTime<Utc>,
    pub refresh_token: String,
    pub refresh_token_expires_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct AuthService {
    db: PgPool,
    tokens: Arc<TokenService>,
    sessions: LiveSessions,
    throttle: Arc<Throttle>,
}

impl AuthService {
    pub fn new(db: PgPool, tokens: Arc<TokenService>, sessions: LiveSessions) -> Self {
        Self { db, tokens, sessions, throttle: Arc::default() }
    }

    pub fn tokens(&self) -> &TokenService {
        &self.tokens
    }

    pub async fn login(&self, username: &str, password: &str, client: &Client) -> AppResult<AuthResult> {
        let username = normalize_username(username);
        let address = client.address;
        let attempt = |user: Option<Uuid>, failure: Option<&'static str>| Attempt {
            user,
            username: &username,
            method: Method::Password,
            failure,
        };
        if let Err(error) = self.throttle.check_login(&username, address) {
            tracing::warn!("Sign-in for username {username} throttled after repeated failures");
            journal::record(&self.db, attempt(None, Some("throttled")), client).await;
            return Err(error);
        }

        let user = sqlx::query!(
            "SELECT id, username, password_hash, is_admin, is_active FROM users WHERE username = $1",
            username
        )
        .fetch_optional(&self.db)
        .await?;

        let hash = user.as_ref().map(|u| u.password_hash.clone());
        let password_ok = password::verify(password.to_owned(), hash).await;

        let Some(user) = user.filter(|_| password_ok) else {
            tracing::warn!("Failed login attempt for username {username}");
            self.throttle.login_failed(&username, address);
            journal::record(&self.db, attempt(None, Some("wrong_password")), client).await;
            return Err(AppError::authentication("Invalid username or password."));
        };
        self.throttle.login_succeeded(&username);

        if !user.is_active {
            tracing::warn!("Deactivated user {} tried to sign in", user.username);
            journal::record(&self.db, attempt(Some(user.id), Some("deactivated")), client).await;
            return Err(AppError::forbidden("This account has been deactivated."));
        }

        let mut tx = self.db.begin().await?;
        let current = sqlx::query!(
            "SELECT id, username, password_hash, is_admin, is_active FROM users WHERE id = $1 FOR UPDATE",
            user.id
        )
        .fetch_one(&mut *tx)
        .await?;
        if current.password_hash != user.password_hash || !current.is_active {
            return Err(AppError::authentication("Invalid username or password."));
        }
        let user = UserDto { id: current.id, username: current.username, is_admin: current.is_admin };
        let result = self.issue(&mut tx, user, SessionStart::new(client)).await?;
        tx.commit().await?;
        tracing::info!("User {} signed in", result.user.username);
        journal::record(&self.db, attempt(Some(result.user.id), None), client).await;
        Ok(result)
    }

    pub async fn refresh(&self, raw_refresh_token: Option<&str>, client: &Client) -> AppResult<AuthResult> {
        let raw = raw_refresh_token.map(str::trim).filter(|raw| !raw.is_empty());
        let Some(raw) = raw else {
            return Err(AppError::authentication("Missing refresh token."));
        };

        let now = Utc::now();
        let mut tx = self.db.begin().await?;
        let token_hash = hash_refresh_token(raw);
        if lock_token_owner(&mut tx, &token_hash).await?.is_none() {
            return Err(AppError::authentication("Refresh token is invalid or expired."));
        }

        let stored = sqlx::query!(
            r#"SELECT t.id, t.user_id, t.expires_at, t.revoked_at, t.session_id, t.device_name, t.user_agent, t.ip,
                      t.long_lived, t.signed_in_at, u.username, u.is_admin, u.is_active
               FROM refresh_tokens t JOIN users u ON u.id = t.user_id
               WHERE t.token_hash = $1
               FOR UPDATE OF t"#,
            token_hash
        )
        .fetch_optional(&mut *tx)
        .await?;

        let Some(stored) = stored else {
            tracing::info!("Rejected an unknown refresh token");
            return Err(AppError::authentication("Refresh token is invalid or expired."));
        };

        if let Some(revoked_at) = stored.revoked_at {
            let session_lives_on = sqlx::query_scalar!(
                r#"SELECT EXISTS (
                       SELECT 1 FROM refresh_tokens
                       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 AND session_id = $3
                   ) AS "exists!""#,
                stored.user_id,
                now,
                stored.session_id
            )
            .fetch_one(&mut *tx)
            .await?;

            if !session_lives_on || now - revoked_at > REUSE_GRACE {
                tracing::warn!("Refresh token reuse detected for user {}; all sessions revoked", stored.user_id);

                sqlx::query!("DELETE FROM refresh_tokens WHERE user_id = $1", stored.user_id).execute(&mut *tx).await?;
                tx.commit().await?;
                self.sessions.forget_user(stored.user_id);

                return Err(AppError::authentication("Refresh token is invalid or expired."));
            }

            tracing::debug!(
                "Refresh token of user {} was rotated moments ago; treating as a concurrent refresh",
                stored.user_id
            );
        }

        if stored.expires_at <= now || !stored.is_active {
            tracing::info!("Rejected an expired refresh token or a deactivated user");
            return Err(AppError::authentication("Refresh token is invalid or expired."));
        }

        if stored.revoked_at.is_none() {
            sqlx::query!("UPDATE refresh_tokens SET revoked_at = $2 WHERE id = $1", stored.id, now)
                .execute(&mut *tx)
                .await?;
        }

        let user = UserDto { id: stored.user_id, username: stored.username, is_admin: stored.is_admin };
        let start = SessionStart {
            session_id: stored.session_id,
            device_name: stored.device_name,
            user_agent: client.user_agent().or(stored.user_agent),
            ip: client.address.map(|address| address.to_string()).or(stored.ip),
            long_lived: stored.long_lived,
            signed_in_at: stored.signed_in_at,
        };
        let result = self.issue(&mut tx, user, start).await?;
        tx.commit().await?;
        Ok(result)
    }

    pub async fn sessions(&self, user: Uuid, current_token: Uuid) -> AppResult<Vec<SessionDto>> {
        let current = sqlx::query_scalar!(
            "SELECT session_id FROM refresh_tokens WHERE id = $1 AND user_id = $2",
            current_token,
            user
        )
        .fetch_optional(&self.db)
        .await?;
        let rows = sqlx::query!(
            "SELECT DISTINCT ON (session_id) session_id, device_name, user_agent, ip, long_lived, signed_in_at, last_used_at
             FROM refresh_tokens
             WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
             ORDER BY session_id, last_used_at DESC",
            user
        )
        .fetch_all(&self.db)
        .await?;
        let mut sessions: Vec<SessionDto> = rows
            .into_iter()
            .map(|row| SessionDto {
                current: Some(row.session_id) == current,
                id: row.session_id,
                device_name: row.device_name,
                user_agent: row.user_agent,
                ip: row.ip,
                long_lived: row.long_lived,
                signed_in_at: row.signed_in_at,
                last_used_at: row.last_used_at,
            })
            .collect();
        sessions.sort_by(|a, b| b.current.cmp(&a.current).then(b.last_used_at.cmp(&a.last_used_at)));
        Ok(sessions)
    }

    pub async fn end_session(&self, user: Uuid, session: Uuid) -> AppResult<()> {
        let mut tx = self.db.begin().await?;
        lock_user(&mut tx, user).await?;
        let ended = sqlx::query!("DELETE FROM refresh_tokens WHERE user_id = $1 AND session_id = $2", user, session)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        if ended == 0 {
            return Err(AppError::not_found("The requested resource was not found."));
        }
        tx.commit().await?;
        self.sessions.forget_user(user);
        Ok(())
    }

    pub async fn end_other_sessions(&self, user: Uuid, current_token: Uuid) -> AppResult<u64> {
        let mut tx = self.db.begin().await?;
        lock_user(&mut tx, user).await?;
        let ended = sqlx::query!(
            "DELETE FROM refresh_tokens WHERE user_id = $1
               AND session_id IS DISTINCT FROM (SELECT session_id FROM refresh_tokens WHERE id = $2)",
            user,
            current_token
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        tx.commit().await?;
        self.sessions.forget_user(user);
        Ok(ended)
    }

    pub async fn sign_ins(&self, user: Uuid, username: &str) -> AppResult<Vec<journal::SignInDto>> {
        Ok(journal::recent(&self.db, user, username).await?)
    }

    pub async fn logout(&self, raw_refresh_token: Option<&str>) -> AppResult<()> {
        let Some(raw) = raw_refresh_token.map(str::trim).filter(|raw| !raw.is_empty()) else {
            return Ok(());
        };

        let mut tx = self.db.begin().await?;
        let token_hash = hash_refresh_token(raw);
        let Some(user) = lock_token_owner(&mut tx, &token_hash).await? else {
            return Ok(());
        };
        sqlx::query!(
            "DELETE FROM refresh_tokens WHERE user_id = $1 AND session_id =
                (SELECT session_id FROM refresh_tokens WHERE token_hash = $2)",
            user,
            token_hash
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        self.sessions.forget_user(user);
        tracing::info!("User {user} signed out");
        Ok(())
    }

    pub async fn change_password(
        &self,
        user_id: Uuid,
        current_token: Uuid,
        current: &str,
        new: &str,
    ) -> AppResult<AuthResult> {
        let user = sqlx::query!("SELECT id, username, password_hash, is_admin FROM users WHERE id = $1", user_id)
            .fetch_optional(&self.db)
            .await?
            .ok_or_else(|| AppError::not_found("User not found."))?;

        self.throttle.check_password_change(user_id)?;
        if !password::verify(current.to_owned(), Some(user.password_hash.clone())).await {
            self.throttle.password_change_failed(user_id);
            return Err(AppError::forbidden("The current password is not correct."));
        }
        self.throttle.password_changed(user_id);

        let new_hash = password::hash(new.to_owned()).await?;

        let mut tx = self.db.begin().await?;
        let locked = sqlx::query!("SELECT password_hash, is_admin FROM users WHERE id = $1 FOR UPDATE", user_id)
            .fetch_one(&mut *tx)
            .await?;
        if locked.password_hash != user.password_hash {
            return Err(AppError::forbidden("The current password is not correct."));
        }
        let start = sqlx::query!(
            "SELECT session_id, device_name, user_agent, ip, long_lived, signed_in_at FROM refresh_tokens
             WHERE user_id = $1 AND id = $2",
            user_id,
            current_token
        )
        .fetch_optional(&mut *tx)
        .await?
        .map_or_else(
            || SessionStart::new(&Client::default()),
            |row| SessionStart {
                session_id: row.session_id,
                device_name: row.device_name,
                user_agent: row.user_agent,
                ip: row.ip,
                long_lived: row.long_lived,
                signed_in_at: row.signed_in_at,
            },
        );
        sqlx::query!("UPDATE users SET password_hash = $2 WHERE id = $1", user_id, new_hash).execute(&mut *tx).await?;
        sqlx::query!("DELETE FROM refresh_tokens WHERE user_id = $1", user_id).execute(&mut *tx).await?;
        let user = UserDto { id: user.id, username: user.username, is_admin: locked.is_admin };
        let result = self.issue(&mut tx, user, start).await?;
        tx.commit().await?;

        self.sessions.forget_user(user_id);
        tracing::info!("User {user_id} changed their password");
        Ok(result)
    }

    pub async fn user(&self, user_id: Uuid) -> AppResult<UserDto> {
        sqlx::query_as!(UserDto, "SELECT id, username, is_admin FROM users WHERE id = $1", user_id)
            .fetch_optional(&self.db)
            .await?
            .ok_or_else(|| AppError::not_found("User not found."))
    }

    pub async fn session_alive(&self, principal: &Principal) -> AppResult<bool> {
        if self.sessions.is_known_alive(principal.session_id) {
            return Ok(true);
        }

        let owner = sqlx::query_scalar!(
            "SELECT t.user_id FROM refresh_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = $1 AND u.is_active",
            principal.session_id
        )
        .fetch_optional(&self.db)
        .await?;

        Ok(match owner {
            Some(user_id) => {
                self.sessions.remember_alive(principal.session_id, user_id);
                true
            }
            None => false,
        })
    }

    pub fn forget_user_sessions(&self, user_id: Uuid) {
        self.sessions.forget_user(user_id);
    }

    async fn issue(&self, conn: &mut PgConnection, user: UserDto, start: SessionStart) -> AppResult<AuthResult> {
        let now = Utc::now();
        let lifetime = if start.long_lived { DEVICE_SESSION } else { self.tokens.refresh_lifetime() };
        let refresh = self.tokens.create_refresh_token(now, lifetime);
        let access = self.tokens.create_access_token(user.id, &user.username, user.is_admin, refresh.id, now)?;

        sqlx::query!(
            "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at, session_id, device_name,
                                         user_agent, ip, long_lived, signed_in_at, last_used_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
            refresh.id,
            user.id,
            refresh.hash,
            refresh.expires_at,
            refresh.created_at,
            start.session_id,
            start.device_name,
            start.user_agent,
            start.ip,
            start.long_lived,
            start.signed_in_at,
            now
        )
        .execute(&mut *conn)
        .await?;

        let cutoff = now - STALE_TOKEN_AGE;
        sqlx::query!(
            "DELETE FROM refresh_tokens WHERE user_id = $1 AND (expires_at < $2 OR revoked_at < $2)",
            user.id,
            cutoff
        )
        .execute(&mut *conn)
        .await?;

        Ok(AuthResult {
            user,
            access_token: access.value,
            access_token_expires_at: access.expires_at,
            refresh_token: refresh.raw,
            refresh_token_expires_at: refresh.expires_at,
        })
    }
}
