// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::Notify;
use uuid::Uuid;

const STATE_LIFETIME: chrono::Duration = chrono::Duration::hours(12);

#[derive(Debug, Clone, PartialEq)]
pub struct PlaybackState {
    pub device_id: String,
    pub device_name: String,
    pub track_ids: Vec<Uuid>,
    pub index: usize,
    pub position_seconds: f64,
    pub is_playing: bool,
    pub shuffle: bool,
    pub repeat: String,
    pub reported_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Takeover {
    pub device_id: String,
    pub device_name: String,
}

pub struct Holder {
    pub device_id: String,
    pub device_name: String,
    displaced: Notify,
    displaced_by: Mutex<Option<Takeover>>,
}

impl Holder {
    fn displace(&self, by: &Holder) {
        if let Ok(mut slot) = self.displaced_by.lock() {
            *slot = Some(Takeover { device_id: by.device_id.clone(), device_name: by.device_name.clone() });
        }
        self.displaced.notify_one();
    }

    pub async fn displaced_within(&self, within: Duration) -> Option<Takeover> {
        if tokio::time::timeout(within, self.displaced.notified()).await.is_err() {
            return None;
        }
        self.displaced_by.lock().ok().and_then(|slot| slot.clone())
    }
}

#[derive(Default)]
struct Inner {
    holders: HashMap<Uuid, Arc<Holder>>,
    states: HashMap<Uuid, PlaybackState>,
}

#[derive(Default, Clone)]
pub struct PlaybackRegistry {
    inner: Arc<Mutex<Inner>>,
    pub connect: super::connect::ConnectRegistry,
}

impl PlaybackRegistry {
    pub fn claim(&self, user: Uuid, device_id: &str, device_name: &str) -> Arc<Holder> {
        let holder = Arc::new(Holder {
            device_id: device_id.to_owned(),
            device_name: device_name.to_owned(),
            displaced: Notify::new(),
            displaced_by: Mutex::new(None),
        });

        let previous = self.inner.lock().ok().and_then(|mut inner| inner.holders.insert(user, Arc::clone(&holder)));
        if let Some(previous) = previous
            && previous.device_id != device_id
        {
            previous.displace(&holder);
        }
        holder
    }

    pub fn release(&self, user: Uuid, holder: &Arc<Holder>) {
        if let Ok(mut inner) = self.inner.lock()
            && inner.holders.get(&user).is_some_and(|current| Arc::ptr_eq(current, holder))
        {
            inner.holders.remove(&user);
        }
    }

    pub fn report(&self, user: Uuid, state: PlaybackState) -> bool {
        let Ok(mut inner) = self.inner.lock() else { return false };
        let accepted = match inner.holders.get(&user) {
            Some(holder) => holder.device_id == state.device_id,
            None => {
                state.is_playing
                    || inner.states.get(&user).is_none_or(|last| last.device_id == state.device_id || abandoned(last))
            }
        };
        if accepted {
            inner.states.insert(user, state);
        }
        accepted
    }

    pub fn elsewhere(&self, user: Uuid, device_id: &str) -> Option<PlaybackState> {
        let (state, live) = {
            let inner = self.inner.lock().ok()?;
            let state = inner.states.get(&user).filter(|state| state.device_id != device_id)?.clone();
            let live = inner.holders.get(&user).is_some_and(|holder| holder.device_id == state.device_id);
            (state, live)
        };

        if !live && abandoned(&state) {
            return None;
        }
        if !state.is_playing {
            return Some(state);
        }
        if !live {
            return Some(PlaybackState { is_playing: false, ..state });
        }
        let elapsed = (Utc::now() - state.reported_at).num_milliseconds().max(0) as f64 / 1000.0;
        Some(PlaybackState { position_seconds: state.position_seconds + elapsed, ..state })
    }
}

fn abandoned(state: &PlaybackState) -> bool {
    Utc::now() - state.reported_at > STATE_LIFETIME
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(device: &str, playing: bool) -> PlaybackState {
        PlaybackState {
            device_id: device.to_owned(),
            device_name: device.to_owned(),
            track_ids: vec![Uuid::nil()],
            index: 0,
            position_seconds: 10.0,
            is_playing: playing,
            shuffle: false,
            repeat: "off".to_owned(),
            reported_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn new_session_on_another_device_displaces_the_holder() {
        let registry = PlaybackRegistry::default();
        let user = Uuid::now_v7();
        let phone = registry.claim(user, "phone", "Phone");
        let _laptop = registry.claim(user, "laptop", "Laptop");

        let takeover = phone.displaced_within(Duration::from_millis(50)).await;

        assert_eq!(takeover, Some(Takeover { device_id: "laptop".to_owned(), device_name: "Laptop".to_owned() }));
    }

    #[test]
    fn only_the_holder_may_report() {
        let registry = PlaybackRegistry::default();
        let user = Uuid::now_v7();
        let _phone = registry.claim(user, "phone", "Phone");

        assert_eq!(
            [registry.report(user, state("laptop", true)), registry.report(user, state("phone", true))],
            [false, true]
        );
    }

    #[test]
    fn paused_state_without_holder_is_shown_paused_elsewhere() {
        let registry = PlaybackRegistry::default();
        let user = Uuid::now_v7();
        registry.report(user, state("laptop", true));

        let seen = registry.elsewhere(user, "phone");

        assert_eq!(seen.map(|s| (s.is_playing, s.position_seconds)), Some((false, 10.0)));
    }

    #[test]
    fn own_device_sees_nothing_elsewhere() {
        let registry = PlaybackRegistry::default();
        let user = Uuid::now_v7();
        registry.report(user, state("laptop", false));
        assert!(registry.elsewhere(user, "laptop").is_none());
    }
}
