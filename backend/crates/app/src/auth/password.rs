// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::LazyLock;

use anyhow::Context;

use crate::{AppError, AppResult};

const COST: u32 = 12;

static ABSENT_ACCOUNT_HASH: LazyLock<String> =
    LazyLock::new(|| bcrypt::hash(uuid::Uuid::new_v4().to_string(), COST).unwrap_or_default());

pub fn validate(password: &str) -> AppResult<()> {
    if password.chars().count() < 8 || password.len() > 72 {
        return Err(AppError::validation(
            "The password must contain at least 8 characters and at most 72 UTF-8 bytes.",
        ));
    }
    Ok(())
}

pub async fn hash(password: String) -> AppResult<String> {
    validate(&password)?;
    let hashed = tokio::task::spawn_blocking(move || bcrypt::hash(password, COST))
        .await
        .context("Password hashing was interrupted")?
        .context("Could not hash the password")?;
    Ok(hashed)
}

pub async fn verify(password: String, hash: Option<String>) -> bool {
    let checked = tokio::task::spawn_blocking(move || match hash.filter(|h| !h.is_empty()) {
        Some(hash) => bcrypt::verify(&password, &hash).unwrap_or(false),
        None => {
            let _ = bcrypt::verify(&password, &ABSENT_ACCOUNT_HASH);
            false
        }
    })
    .await;

    checked.unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFIX_2A_HASH: &str = "$2a$04$UuTkLRZZ6QofpDOlMz32MuuxEHA43WOemOYHPz6.SjsVsyO1tDU96";

    #[tokio::test]
    async fn verifies_hash_from_previous_backend() {
        assert!(verify("password".to_owned(), Some(PREFIX_2A_HASH.to_owned())).await);
    }

    #[tokio::test]
    async fn rejects_wrong_password() {
        assert!(!verify("wrong".to_owned(), Some(PREFIX_2A_HASH.to_owned())).await);
    }

    #[tokio::test]
    async fn rejects_missing_account() {
        assert!(!verify("password".to_owned(), None).await);
    }

    #[tokio::test]
    async fn hash_round_trips() -> AppResult<()> {
        let hashed = hash("correct horse".to_owned()).await?;
        assert!(verify("correct horse".to_owned(), Some(hashed)).await);
        Ok(())
    }

    #[tokio::test]
    async fn rejects_passwords_outside_the_policy_before_hashing() {
        for password in [String::new(), "short".to_owned(), "я".repeat(4), "é".repeat(37)] {
            assert!(matches!(hash(password).await, Err(crate::AppError::Validation(_))));
        }
    }

    #[test]
    fn accepts_passwords_at_the_utf8_length_boundaries() {
        for password in ["password".to_owned(), "a".repeat(72), "я".repeat(36), "🔑".repeat(18)] {
            assert!(validate(&password).is_ok());
        }
    }
}
