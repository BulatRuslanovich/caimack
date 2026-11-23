// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::{AppError, AppResult};

#[derive(Clone, Serialize)]
#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    Search { query: String },
    Playlist { source: String },
    Download { query: String, track_id: String },
    PlaylistTrack { source: String, track_id: String },
}

#[derive(Serialize)]
pub struct Ticket {
    id: Uuid,
    #[serde(flatten)]
    command: Command,
}

struct Pending {
    user: Uuid,
    action: Option<Command>,
    sender: oneshot::Sender<Result<Value, String>>,
}

#[derive(Default)]
struct State {
    pending: HashMap<Uuid, Pending>,
    queue: VecDeque<Uuid>,
    seen: HashMap<Uuid, Instant>,
}

#[derive(Default)]
pub struct Browser(Mutex<State>);

impl Browser {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn ready(&self, user: Uuid) -> bool {
        self.lock().seen.get(&user).is_some_and(|seen| seen.elapsed() < Duration::from_secs(75))
    }

    pub fn next(&self, user: Uuid) -> Option<Ticket> {
        let mut state = self.lock();
        state.seen.retain(|_, seen| seen.elapsed() < Duration::from_secs(75));
        state.seen.insert(user, Instant::now());
        state.pending.retain(|_, entry| !entry.sender.is_closed());
        let State { pending, queue, .. } = &mut *state;
        queue.retain(|id| pending.contains_key(id));
        if pending.values().any(|entry| entry.user == user && entry.action.is_none()) {
            return None;
        }
        let index = queue.iter().position(|id| pending.get(id).is_some_and(|entry| entry.user == user))?;
        let id = queue.remove(index)?;
        let command = pending.get_mut(&id)?.action.take()?;
        Some(Ticket { id, command })
    }

    pub fn complete(&self, user: Uuid, id: Uuid, value: Result<Value, String>) -> AppResult<()> {
        let mut state = self.lock();
        if !state.pending.get(&id).is_some_and(|entry| entry.user == user && entry.action.is_none()) {
            return Err(AppError::not_found("Browser request expired."));
        }
        if value.as_ref().is_err_and(|code| matches!(code.as_str(), "openVk" | "extensionMissing" | "signInVk")) {
            state.seen.remove(&user);
        }
        if let Some(entry) = state.pending.remove(&id) {
            let _ = entry.sender.send(value);
        }
        Ok(())
    }

    pub async fn request(&self, user: Uuid, command: Command, timeout: Duration) -> AppResult<Value> {
        if !self.ready(user) {
            return Err(AppError::validation("Open VK Music in a connected browser."));
        }
        let id = Uuid::now_v7();
        let (sender, receiver) = oneshot::channel();
        {
            let mut state = self.lock();
            if state.pending.values().filter(|entry| entry.user == user && !entry.sender.is_closed()).count() >= 8 {
                return Err(AppError::conflict("The VK browser is busy."));
            }
            state.pending.insert(id, Pending { user, action: Some(command), sender });
            state.queue.push_back(id);
        }

        let result = tokio::time::timeout(timeout, receiver).await;
        {
            let mut state = self.lock();
            state.pending.remove(&id);
            if !matches!(result, Ok(Ok(_))) {
                state.seen.remove(&user);
            }
        }
        match result {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(error))) => {
                Err(AppError::validation("VK Music: {0}").arg(error.chars().take(64).collect::<String>()))
            }
            _ => Err(AppError::validation("The VK Music browser did not answer.")),
        }
    }
}
