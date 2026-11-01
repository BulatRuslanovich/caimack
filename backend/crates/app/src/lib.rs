// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

pub mod analysis;
pub mod auth;
pub mod background;
pub mod catalog;
pub mod clap_model;
pub mod config;
pub mod covers;
pub mod db;
pub mod error;
pub mod i18n;
pub mod integrations;
pub mod json;
pub mod library;
pub mod library_scan;
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
