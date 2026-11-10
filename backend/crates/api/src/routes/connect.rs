// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::convert::Infallible;
use std::time::Duration;

use app::AppError;
use app::playback::connect::{self, ConnectRegistry, Connection, Playback, Snapshot};
use app::playback::{self, PlaybackStateReport};
use axum::Router;
use axum::extract::{FromRef, Path, State};
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post, put};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::extract::{Json, Query};
use crate::problem::ApiResult;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    routes()
}

#[derive(Clone)]
struct ConnectApiState {
    playback: app::playback::registry::PlaybackRegistry,
    shutdown: tokio_util::sync::CancellationToken,
}

impl FromRef<AppState> for ConnectApiState {
    fn from_ref(state: &AppState) -> Self {
        Self { playback: state.playback.clone(), shutdown: state.shutdown.clone() }
    }
}

fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    ConnectApiState: FromRef<S>,
{
    Router::new()
        .route("/api/playback/connect/events", get(events))
        .route("/api/playback/connect/state", put(report))
        .route("/api/playback/connect/heartbeat", post(heartbeat))
        .route("/api/playback/connect/commands", post(command))
        .route("/api/playback/connect/commands/{id}/ack", post(acknowledge))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceQuery {
    device_id: String,
    #[serde(default)]
    device_name: String,
    #[serde(default)]
    device_kind: String,
}

struct Presence {
    registry: ConnectRegistry,
    user: Uuid,
    device: String,
    connection: Connection,
}

impl Drop for Presence {
    fn drop(&mut self) {
        self.registry.unregister(self.user, &self.device, self.connection.id);
    }
}

async fn events(
    State(state): State<ConnectApiState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<DeviceQuery>,
) -> ApiResult<impl IntoResponse> {
    let registry = state.playback.connect;
    let connection =
        registry.register_device(user.user_id, &query.device_id, &query.device_name, &query.device_kind)?;
    let presence = Presence { registry, user: user.user_id, device: query.device_id, connection };
    let stream = futures_util::stream::unfold(
        (presence, true, state.shutdown),
        |(mut presence, initial, shutdown)| async move {
            if shutdown.is_cancelled() {
                return None;
            }
            let event = if initial {
                Event::default().event("snapshot").json_data(presence.registry.snapshot(presence.user).ok()?).ok()?
            } else {
                tokio::select! {
                    biased;
                    () = shutdown.cancelled() => return None,
                    command = presence.connection.commands.recv() => {
                        Event::default().event("command").json_data(command?).ok()?
                    }
                    changed = presence.connection.changed.changed() => {
                        changed.ok()?;
                        Event::default().event("snapshot").json_data(presence.registry.snapshot(presence.user).ok()?).ok()?
                    }
                    () = tokio::time::sleep(Duration::from_secs(15)) => {
                        Event::default().event("snapshot").json_data(presence.registry.snapshot(presence.user).ok()?).ok()?
                    }
                }
            };
            Some((Ok::<_, Infallible>(event), (presence, false, shutdown)))
        },
    );
    // Compression can buffer snapshots until the device lease expires, before
    // the browser has received its connection ID and can send a heartbeat.
    Ok((
        [("cache-control", "no-cache, no-transform"), ("x-accel-buffering", "no")],
        Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    device_id: String,
    connection_id: Uuid,
    state: Playback,
}

async fn report(
    State(state): State<ConnectApiState>,
    CurrentUser(user): CurrentUser,
    Json(report): Json<Report>,
) -> ApiResult<Json<Snapshot>> {
    let hub = &state.playback.connect;
    if !hub.is_connected(user.user_id, &report.device_id, report.connection_id)? {
        return Err(AppError::conflict("Playback device disconnected.").into());
    }
    report.state.validate()?;
    // Preserve the exclusive renderer contract and the existing handoff API.
    if !report.state.track_ids.is_empty() {
        playback::report(
            &state.playback,
            user.user_id,
            PlaybackStateReport {
                device_id: Some(report.device_id.clone()),
                device_name: hub
                    .snapshot(user.user_id)?
                    .devices
                    .into_iter()
                    .find(|device| device.id == report.device_id)
                    .map(|device| device.name),
                track_ids: Some(report.state.track_ids.clone()),
                index: report.state.index as i32,
                position_seconds: report.state.position_seconds,
                is_playing: report.state.is_playing,
                shuffle: report.state.shuffle,
                repeat: Some(report.state.repeat.clone()),
            },
        )?;
    } else if hub.snapshot(user.user_id)?.playback.is_some_and(|active| active.device_id != report.device_id) {
        return Err(AppError::conflict("Another device holds playback.").into());
    }
    hub.report(user.user_id, &report.device_id, report.connection_id, report.state)?;
    Ok(Json(hub.snapshot(user.user_id)?))
}

async fn command(
    State(state): State<ConnectApiState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<connect::CommandRequest>,
) -> ApiResult<Json<Snapshot>> {
    let mut receipt = state.playback.connect.send(user.user_id, request)?;
    let outcome = tokio::time::timeout(connect::COMMAND_TIMEOUT, async {
        loop {
            if let Some(outcome) = receipt.borrow().clone() {
                return Some(outcome);
            }
            if receipt.changed().await.is_err() {
                return None;
            }
        }
    })
    .await;
    match outcome {
        Ok(Some(Ok(()))) => Ok(Json(state.playback.connect.snapshot(user.user_id)?)),
        Ok(Some(Err(_))) => Err(AppError::conflict("Playback device could not apply the command.").into()),
        _ => Err(AppError::conflict("Playback device is not responding.").into()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Acknowledgement {
    device_id: String,
    connection_id: Uuid,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Heartbeat {
    device_id: String,
    connection_id: Uuid,
}

async fn heartbeat(
    State(state): State<ConnectApiState>,
    CurrentUser(user): CurrentUser,
    Json(beat): Json<Heartbeat>,
) -> ApiResult<axum::http::StatusCode> {
    state.playback.connect.heartbeat(user.user_id, &beat.device_id, beat.connection_id)?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn acknowledge(
    State(state): State<ConnectApiState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
    Json(ack): Json<Acknowledgement>,
) -> ApiResult<axum::http::StatusCode> {
    state.playback.connect.acknowledge(user.user_id, &ack.device_id, ack.connection_id, id, ack.error)?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use app::auth::tokens::Principal;
    use axum::Extension;
    use serde_json::{Value, json};

    struct Events {
        response: reqwest::Response,
        buffered: String,
    }

    impl Events {
        async fn next(&mut self, kind: &str) -> Value {
            tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    while let Some(end) = self.buffered.find("\n\n") {
                        let event = self.buffered[..end].to_owned();
                        self.buffered.drain(..end + 2);
                        if event.lines().any(|line| line == format!("event: {kind}")) {
                            let data = event.lines().find_map(|line| line.strip_prefix("data: ")).unwrap();
                            return serde_json::from_str(data).unwrap();
                        }
                    }
                    let chunk = self.response.chunk().await.unwrap().expect("SSE closed unexpectedly");
                    self.buffered.push_str(std::str::from_utf8(&chunk).unwrap());
                }
            })
            .await
            .expect("SSE event did not arrive")
        }
    }

    async fn server() -> (String, reqwest::Client, tokio_util::sync::CancellationToken) {
        let state = ConnectApiState { playback: Default::default(), shutdown: Default::default() };
        let shutdown = state.shutdown.clone();
        let user = Principal {
            user_id: Uuid::now_v7(),
            username: "listener".into(),
            session_id: Uuid::now_v7(),
            is_admin: false,
        };
        let router = routes().with_state(state).layer(Extension(user));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let cancelled = shutdown.clone();
        tokio::spawn(async move {
            axum::serve(listener, router).with_graceful_shutdown(cancelled.cancelled_owned()).await.unwrap();
        });
        (url, reqwest::Client::new(), shutdown)
    }

    async fn device(client: &reqwest::Client, url: &str, id: &str) -> Events {
        let response = client
            .get(format!("{url}/api/playback/connect/events?deviceId={id}&deviceName={id}"))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();
        Events { response, buffered: String::new() }
    }

    #[tokio::test]
    async fn event_stream_disables_proxy_compression_and_buffering() {
        let (url, client, shutdown) = server().await;
        let response = client
            .get(format!("{url}/api/playback/connect/events?deviceId=computer"))
            .header("accept-encoding", "gzip, deflate, br")
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();
        assert_eq!(response.headers()["cache-control"], "no-cache, no-transform");
        assert_eq!(response.headers()["x-accel-buffering"], "no");
        let mut events = Events { response, buffered: String::new() };
        assert_eq!(events.next("snapshot").await["devices"][0]["id"], "computer");
        shutdown.cancel();
    }

    #[tokio::test]
    async fn http_command_waits_for_the_renderer_and_rejects_acknowledgements_from_other_connections() {
        let (url, client, shutdown) = server().await;
        let mut renderer = device(&client, &url, "computer").await;
        let snapshot = renderer.next("snapshot").await;
        let connection = snapshot["devices"][0]["connectionId"].clone();
        let mut controller = device(&client, &url, "phone").await;
        assert_eq!(controller.next("snapshot").await["devices"].as_array().unwrap().len(), 2);
        let id = Uuid::now_v7();
        let request = json!({"id":id,"deviceId":"computer","command":{"type":"setPlaying","playing":true}});
        let sending = client.post(format!("{url}/api/playback/connect/commands")).json(&request);
        let task = tokio::spawn(async move { sending.send().await.unwrap() });
        let command = renderer.next("command").await;
        assert_eq!(command["id"], id.to_string());
        assert!(!task.is_finished(), "delivery alone must not acknowledge a command");
        let ack_url = format!("{url}/api/playback/connect/commands/{id}/ack");
        let wrong = client
            .post(&ack_url)
            .json(&json!({"deviceId":"computer","connectionId":Uuid::now_v7()}))
            .send()
            .await
            .unwrap();
        assert_eq!(wrong.status(), reqwest::StatusCode::NOT_FOUND);
        assert!(!task.is_finished());
        let ack =
            client.post(ack_url).json(&json!({"deviceId":"computer","connectionId":connection})).send().await.unwrap();
        assert_eq!(ack.status(), reqwest::StatusCode::NO_CONTENT);
        assert_eq!(task.await.unwrap().status(), reqwest::StatusCode::OK);
        let retry = client.post(format!("{url}/api/playback/connect/commands")).json(&request).send().await.unwrap();
        assert_eq!(retry.status(), reqwest::StatusCode::OK);
        shutdown.cancel();
    }

    #[tokio::test]
    async fn live_queue_changes_are_published_and_stale_queue_commands_are_rejected() {
        let (url, client, shutdown) = server().await;
        let mut renderer = device(&client, &url, "computer").await;
        let connection = renderer.next("snapshot").await["devices"][0]["connectionId"].clone();
        let ids = [Uuid::now_v7(), Uuid::now_v7()];
        let mut state = json!({"trackIds":ids,"order":[0,1],"index":0,"positionSeconds":12.0,"isPlaying":true,"repeat":"off","volume":0.6});
        let state_url = format!("{url}/api/playback/connect/state");
        let snapshot: Value = client
            .put(&state_url)
            .json(&json!({"deviceId":"computer","connectionId":connection,"state":state}))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        let first_revision = snapshot["playback"]["queueRevision"].as_u64().unwrap();
        assert_eq!(snapshot["playback"]["volume"], 0.6);
        assert_eq!(renderer.next("snapshot").await["playback"]["trackIds"], json!(ids));
        state["trackIds"] = json!([ids[1], ids[0]]);
        let snapshot: Value = client
            .put(state_url)
            .json(&json!({"deviceId":"computer","connectionId":connection,"state":state}))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(snapshot["playback"]["queueRevision"].as_u64().unwrap() > first_revision);
        let stale = client
            .post(format!("{url}/api/playback/connect/commands"))
            .json(&json!({
                "id":Uuid::now_v7(),"deviceId":"computer","queueRevision":first_revision,
                "command":{"type":"remove","index":0,"trackId":ids[0]}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(stale.status(), reqwest::StatusCode::CONFLICT);
        shutdown.cancel();
    }
}
