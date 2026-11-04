// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::extract::request_lang;
use app::AppError;
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

pub type ApiResult<T> = Result<T, ApiError>;

const JSON: &str = "application/json; charset=utf-8";
const PROBLEM_JSON: &str = "application/problem+json; charset=utf-8";

#[derive(Debug)]
pub struct ApiError {
    error: AppError,
    style: Style,
}

#[derive(Debug, Clone, Copy)]
enum Style {
    Service,
    Http,
}

impl ApiError {
    pub fn http(error: AppError) -> Self {
        Self { error, style: Style::Http }
    }
}

impl<E: Into<AppError>> From<E> for ApiError {
    fn from(error: E) -> Self {
        Self { error: error.into(), style: Style::Service }
    }
}

#[derive(Clone)]
enum Pending {
    App(Arc<AppError>, Style),
    Validation(BTreeMap<String, Vec<String>>),
}

#[derive(Clone)]
pub struct Reason(pub String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.error.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let reason = match &self.error {
            AppError::Internal(error) => format!("{error:#}"),
            other => other.to_string(),
        };

        let mut response = status.into_response();
        if let Some(retry_after) = self.error.retry_after() {
            response.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(retry_after.as_secs().max(1)));
        }
        response.extensions_mut().insert(Reason(reason));
        response.extensions_mut().insert(Pending::App(Arc::new(self.error), self.style));
        response
    }
}

pub fn validation_problem(field: &str, message: String) -> Response {
    let mut response = StatusCode::BAD_REQUEST.into_response();
    response.extensions_mut().insert(Reason(format!("{field}: {message}")));
    response.extensions_mut().insert(Pending::Validation(BTreeMap::from([(field.to_owned(), vec![message])])));
    response
}

pub fn bare(status: StatusCode, reason: &str) -> Response {
    let mut response = status.into_response();
    response.extensions_mut().insert(Reason(reason.to_owned()));
    response
}

#[derive(Serialize)]
struct Problem<'a> {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    title: &'a str,
    status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    errors: Option<&'a BTreeMap<String, Vec<String>>>,
}

fn rfc_section(status: StatusCode) -> Option<&'static str> {
    Some(match status.as_u16() {
        400 => "https://tools.ietf.org/html/rfc9110#section-15.5.1",
        401 => "https://tools.ietf.org/html/rfc9110#section-15.5.2",
        403 => "https://tools.ietf.org/html/rfc9110#section-15.5.4",
        404 => "https://tools.ietf.org/html/rfc9110#section-15.5.5",
        409 => "https://tools.ietf.org/html/rfc9110#section-15.5.10",
        413 => "https://tools.ietf.org/html/rfc9110#section-15.5.14",
        429 => "https://tools.ietf.org/html/rfc6585#section-4",
        500 => "https://tools.ietf.org/html/rfc9110#section-15.6.1",
        _ => return None,
    })
}

pub async fn finish(request: Request, next: Next) -> Response {
    let lang = request_lang(request.headers());
    let path = request.uri().path().to_owned();

    let mut response = next.run(request).await;
    response.headers_mut().insert(header::CONTENT_LANGUAGE, HeaderValue::from_static(lang.code()));

    let Some(pending) = response.extensions_mut().remove::<Pending>() else {
        if response.headers().get(header::CONTENT_TYPE).is_some_and(|value| value == "application/json") {
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(JSON));
        }
        return response;
    };

    let status = response.status();
    let title = status.canonical_reason().unwrap_or("Error");

    let (body, content_type) = match &pending {
        Pending::App(error, style) => {
            let detail = match error.message() {
                Some(message) => message.localized(lang),
                None => app::i18n::localize("An unexpected error occurred.", &[], lang),
            };
            let (kind, instance, content_type) = match style {
                Style::Service => (None, Some(path.as_str()), JSON),
                Style::Http => (rfc_section(status), None, PROBLEM_JSON),
            };
            let problem =
                Problem { kind, title, status: status.as_u16(), detail: Some(detail), instance, errors: None };
            (serde_json::to_vec(&problem), content_type)
        }
        Pending::Validation(errors) => {
            let title = app::i18n::localize("One or more validation errors occurred.", &[], lang);
            let problem = Problem {
                kind: rfc_section(status),
                title: &title,
                status: status.as_u16(),
                detail: None,
                instance: None,
                errors: Some(errors),
            };
            (serde_json::to_vec(&problem), PROBLEM_JSON)
        }
    };

    let Ok(body) = body else {
        return response;
    };

    let (mut parts, _) = response.into_parts();
    parts.headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(parts, body.into())
}
