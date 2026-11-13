// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::time::Duration;

use anyhow::{Context, bail};
use media::mert::{self, DIMENSION, MODEL_ID, REVISION, windows::STRATEGY};
use serde::Deserialize;

use crate::config::ModelConfig;

pub struct MertClient {
    client: reqwest::Client,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    model: String,
    revision: String,
    strategy: String,
    dimension: usize,
}

impl Identity {
    fn validate(&self) -> anyhow::Result<()> {
        if self.model != MODEL_ID
            || self.revision != REVISION
            || self.strategy != STRATEGY
            || self.dimension != DIMENSION
        {
            bail!("MERT service uses incompatible weights or preprocessing");
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct Embedding {
    #[serde(flatten)]
    identity: Identity,
    vector: Vec<f32>,
}

#[derive(Deserialize)]
struct Health {
    #[serde(flatten)]
    identity: Identity,
    // An older service only returns the identity and is always loaded.
    state: Option<String>,
}

impl MertClient {
    pub fn new(config: &ModelConfig) -> anyhow::Result<Self> {
        Ok(Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(120))
                .build()?,
            url: config.url.trim_end_matches('/').to_owned(),
        })
    }

    pub async fn ready(&self) -> anyhow::Result<()> {
        let health: Health = self
            .client
            .get(format!("{}/health", self.url))
            .timeout(Duration::from_secs(5))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        health.identity.validate()?;
        match health.state.as_deref() {
            None | Some("sleeping" | "ready" | "busy") => Ok(()),
            Some(state) => bail!("MERT service is {state}; embeddings will be retried later"),
        }
    }

    pub async fn embed(&self, windows: &[Vec<f32>]) -> anyhow::Result<Vec<f32>> {
        let body = encode(windows)?;
        let result: Embedding = self
            .client
            .post(format!("{}/embed", self.url))
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .send()
            .await
            .context("MERT service request failed")?
            .error_for_status()?
            .json()
            .await?;
        result.identity.validate()?;
        validate_vector(&result.vector)?;
        Ok(result.vector)
    }
}

fn encode(windows: &[Vec<f32>]) -> anyhow::Result<Vec<u8>> {
    if windows.is_empty() || windows.len() > mert::windows::MAX_WINDOWS {
        bail!("Invalid MERT fragment count");
    }
    let mut body = Vec::with_capacity(4 + windows.iter().map(|window| 4 + window.len() * 4).sum::<usize>());
    body.extend_from_slice(&(windows.len() as u32).to_le_bytes());
    for window in windows {
        if window.is_empty() || window.len() > mert::WINDOW_SAMPLES || window.iter().any(|value| !value.is_finite()) {
            bail!("Invalid MERT audio fragment");
        }
        body.extend_from_slice(&(window.len() as u32).to_le_bytes());
        body.extend(window.iter().flat_map(|sample| sample.to_le_bytes()));
    }
    Ok(body)
}

fn validate_vector(vector: &[f32]) -> anyhow::Result<()> {
    let norm: f32 = vector.iter().map(|value| value * value).sum();
    if vector.len() != DIMENSION || !norm.is_finite() || (norm - 1.0).abs() > 0.01 {
        bail!("MERT returned an invalid or unnormalized embedding");
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    use super::*;

    pub(crate) fn health(state: &str) -> Value {
        json!({"model": MODEL_ID, "revision": REVISION, "strategy": STRATEGY,
               "dimension": DIMENSION, "state": state})
    }

    pub(crate) async fn server(responses: Vec<(u16, Value)>) -> (MertClient, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client =
            MertClient::new(&ModelConfig { url: format!("http://{}", listener.local_addr().unwrap()) }).unwrap();
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for (status, body) in responses {
                let (socket, _) = listener.accept().await.unwrap();
                let mut socket = BufReader::new(socket);
                let mut line = String::new();
                socket.read_line(&mut line).await.unwrap();
                requests.push(line.trim().to_owned());
                let mut length = 0;
                loop {
                    line.clear();
                    assert_ne!(socket.read_line(&mut line).await.unwrap(), 0);
                    if line == "\r\n" {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':')
                        && name.eq_ignore_ascii_case("content-length")
                    {
                        length = value.trim().parse().unwrap();
                    }
                }
                let mut pcm = vec![0; length];
                socket.read_exact(&mut pcm).await.unwrap();
                let body = body.to_string();
                let response = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.get_mut().write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        (client, task)
    }

    #[tokio::test]
    async fn health_accepts_sleeping_workers_without_waking_them() {
        for state in ["sleeping", "ready", "busy"] {
            let (client, task) = server(vec![(200, health(state))]).await;
            client.ready().await.unwrap();
            assert_eq!(task.await.unwrap(), ["GET /health HTTP/1.1"]);
        }
    }

    #[tokio::test]
    async fn health_defers_loading_failed_and_unknown_workers() {
        for state in ["loading", "error", "unexpected"] {
            let (client, task) = server(vec![(200, health(state))]).await;
            assert!(client.ready().await.is_err(), "state {state} should defer embeddings");
            task.await.unwrap();
        }
    }

    #[tokio::test]
    async fn health_still_validates_identity_and_supports_older_services() {
        let mut legacy = health("ready");
        legacy.as_object_mut().unwrap().remove("state");
        let mut incompatible = health("sleeping");
        incompatible["revision"] = json!("wrong");
        let (client, task) = server(vec![(200, legacy), (200, incompatible)]).await;
        client.ready().await.unwrap();
        assert!(client.ready().await.is_err());
        task.await.unwrap();
    }

    #[test]
    fn pcm_wire_format_is_little_endian_and_length_prefixed() {
        assert_eq!(
            encode(&[vec![0.5, -1.0]]).unwrap(),
            [1_u32.to_le_bytes(), 2_u32.to_le_bytes(), 0.5_f32.to_le_bytes(), (-1.0_f32).to_le_bytes()].concat()
        );
        assert!(encode(&[vec![f32::NAN]]).is_err());
        assert!(encode(&[]).is_err());
    }

    #[test]
    fn old_model_vectors_cannot_enter_the_index() {
        assert!(validate_vector(&vec![0.0; 512]).is_err());
        assert!(validate_vector(&vec![0.0; DIMENSION]).is_err());
        let mut valid = vec![0.0; DIMENSION];
        valid[0] = 1.0;
        assert!(validate_vector(&valid).is_ok());
        valid[1] = f32::NAN;
        assert!(validate_vector(&valid).is_err());
    }
}
