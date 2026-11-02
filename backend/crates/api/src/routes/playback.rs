// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use app::playback::registry::{Holder, PlaybackRegistry};
use app::playback::signals::{self, RecordEventsRequest};
use app::playback::{self, PlaybackStateReport};
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use futures_util::Stream;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::extract::{Json, Query};
use crate::problem::ApiResult;
use crate::state::AppState;

const HEARTBEAT: Duration = Duration::from_secs(20);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/playback/state", put(report_state))
        .route("/api/playback/now", get(playing_elsewhere))
        .route("/api/playback/handoff", post(handoff))
        .route("/api/playback/session", get(session))
        .route("/api/playback/signals", post(record_signals))
}

async fn report_state(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(report): Json<PlaybackStateReport>,
) -> ApiResult<StatusCode> {
    playback::report(&state.playback, user.user_id, report)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceQuery {
    device_id: Option<String>,
    device_name: Option<String>,
}

async fn playing_elsewhere(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<DeviceQuery>,
) -> ApiResult<Response> {
    Ok(match playback::elsewhere(&state.db, &state.playback, user.user_id, query.device_id.as_deref()).await? {
        Some(elsewhere) => Json(elsewhere).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandoffRequest {
    device_id: Option<String>,
}

async fn handoff(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<HandoffRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(playback::handoff(&state.db, &state.playback, user.user_id, request.device_id.as_deref()).await?))
}

async fn record_signals(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<RecordEventsRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::ACCEPTED, Json(signals::record(&state.db, user.user_id, request).await?)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TakeoverDto {
    device_id: String,
    device_name: String,
}

struct Claim {
    registry: PlaybackRegistry,
    user: Uuid,
    holder: Arc<Holder>,
}

impl Drop for Claim {
    fn drop(&mut self) {
        self.registry.release(self.user, &self.holder);
    }
}

async fn session(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<DeviceQuery>,
) -> ApiResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let device_id = playback::require_device(query.device_id.as_deref())?.to_owned();
    let device_name = query.device_name.unwrap_or_default();
    let holder = state.playback.claim(user.user_id, &device_id, &device_name);
    let claim = Claim { registry: state.playback, user: user.user_id, holder };

    Ok(Sse::new(session_events(claim, device_id, state.shutdown)))
}

fn session_events(
    claim: Claim,
    device_id: String,
    cancel: CancellationToken,
) -> impl Stream<Item = Result<Event, Infallible>> {
    enum Step {
        Claimed,
        Watching,
        Done,
    }

    futures_util::stream::unfold(
        (Step::Claimed, claim, device_id, cancel),
        |(step, claim, device_id, cancel)| async move {
            if cancel.is_cancelled() {
                return None;
            }
            match step {
                Step::Claimed => {
                    let event = Event::default().event("claimed").data(device_id.clone());
                    Some((Ok(event), (Step::Watching, claim, device_id, cancel)))
                }
                Step::Watching => match tokio::select! {
                    biased;
                    () = cancel.cancelled() => return None,
                    displaced = claim.holder.displaced_within(HEARTBEAT) => displaced,
                } {
                    None => {
                        Some((Ok(Event::default().event("ping").data("")), (Step::Watching, claim, device_id, cancel)))
                    }
                    Some(by) => {
                        let takeover = TakeoverDto { device_id: by.device_id, device_name: by.device_name };
                        let data = serde_json::to_string(&takeover).unwrap_or_default();
                        Some((
                            Ok(Event::default().event("displaced").data(data)),
                            (Step::Done, claim, device_id, cancel),
                        ))
                    }
                },
                Step::Done => None,
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt;

    #[tokio::test]
    async fn shutdown_closes_a_playback_session_without_waiting_for_a_heartbeat() {
        let registry = PlaybackRegistry::default();
        let user = Uuid::now_v7();
        let holder = registry.claim(user, "device", "Phone");
        let claim = Claim { registry, user, holder };
        let cancel = CancellationToken::new();
        let mut events = std::pin::pin!(session_events(claim, "device".into(), cancel.clone()));
        assert!(events.next().await.is_some());
        let mut next = std::pin::pin!(events.next());
        assert!(
            std::future::poll_fn(|cx| std::task::Poll::Ready(
                std::future::Future::poll(next.as_mut(), cx).is_pending()
            ))
            .await
        );
        cancel.cancel();
        assert!(next.await.is_none());
    }

    #[tokio::test]
    async fn an_open_sse_connection_does_not_prevent_http_shutdown() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let cancel = CancellationToken::new();
        let stream_cancel = cancel.clone();
        let router = Router::new().route(
            "/session",
            get(move || {
                let cancel = stream_cancel.clone();
                async move {
                    let registry = PlaybackRegistry::default();
                    let user = Uuid::now_v7();
                    let holder = registry.claim(user, "device", "Phone");
                    Sse::new(session_events(Claim { registry, user, holder }, "device".into(), cancel))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = axum::serve(listener, router).with_graceful_shutdown(cancel.clone().cancelled_owned());
        let (stop, signal) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(crate::lifecycle::serve(
            std::future::IntoFuture::into_future(server),
            vec![],
            cancel,
            async {
                let _ = signal.await;
            },
        ));
        let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
        client.write_all(b"GET /session HTTP/1.1\r\nHost: localhost\r\n\r\n").await.unwrap();
        let mut response = Vec::new();
        let mut buffer = [0; 1024];
        tokio::time::timeout(Duration::from_secs(2), async {
            while !response.windows(b"claimed".len()).any(|window| window == b"claimed") {
                let read = client.read(&mut buffer).await.unwrap();
                assert_ne!(read, 0, "SSE ended before the session was claimed");
                response.extend_from_slice(&buffer[..read]);
            }
        })
        .await
        .unwrap();
        stop.send(()).unwrap();
        // Keep the client connected: the server must close the stream itself.
        tokio::time::timeout(Duration::from_secs(2), server).await.unwrap().unwrap().unwrap();
    }
}
