// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::JwtConfig;
use crate::text::hex_lower;
use crate::{AppError, AppResult};

const ISSUER: &str = "music-streaming";
const AUDIENCE: &str = "music-streaming";
const ADMIN_ROLE: &str = "Admin";
const CLOCK_SKEW_SECONDS: u64 = 30;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    username: String,
    jti: String,
    sid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    iss: String,
    aud: String,
    iat: i64,
    nbf: i64,
    exp: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
    pub user_id: Uuid,
    pub username: String,
    pub session_id: Uuid,
    pub is_admin: bool,
}

pub struct IssuedToken {
    pub value: String,
    pub expires_at: DateTime<Utc>,
}

pub struct IssuedRefreshToken {
    pub raw: String,
    pub id: Uuid,
    pub hash: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

pub struct TokenService {
    encoding: EncodingKey,
    decoding: DecodingKey,
    validation: Validation,
    access_lifetime: Duration,
    refresh_lifetime: Duration,
}

impl TokenService {
    pub fn new(config: &JwtConfig) -> Self {
        let key = config.signing_key.as_bytes();

        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_issuer(&[ISSUER]);
        validation.set_audience(&[AUDIENCE]);
        validation.set_required_spec_claims(&["exp", "nbf", "iss", "aud", "sub"]);
        validation.validate_nbf = true;
        validation.leeway = CLOCK_SKEW_SECONDS;

        Self {
            encoding: EncodingKey::from_secret(key),
            decoding: DecodingKey::from_secret(key),
            validation,
            access_lifetime: Duration::minutes(config.access_token_minutes),
            refresh_lifetime: Duration::days(config.refresh_token_days),
        }
    }

    pub fn access_token_minutes(&self) -> i64 {
        self.access_lifetime.num_minutes()
    }

    pub fn create_access_token(
        &self,
        user_id: Uuid,
        username: &str,
        is_admin: bool,
        session_id: Uuid,
        now: DateTime<Utc>,
    ) -> AppResult<IssuedToken> {
        let expires_at = now + self.access_lifetime;
        let claims = Claims {
            sub: user_id.to_string(),
            username: username.to_owned(),
            jti: Uuid::now_v7().simple().to_string(),
            sid: session_id.to_string(),
            role: is_admin.then(|| ADMIN_ROLE.to_owned()),
            iss: ISSUER.to_owned(),
            aud: AUDIENCE.to_owned(),
            iat: now.timestamp(),
            nbf: now.timestamp(),
            exp: expires_at.timestamp(),
        };

        let value = jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, &self.encoding)
            .map_err(AppError::internal)?;

        Ok(IssuedToken { value, expires_at })
    }

    pub fn verify_access_token(&self, token: &str) -> Option<Principal> {
        let data = jsonwebtoken::decode::<Claims>(token, &self.decoding, &self.validation).ok()?;
        let claims = data.claims;

        Some(Principal {
            user_id: claims.sub.parse().ok()?,
            username: claims.username,
            session_id: claims.sid.parse().ok()?,
            is_admin: claims.role.as_deref() == Some(ADMIN_ROLE),
        })
    }

    pub fn refresh_lifetime(&self) -> Duration {
        self.refresh_lifetime
    }

    pub fn create_refresh_token(&self, now: DateTime<Utc>, lifetime: Duration) -> IssuedRefreshToken {
        let bytes: [u8; 32] = rand::random();
        let raw = URL_SAFE_NO_PAD.encode(bytes);

        IssuedRefreshToken {
            hash: hash_refresh_token(&raw),
            raw,
            id: Uuid::now_v7(),
            created_at: now,
            expires_at: now + lifetime,
        }
    }
}

pub fn hash_refresh_token(raw: &str) -> String {
    hex_lower(&Sha256::digest(raw.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> TokenService {
        TokenService::new(&JwtConfig {
            signing_key: "0123456789abcdef0123456789abcdef".to_owned(),
            access_token_minutes: 10,
            refresh_token_days: 30,
        })
    }

    #[test]
    fn access_token_round_trips() -> AppResult<()> {
        let tokens = service();
        let (user, session) = (Uuid::now_v7(), Uuid::now_v7());
        let issued = tokens.create_access_token(user, "admin", true, session, Utc::now())?;

        let principal = tokens.verify_access_token(&issued.value);

        assert_eq!(
            principal,
            Some(Principal { user_id: user, username: "admin".to_owned(), session_id: session, is_admin: true })
        );
        Ok(())
    }

    #[test]
    fn expired_access_token_is_rejected() -> AppResult<()> {
        let tokens = service();
        let issued_at = Utc::now() - Duration::hours(1);
        let issued = tokens.create_access_token(Uuid::now_v7(), "u", false, Uuid::now_v7(), issued_at)?;

        assert_eq!(tokens.verify_access_token(&issued.value), None);
        Ok(())
    }

    #[test]
    fn token_signed_with_another_key_is_rejected() -> AppResult<()> {
        let other = TokenService::new(&JwtConfig {
            signing_key: "another-key-another-key-another-key".to_owned(),
            access_token_minutes: 10,
            refresh_token_days: 30,
        });
        let issued = other.create_access_token(Uuid::now_v7(), "u", false, Uuid::now_v7(), Utc::now())?;

        assert_eq!(service().verify_access_token(&issued.value), None);
        Ok(())
    }

    #[test]
    fn refresh_token_hash_is_lowercase_sha256_hex() {
        assert_eq!(hash_refresh_token("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
