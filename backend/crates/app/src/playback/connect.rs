// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

//! Account-scoped discovery and acknowledged commands. Audio and listening telemetry
//! are owned by the renderer; connecting a controller never claims playback.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};
use uuid::Uuid;

use crate::{AppError, AppResult};

pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const COMMAND_RETENTION: Duration = Duration::from_secs(120);
const MAX_DEVICES: usize = 32;
const MAX_COMMANDS: usize = 128;
const MAX_QUEUE: usize = 10_000;
const DEVICE_LEASE: Duration = Duration::from_secs(40);

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Playback {
    pub track_ids: Vec<Uuid>,
    pub index: usize,
    pub order: Vec<usize>,
    pub position_seconds: f64,
    pub is_playing: bool,
    pub buffering: bool,
    pub volume: f64,
    pub muted: bool,
    pub shuffle: bool,
    pub repeat: String,
    pub radio: Option<serde_json::Value>,
    pub crossfade: f64,
    pub smart_transitions: bool,
    pub normalize_volume: bool,
    pub autoplay: bool,
    pub sleep_timer: Option<serde_json::Value>,
}

impl Default for Playback {
    fn default() -> Self {
        Self {
            track_ids: Vec::new(),
            index: 0,
            order: Vec::new(),
            position_seconds: 0.0,
            is_playing: false,
            buffering: false,
            volume: 1.0,
            muted: false,
            shuffle: false,
            repeat: "off".into(),
            radio: None,
            crossfade: 0.0,
            smart_transitions: true,
            normalize_volume: false,
            autoplay: true,
            sleep_timer: None,
        }
    }
}

