// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

pub mod analysis;
pub mod auth;
pub mod background;
pub mod catalog;
pub mod config;
pub mod covers;
pub mod db;
pub mod error;
mod file_names;
pub mod i18n;
pub mod integrations;
pub mod json;
pub mod library;
pub mod library_scan;
pub mod mert;
mod metadata_export;
pub mod owner;
pub mod paging;
pub mod playback;
pub mod recommendations;
pub mod schema;
pub mod storage;
pub mod streaming;
pub mod text;
pub mod transcode;
pub mod upload;

pub use error::{AppError, AppResult};
