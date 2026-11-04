// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::io::SeekFrom;
use std::path::PathBuf;

use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::problem::ApiError;

pub struct FileReply {
    pub path: PathBuf,
    pub content_type: String,
    pub etag: String,
    pub cache_control: &'static str,

    pub download_name: Option<String>,
    pub ranges: bool,
}

impl FileReply {
    pub async fn send(self, request: &HeaderMap) -> Response {
        match self.respond(request).await {
            Ok(response) => response,
            Err(error) => ApiError::from(app::AppError::Internal(error)).into_response(),
        }
    }

    async fn respond(self, request: &HeaderMap) -> anyhow::Result<Response> {
        let mut headers = HeaderMap::new();
        insert(&mut headers, header::CACHE_CONTROL, self.cache_control);
        insert(&mut headers, header::ETAG, &self.etag);

        if etag_matches(request, &self.etag) {
            return Ok((StatusCode::NOT_MODIFIED, headers).into_response());
        }

        let mut file = tokio::fs::File::open(&self.path).await?;
        let length = file.metadata().await?.len();

        insert(&mut headers, header::CONTENT_TYPE, &self.content_type);
        if self.ranges {
            insert(&mut headers, header::ACCEPT_RANGES, "bytes");
        }
        if let Some(name) = &self.download_name {
            insert(&mut headers, header::CONTENT_DISPOSITION, &attachment(name));
        }

        let range = if self.ranges { requested_range(request, length) } else { None };
        let (status, start, count) = match range {
            None => (StatusCode::OK, 0, length),
            Some(Range::Unsatisfiable) => {
                insert(&mut headers, header::CONTENT_RANGE, &format!("bytes */{length}"));
                return Ok((StatusCode::RANGE_NOT_SATISFIABLE, headers).into_response());
            }
            Some(Range::Bytes(start, end)) => {
                insert(&mut headers, header::CONTENT_RANGE, &format!("bytes {start}-{end}/{length}"));
                (StatusCode::PARTIAL_CONTENT, start, end - start + 1)
            }
        };

        file.seek(SeekFrom::Start(start)).await?;
        insert(&mut headers, header::CONTENT_LENGTH, &count.to_string());
        let body = Body::from_stream(ReaderStream::new(file.take(count)));
        Ok((status, headers, body).into_response())
    }
}

fn insert(headers: &mut HeaderMap, name: header::HeaderName, value: &str) {
    if let Ok(value) = HeaderValue::from_str(value) {
        headers.insert(name, value);
    }
}

fn etag_matches(request: &HeaderMap, etag: &str) -> bool {
    request
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|tag| tag.trim().trim_start_matches("W/"))
        .any(|tag| tag == "*" || tag == etag)
}

#[derive(Debug, PartialEq, Eq)]
enum Range {
    Bytes(u64, u64),
    Unsatisfiable,
}

fn requested_range(request: &HeaderMap, length: u64) -> Option<Range> {
    let value = request.get(header::RANGE)?.to_str().ok()?.trim();
    let spec = value.strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None;
    }
    let (first, last) = spec.split_once('-')?;
    let (first, last) = (first.trim(), last.trim());

    let range = match (first.is_empty(), last.is_empty()) {
        (true, true) => return None,
        (true, false) => {
            let suffix: u64 = last.parse().ok()?;
            if suffix == 0 || length == 0 {
                return Some(Range::Unsatisfiable);
            }
            Range::Bytes(length.saturating_sub(suffix), length - 1)
        }
        (false, _) => {
            let start: u64 = first.parse().ok()?;
            let end: u64 = if last.is_empty() { u64::MAX } else { last.parse().ok()? };
            if end < start {
                return None;
            }
            if start >= length {
                return Some(Range::Unsatisfiable);
            }
            Range::Bytes(start, end.min(length - 1))
        }
    };
    Some(range)
}

fn attachment(name: &str) -> String {
    let ascii: String = name
        .chars()
        .map(|c| if c.is_ascii() && !c.is_ascii_control() && c != '"' && c != '\\' { c } else { '_' })
        .collect();
    let mut encoded = String::new();
    for byte in name.bytes() {
        if byte.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_range(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::RANGE, HeaderValue::from_str(value).unwrap());
        headers
    }

    #[test]
    fn ranges_follow_rfc_9110() {
        let cases = ["bytes=0-99", "bytes=-10", "bytes=990-", "bytes=5000-", "bytes=0-1,5-6", "items=0-1", "bytes=9-3"];
        let parsed: Vec<_> = cases.iter().map(|value| requested_range(&with_range(value), 1000)).collect();
        assert_eq!(
            parsed,
            [
                Some(Range::Bytes(0, 99)),
                Some(Range::Bytes(990, 999)),
                Some(Range::Bytes(990, 999)),
                Some(Range::Unsatisfiable),
                None,
                None,
                None,
            ]
        );
    }

    #[test]
    fn attachment_names_match_aspnet() {
        assert_eq!(
            attachment("Northbound Static - Crossing.mp3"),
            "attachment; filename=\"Northbound Static - Crossing.mp3\"; filename*=UTF-8''Northbound%20Static%20-%20Crossing.mp3"
        );
    }

    #[test]
    fn non_ascii_names_are_kept_in_the_utf8_form() {
        assert_eq!(attachment("Ёж.mp3"), "attachment; filename=\"__.mp3\"; filename*=UTF-8''%D0%81%D0%B6.mp3");
    }

    #[test]
    fn if_none_match_accepts_lists_and_weak_tags() {
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, HeaderValue::from_static("\"a\", W/\"b\""));
        assert!(etag_matches(&headers, "\"b\""));
    }
}