impl Playback {
    pub fn validate(&self) -> AppResult<()> {
        let len = self.track_ids.len();
        let order: HashSet<_> = self.order.iter().copied().collect();
        if len > MAX_QUEUE
            || (len == 0 && (self.index != 0 || self.is_playing))
            || (len > 0 && self.index >= len)
            || self.order.len() != len
            || order.len() != len
            || self.order.iter().any(|&index| index >= len)
            || !self.position_seconds.is_finite()
            || self.position_seconds < 0.0
            || !self.volume.is_finite()
            || !(0.0..=1.0).contains(&self.volume)
            || !self.crossfade.is_finite()
            || !(0.0..=30.0).contains(&self.crossfade)
            || !["off", "all", "one"].contains(&self.repeat.as_str())
            || self.radio.as_ref().is_some_and(|value| !value.get("reasons").is_some_and(serde_json::Value::is_object))
            || self.radio.as_ref().is_some_and(|value| value.to_string().len() > 256_000)
            || self.sleep_timer.as_ref().is_some_and(|value| value.to_string().len() > 256)
        {
            return Err(AppError::validation("Invalid playback state."));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    SetPlaying {
        playing: bool,
    },
    Next,
    Previous,
    Seek {
        position_seconds: f64,
    },
    SetVolume {
        volume: f64,
    },
    SetMuted {
        muted: bool,
    },
    SetShuffle {
        shuffle: bool,
    },
    SetRepeat {
        repeat: String,
    },
    Play {
        track_ids: Vec<Uuid>,
        index: usize,
        position_seconds: f64,
        playing: bool,
        shuffle: bool,
        repeat: String,
        source: Option<String>,
        order: Option<Vec<usize>>,
        radio: Option<serde_json::Value>,
    },
    Enqueue {
        track_id: Uuid,
        next: bool,
    },
    Remove {
        index: usize,
        track_id: Uuid,
    },
    Move {
        from: usize,
        to: usize,
        track_id: Uuid,
    },
    Jump {
        index: usize,
        track_id: Uuid,
    },
    Clear,
    ClearUpcoming,
    StartRadio {
        seed_track_id: Option<Uuid>,
    },
    SetRadioFocus {
        focus: String,
    },
    SetCrossfade {
        seconds: f64,
    },
    SetSmartTransitions {
        enabled: bool,
    },
    SetNormalizeVolume {
        enabled: bool,
    },
    SetAutoplay {
        enabled: bool,
    },
    SetSleepTimer {
        minutes: Option<u32>,
        track_end: bool,
    },
}

impl Command {
    fn validate(&self) -> AppResult<()> {
        let valid = match self {
            Self::Seek { position_seconds } => position_seconds.is_finite() && *position_seconds >= 0.0,
            Self::SetVolume { volume } => volume.is_finite() && (0.0..=1.0).contains(volume),
            Self::SetCrossfade { seconds } => seconds.is_finite() && (0.0..=30.0).contains(seconds),
            Self::SetRepeat { repeat } => ["off", "all", "one"].contains(&repeat.as_str()),
            Self::Play { track_ids, index, position_seconds, repeat, source, order, radio, .. } => {
                !track_ids.is_empty()
                    && track_ids.len() <= MAX_QUEUE
                    && *index < track_ids.len()
                    && position_seconds.is_finite()
                    && *position_seconds >= 0.0
                    && ["off", "all", "one"].contains(&repeat.as_str())
                    && source.as_ref().is_none_or(|source| source.len() <= 128)
                    && order.as_ref().is_none_or(|order| {
                        order.len() == track_ids.len()
                            && order.iter().copied().collect::<HashSet<_>>().len() == order.len()
                            && order.iter().all(|&index| index < order.len())
                    })
                    && radio.as_ref().is_none_or(|value| value.is_object() && value.to_string().len() <= 256_000)
            }
            Self::SetRadioFocus { focus } => ["closer", "balanced", "wider"].contains(&focus.as_str()),
            Self::SetSleepTimer { minutes, .. } => minutes.is_none_or(|minutes| (1..=1440).contains(&minutes)),
            _ => true,
        };
        if valid { Ok(()) } else { Err(AppError::validation("Invalid playback command.")) }
    }

    fn edits_queue(&self) -> bool {
        matches!(self, Self::Remove { .. } | Self::Move { .. } | Self::Jump { .. })
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandRequest {
    pub id: Uuid,
    pub device_id: String,
    pub queue_revision: Option<u64>,
    pub command: Command,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub queue_revision: Option<u64>,
    pub command: Command,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub connection_id: Uuid,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivePlayback {
    pub device_id: String,
    pub queue_revision: u64,
    pub reported_at: DateTime<Utc>,
    #[serde(flatten)]
    pub state: Playback,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub epoch: Uuid,
    pub version: u64,
    pub devices: Vec<Device>,
    pub playback: Option<ActivePlayback>,
}

type Outcome = Option<Result<(), String>>;

struct Pending {
    request: CommandRequest,
    connection_id: Uuid,
    created: Instant,
    outcome: watch::Sender<Outcome>,
}

struct Connected {
    device: Device,
    commands: mpsc::Sender<Envelope>,
    seen: Instant,
}

struct Account {
    devices: HashMap<String, Connected>,
    playback: Option<ActivePlayback>,
    version: u64,
    changed: watch::Sender<u64>,
    pending: HashMap<Uuid, Pending>,
    touched: Instant,
}

impl Default for Account {
    fn default() -> Self {
        Self {
            devices: HashMap::new(),
            playback: None,
            version: 0,
            changed: watch::channel(0).0,
            pending: HashMap::new(),
            touched: Instant::now(),
        }
    }
}

impl Account {
    fn notify(&mut self) {
        self.version += 1;
        self.touched = Instant::now();
        self.changed.send_replace(self.version);
    }

    fn disconnect(&mut self, device_id: &str, connection_id: Uuid) {
        if !self.devices.get(device_id).is_some_and(|device| device.device.connection_id == connection_id) {
            return;
        }
        self.devices.remove(device_id);
        for pending in self.pending.values() {
            if pending.connection_id == connection_id && pending.outcome.borrow().is_none() {
                pending.outcome.send_replace(Some(Err("Playback device disconnected.".into())));
            }
        }
        self.notify();
    }
}

pub struct Connection {
    pub id: Uuid,
    pub commands: mpsc::Receiver<Envelope>,
    pub changed: watch::Receiver<u64>,
}

#[derive(Clone)]
pub struct ConnectRegistry {
    accounts: Arc<Mutex<HashMap<Uuid, Account>>>,
    epoch: Uuid,
}

impl Default for ConnectRegistry {
    fn default() -> Self {
        Self { accounts: Arc::default(), epoch: Uuid::now_v7() }
    }
}

impl ConnectRegistry {
    fn lock(&self) -> AppResult<MutexGuard<'_, HashMap<Uuid, Account>>> {
        self.accounts.lock().map_err(|_| AppError::Internal(anyhow::anyhow!("Playback registry is unavailable")))
    }

    pub fn register(&self, user: Uuid, device_id: &str, name: &str) -> AppResult<Connection> {
        self.register_device(user, device_id, name, "web")
    }

    pub fn register_device(&self, user: Uuid, device_id: &str, name: &str, kind: &str) -> AppResult<Connection> {
        super::require_device(Some(device_id))?;
        if device_id.len() > 128 {
            return Err(AppError::validation("Invalid deviceId."));
        }
        let mut accounts = self.lock()?;
        accounts.retain(|_, account| !account.devices.is_empty() || account.touched.elapsed() < COMMAND_RETENTION);
        let account = accounts.entry(user).or_default();
        if account.devices.len() >= MAX_DEVICES && !account.devices.contains_key(device_id) {
            return Err(AppError::conflict("Too many connected playback devices."));
        }
        if let Some(previous) = account.devices.get(device_id) {
            account.disconnect(device_id, previous.device.connection_id);
        }
        let id = Uuid::now_v7();
        let (commands, receiver) = mpsc::channel(32);
        account.devices.insert(
            device_id.to_owned(),
            Connected {
                device: Device {
                    id: device_id.to_owned(),
                    name: super::device_name(Some(name)),
                    connection_id: id,
                    kind: if kind == "android" { "android" } else { "web" }.to_owned(),
                },
                commands,
                seen: Instant::now(),
            },
        );
        account.notify();
        Ok(Connection { id, commands: receiver, changed: account.changed.subscribe() })
    }

    pub fn unregister(&self, user: Uuid, device_id: &str, connection_id: Uuid) {
        if let Ok(mut accounts) = self.lock()
            && let Some(account) = accounts.get_mut(&user)
        {
            account.disconnect(device_id, connection_id);
        }
    }

    pub fn is_connected(&self, user: Uuid, device_id: &str, connection_id: Uuid) -> AppResult<bool> {
        Ok(self
            .lock()?
            .get(&user)
            .and_then(|account| account.devices.get(device_id))
            .is_some_and(|device| device.device.connection_id == connection_id && device.seen.elapsed() < DEVICE_LEASE))
    }

    pub fn heartbeat(&self, user: Uuid, device_id: &str, connection_id: Uuid) -> AppResult<()> {
        let mut accounts = self.lock()?;
        let device = accounts
            .get_mut(&user)
            .and_then(|account| account.devices.get_mut(device_id))
            .filter(|device| device.device.connection_id == connection_id && device.seen.elapsed() < DEVICE_LEASE)
            .ok_or_else(|| AppError::conflict("Playback device disconnected."))?;
        device.seen = Instant::now();
        Ok(())
    }

    pub fn snapshot(&self, user: Uuid) -> AppResult<Snapshot> {
        let mut accounts = self.lock()?;
        let Some(account) = accounts.get_mut(&user) else {
            return Ok(Snapshot { epoch: self.epoch, ..Snapshot::default() });
        };
        let expired: Vec<_> = account
            .devices
            .values()
            .filter(|device| device.seen.elapsed() >= DEVICE_LEASE)
            .map(|device| (device.device.id.clone(), device.device.connection_id))
            .collect();
        for (device, connection) in expired {
            account.disconnect(&device, connection);
        }
        let mut devices: Vec<_> = account.devices.values().map(|device| device.device.clone()).collect();
        devices.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        Ok(Snapshot { epoch: self.epoch, version: account.version, devices, playback: account.playback.clone() })
    }

    pub fn report(&self, user: Uuid, device_id: &str, connection_id: Uuid, state: Playback) -> AppResult<()> {
        state.validate()?;
        let mut accounts = self.lock()?;
        let account = accounts.get_mut(&user).ok_or_else(|| AppError::conflict("Playback device disconnected."))?;
        if !account.devices.get(device_id).is_some_and(|device| device.device.connection_id == connection_id) {
            return Err(AppError::conflict("Playback device disconnected."));
        }
        let previous = account.playback.as_ref();
        let changed = previous.is_none_or(|previous| {
            previous.device_id != device_id
                || previous.state.track_ids != state.track_ids
                || previous.state.order != state.order
        });
        let queue_revision = previous.map_or(1, |previous| previous.queue_revision + u64::from(changed));
        account.playback =
            Some(ActivePlayback { device_id: device_id.to_owned(), queue_revision, reported_at: Utc::now(), state });
        account.notify();
        Ok(())
    }

    pub fn send(&self, user: Uuid, request: CommandRequest) -> AppResult<watch::Receiver<Outcome>> {
        request.command.validate()?;
        let mut accounts = self.lock()?;
        let account = accounts.get_mut(&user).ok_or_else(|| AppError::not_found("Playback device is offline."))?;
        account.pending.retain(|_, pending| pending.created.elapsed() < COMMAND_RETENTION);
        if let Some(pending) = account.pending.get(&request.id) {
            if pending.request != request {
                return Err(AppError::conflict("Command ID was already used."));
            }
            if pending.created.elapsed() > COMMAND_TIMEOUT && pending.outcome.borrow().is_none() {
                pending.outcome.send_replace(Some(Err("Playback command expired.".into())));
            }
            return Ok(pending.outcome.subscribe());
        }
        if account.pending.len() >= MAX_COMMANDS {
            let oldest = account
                .pending
                .iter()
                .filter(|(_, pending)| pending.outcome.borrow().is_some())
                .min_by_key(|(_, pending)| pending.created)
                .map(|(id, _)| *id);
            if let Some(id) = oldest {
                account.pending.remove(&id);
            } else {
                return Err(AppError::conflict("Too many playback commands."));
            }
        }
        let device = account
            .devices
            .get(&request.device_id)
            .filter(|device| device.seen.elapsed() < DEVICE_LEASE)
            .ok_or_else(|| AppError::not_found("Playback device is offline."))?;
        if request.command.edits_queue()
            && !account.playback.as_ref().is_some_and(|active| {
                active.device_id == request.device_id && Some(active.queue_revision) == request.queue_revision
            })
        {
            return Err(AppError::conflict("The playback queue changed. Try again."));
        }
        let connection_id = device.device.connection_id;
        let envelope = Envelope {
            id: request.id,
            connection_id,
            expires_at: Utc::now() + chrono::Duration::seconds(10),
            queue_revision: request.queue_revision,
            command: request.command.clone(),
        };
        device.commands.try_send(envelope).map_err(|_| AppError::conflict("Playback device is not responding."))?;
        let (outcome, receipt) = watch::channel(None);
        account.pending.insert(request.id, Pending { request, connection_id, created: Instant::now(), outcome });
        Ok(receipt)
    }

    pub fn acknowledge(
        &self,
        user: Uuid,
        device_id: &str,
        connection_id: Uuid,
        id: Uuid,
        error: Option<String>,
    ) -> AppResult<()> {
        let mut accounts = self.lock()?;
        let pending = accounts
            .get_mut(&user)
            .and_then(|account| account.pending.get_mut(&id))
            .filter(|pending| pending.request.device_id == device_id && pending.connection_id == connection_id)
            .ok_or_else(|| AppError::not_found("Playback command is no longer available."))?;
        if pending.created.elapsed() > COMMAND_TIMEOUT {
            return Err(AppError::conflict("Playback command expired."));
        }
        if pending.outcome.borrow().is_none() {
            pending.outcome.send_replace(Some(error.map_or(Ok(()), |error| Err(error.chars().take(256).collect()))));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play() -> Command {
        Command::SetPlaying { playing: true }
    }

    fn request(target: &str) -> CommandRequest {
        CommandRequest { id: Uuid::now_v7(), device_id: target.into(), queue_revision: None, command: play() }
    }

    #[tokio::test]
    async fn discovery_does_not_steal_playback_and_is_scoped_to_the_account() {
        let hub = ConnectRegistry::default();
        let user = Uuid::now_v7();
        let _phone = hub.register(user, "phone", "Phone").unwrap();
        let _computer = hub.register(user, "computer", "Computer").unwrap();
        let snapshot = hub.snapshot(user).unwrap();
        assert_eq!(snapshot.devices.len(), 2);
        assert!(snapshot.playback.is_none());
        assert!(hub.snapshot(Uuid::now_v7()).unwrap().devices.is_empty());
    }

    #[tokio::test]
    async fn a_replaced_connection_cannot_remove_the_new_device_or_ack_its_commands() {
        let hub = ConnectRegistry::default();
        let user = Uuid::now_v7();
        let old = hub.register(user, "phone", "Phone").unwrap();
        let mut new = hub.register(user, "phone", "Phone").unwrap();
        hub.unregister(user, "phone", old.id);
        let command = request("phone");
        let _receipt = hub.send(user, command.clone()).unwrap();
        let received = new.commands.recv().await.unwrap();
        assert_eq!(received.id, command.id);
        assert!(hub.acknowledge(user, "phone", old.id, command.id, None).is_err());
        assert!(hub.acknowledge(user, "phone", new.id, command.id, None).is_ok());
    }

    #[tokio::test]
    async fn retrying_a_command_id_delivers_it_once_and_reuses_the_result() {
        let hub = ConnectRegistry::default();
        let user = Uuid::now_v7();
        let mut device = hub.register(user, "phone", "Phone").unwrap();
        let command = request("phone");
        let first = hub.send(user, command.clone()).unwrap();
        let retry = hub.send(user, command.clone()).unwrap();
        assert_eq!(device.commands.recv().await.unwrap().id, command.id);
        assert!(device.commands.try_recv().is_err());
        hub.acknowledge(user, "phone", device.id, command.id, None).unwrap();
        assert_eq!(*first.borrow(), Some(Ok(())));
        assert_eq!(*retry.borrow(), Some(Ok(())));
        let mut reused = command;
        reused.command = Command::Next;
        assert!(hub.send(user, reused).is_err());
    }

    #[tokio::test]
    async fn commands_cannot_reach_another_account_or_an_offline_device() {
        let hub = ConnectRegistry::default();
        let user = Uuid::now_v7();
        let device = hub.register(user, "phone", "Phone").unwrap();
        assert!(hub.send(Uuid::now_v7(), request("phone")).is_err());
        hub.unregister(user, "phone", device.id);
        assert!(hub.send(user, request("phone")).is_err());
    }

    #[tokio::test]
    async fn disconnect_fails_pending_commands_instead_of_replaying_them_on_reconnect() {
        let hub = ConnectRegistry::default();
        let user = Uuid::now_v7();
        let device = hub.register(user, "phone", "Phone").unwrap();
        let receipt = hub.send(user, request("phone")).unwrap();
        hub.unregister(user, "phone", device.id);
        assert!(receipt.borrow().as_ref().unwrap().is_err());
        let mut reconnected = hub.register(user, "phone", "Phone").unwrap();
        assert!(reconnected.commands.try_recv().is_err());
    }

    #[test]
    fn playback_validation_rejects_invalid_order_and_non_finite_positions() {
        let mut state =
            Playback { track_ids: vec![Uuid::now_v7(), Uuid::now_v7()], order: vec![0, 0], ..Default::default() };
        assert!(state.validate().is_err());
        state.order = vec![1, 0];
        assert!(state.validate().is_ok());
        state.position_seconds = f64::NAN;
        assert!(state.validate().is_err());
    }

    #[test]
    fn expired_presence_cannot_receive_commands_or_be_revived_with_an_old_heartbeat() {
        let hub = ConnectRegistry::default();
        let user = Uuid::now_v7();
        let connection = hub.register(user, "phone", "Phone").unwrap();
        hub.lock().unwrap().get_mut(&user).unwrap().devices.get_mut("phone").unwrap().seen =
            Instant::now() - DEVICE_LEASE;
        assert!(hub.send(user, request("phone")).is_err());
        assert!(hub.heartbeat(user, "phone", connection.id).is_err());
        assert!(hub.snapshot(user).unwrap().devices.is_empty());
    }

    #[test]
    fn progress_reports_do_not_invalidate_queue_edits_but_reordering_does() {
        let hub = ConnectRegistry::default();
        let user = Uuid::now_v7();
        let connection = hub.register(user, "phone", "Phone").unwrap();
        let mut playback =
            Playback { track_ids: vec![Uuid::now_v7(), Uuid::now_v7()], order: vec![0, 1], ..Default::default() };
        hub.report(user, "phone", connection.id, playback.clone()).unwrap();
        let revision = hub.snapshot(user).unwrap().playback.unwrap().queue_revision;
        playback.position_seconds = 42.0;
        hub.report(user, "phone", connection.id, playback.clone()).unwrap();
        assert_eq!(hub.snapshot(user).unwrap().playback.unwrap().queue_revision, revision);
        playback.order.reverse();
        hub.report(user, "phone", connection.id, playback).unwrap();
        assert!(hub.snapshot(user).unwrap().playback.unwrap().queue_revision > revision);
    }
}
