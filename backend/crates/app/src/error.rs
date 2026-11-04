// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::fmt;
use std::time::Duration;

use crate::i18n::{self, Lang};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone)]
pub struct Message {
    pub template: &'static str,
    pub args: Vec<String>,
}

impl Message {
    pub fn localized(&self, lang: Lang) -> String {
        i18n::localize(self.template, &self.args, lang)
    }
}

impl fmt::Display for Message {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&i18n::format_template(self.template, &self.args))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(Message),
    #[error("{0}")]
    Authentication(Message),
    #[error("{0}")]
    Forbidden(Message),
    #[error("{0}")]
    NotFound(Message),
    #[error("{0}")]
    Conflict(Message),
    #[error("{0}")]
    PayloadTooLarge(Message),
    #[error("{message}")]
    TooManyRequests { message: Message, retry_after: Duration },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    pub fn validation(template: &'static str) -> Self {
        Self::Validation(message(template))
    }

    pub fn authentication(template: &'static str) -> Self {
        Self::Authentication(message(template))
    }

    pub fn forbidden(template: &'static str) -> Self {
        Self::Forbidden(message(template))
    }

    pub fn not_found(template: &'static str) -> Self {
        Self::NotFound(message(template))
    }

    pub fn conflict(template: &'static str) -> Self {
        Self::Conflict(message(template))
    }

    pub fn internal(error: impl Into<anyhow::Error>) -> Self {
        Self::Internal(error.into())
    }

    pub fn payload_too_large(template: &'static str) -> Self {
        Self::PayloadTooLarge(message(template))
    }

    pub fn too_many_requests(template: &'static str, retry_after: Duration) -> Self {
        Self::TooManyRequests { message: message(template), retry_after }
    }

    #[must_use]
    pub fn arg(mut self, value: impl fmt::Display) -> Self {
        if let Some(message) = self.message_mut() {
            message.args.push(value.to_string());
        }
        self
    }

    pub fn status(&self) -> u16 {
        match self {
            Self::Validation(_) => 400,
            Self::Authentication(_) => 401,
            Self::Forbidden(_) => 403,
            Self::NotFound(_) => 404,
            Self::Conflict(_) => 409,
            Self::PayloadTooLarge(_) => 413,
            Self::TooManyRequests { .. } => 429,
            Self::Internal(_) => 500,
        }
    }

    pub fn message(&self) -> Option<&Message> {
        match self {
            Self::Validation(m)
            | Self::Authentication(m)
            | Self::Forbidden(m)
            | Self::NotFound(m)
            | Self::Conflict(m)
            | Self::PayloadTooLarge(m)
            | Self::TooManyRequests { message: m, .. } => Some(m),
            Self::Internal(_) => None,
        }
    }

    pub fn retry_after(&self) -> Option<Duration> {
        match self {
            Self::TooManyRequests { retry_after, .. } => Some(*retry_after),
            _ => None,
        }
    }

    fn message_mut(&mut self) -> Option<&mut Message> {
        match self {
            Self::Validation(m)
            | Self::Authentication(m)
            | Self::Forbidden(m)
            | Self::NotFound(m)
            | Self::Conflict(m)
            | Self::PayloadTooLarge(m)
            | Self::TooManyRequests { message: m, .. } => Some(m),
            Self::Internal(_) => None,
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.into())
    }
}

fn message(template: &'static str) -> Message {
    Message { template, args: Vec::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_is_english_with_arguments() {
        let error = AppError::validation("Only {0} files are supported.").arg(".mp3, .flac");
        assert_eq!(error.to_string(), "Only .mp3, .flac files are supported.");
    }

    #[test]
    fn localized_message_uses_translation() {
        let error = AppError::not_found("Track not found.");
        let text = error.message().map(|m| m.localized(Lang::Ru));
        assert_eq!(text.as_deref(), Some("Трек не найден."));
    }
}
