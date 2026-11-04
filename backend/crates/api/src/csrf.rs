// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::AppError;
use axum::extract::Request;
use axum::http::{HeaderMap, Method, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::problem::ApiError;

pub async fn reject_cross_origin(request: Request, next: Next) -> Response {
    if cross_origin(request.method(), request.headers()) {
        tracing::warn!("Rejected a cross-site {} {}", request.method(), request.uri().path());
        return ApiError::http(AppError::forbidden("Cross-site requests are not allowed.")).into_response();
    }
    next.run(request).await
}

fn cross_origin(method: &Method, headers: &HeaderMap) -> bool {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return false;
    }
    if let Some(site) = headers.get("sec-fetch-site").and_then(|value| value.to_str().ok()) {
        return !matches!(site, "same-origin" | "none");
    }
    let Some(origin) = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let Some((_, origin_host)) = origin.split_once("://") else {
        return true;
    };
    !hosts(headers).any(|host| host.eq_ignore_ascii_case(origin_host))
}

fn hosts(headers: &HeaderMap) -> impl Iterator<Item = &str> {
    [header::HOST.as_str(), "x-forwarded-host"]
        .into_iter()
        .flat_map(|name| headers.get_all(name).iter())
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.append(*name, HeaderValue::from_static(value));
        }
        headers
    }

    #[test]
    fn reads_are_never_blocked() {
        let from_elsewhere = headers(&[("sec-fetch-site", "cross-site")]);
        assert!(!cross_origin(&Method::GET, &from_elsewhere));
    }

    #[test]
    fn fetch_metadata_decides_for_browsers() {
        for (site, blocked) in [("same-origin", false), ("none", false), ("same-site", true), ("cross-site", true)] {
            let request = headers(&[("sec-fetch-site", site), ("origin", "https://music.example.com")]);
            assert_eq!(cross_origin(&Method::POST, &request), blocked, "{site}");
        }
    }

    #[test]
    fn origin_must_match_the_host_without_fetch_metadata() {
        let own = headers(&[("origin", "https://music.example.com"), ("host", "music.example.com")]);
        let foreign = headers(&[("origin", "https://evil.example"), ("host", "music.example.com")]);
        let opaque = headers(&[("origin", "null"), ("host", "music.example.com")]);

        assert!(!cross_origin(&Method::DELETE, &own));
        assert!(cross_origin(&Method::DELETE, &foreign));
        assert!(cross_origin(&Method::DELETE, &opaque));
    }

    #[test]
    fn forwarded_host_counts_behind_a_dev_proxy() {
        let proxied = headers(&[
            ("origin", "http://localhost:3000"),
            ("host", "127.0.0.1:5199"),
            ("x-forwarded-host", "localhost:3000"),
        ]);
        assert!(!cross_origin(&Method::PUT, &proxied));
    }

    #[test]
    fn clients_without_a_browser_pass() {
        let android = headers(&[("authorization", "Bearer token"), ("host", "music.example.com")]);
        assert!(!cross_origin(&Method::POST, &android));
    }
}
