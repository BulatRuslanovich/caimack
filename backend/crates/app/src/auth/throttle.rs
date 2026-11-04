// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use uuid::Uuid;

use crate::{AppError, AppResult};

const WINDOW: Duration = Duration::from_secs(60);

const PER_ACCOUNT: u32 = 5;
const PER_ADDRESS: u32 = 20;
const PER_PASSWORD_CHANGE: u32 = 5;

const MAX_TRACKED: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Key {
    Account(String),
    Address(IpAddr),
    PasswordChange(Uuid),
}

impl Key {
    fn limit(&self) -> u32 {
        match self {
            Self::Account(_) => PER_ACCOUNT,
            Self::Address(_) => PER_ADDRESS,
            Self::PasswordChange(_) => PER_PASSWORD_CHANGE,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Window {
    started: Instant,
    failures: u32,
}

impl Window {
    fn expired(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.started) >= WINDOW
    }
}

#[derive(Debug, Default)]
pub struct Throttle {
    windows: Mutex<HashMap<Key, Window>>,
}

impl Throttle {
    pub fn check_login(&self, username: &str, address: Option<IpAddr>) -> AppResult<()> {
        self.check(&login_keys(username, address), Instant::now())
    }

    pub fn login_failed(&self, username: &str, address: Option<IpAddr>) {
        self.fail(login_keys(username, address), Instant::now());
    }

    pub fn login_succeeded(&self, username: &str) {
        self.clear(&Key::Account(username.to_owned()));
    }

    pub fn check_registration(&self, address: Option<IpAddr>) -> AppResult<()> {
        self.check(&address.map(Key::Address).into_iter().collect::<Vec<_>>(), Instant::now())
    }

    pub fn registration_failed(&self, address: Option<IpAddr>) {
        self.fail(address.map(Key::Address), Instant::now());
    }

    pub fn check_password_change(&self, user: Uuid) -> AppResult<()> {
        self.check(&[Key::PasswordChange(user)], Instant::now())
    }

    pub fn password_change_failed(&self, user: Uuid) {
        self.fail([Key::PasswordChange(user)], Instant::now());
    }

    pub fn password_changed(&self, user: Uuid) {
        self.clear(&Key::PasswordChange(user));
    }

    fn check(&self, keys: &[Key], now: Instant) -> AppResult<()> {
        let Ok(windows) = self.windows.lock() else { return Ok(()) };
        let wait = keys
            .iter()
            .filter_map(|key| windows.get(key).map(|window| (key, window)))
            .filter(|(key, window)| !window.expired(now) && window.failures >= key.limit())
            .map(|(_, window)| WINDOW.saturating_sub(now.saturating_duration_since(window.started)))
            .max();
        match wait {
            Some(wait) => {
                let seconds = wait.as_secs().max(1);
                Err(AppError::too_many_requests("Too many attempts. Try again in {0} s.", Duration::from_secs(seconds))
                    .arg(seconds))
            }
            None => Ok(()),
        }
    }

    fn fail(&self, keys: impl IntoIterator<Item = Key>, now: Instant) {
        let Ok(mut windows) = self.windows.lock() else { return };
        if windows.len() >= MAX_TRACKED {
            windows.retain(|_, window| !window.expired(now));
        }
        for key in keys {
            let window = windows.entry(key).or_insert(Window { started: now, failures: 0 });
            if window.expired(now) {
                *window = Window { started: now, failures: 0 };
            }
            window.failures = window.failures.saturating_add(1);
        }
    }

    fn clear(&self, key: &Key) {
        if let Ok(mut windows) = self.windows.lock() {
            windows.remove(key);
        }
    }
}

fn login_keys(username: &str, address: Option<IpAddr>) -> Vec<Key> {
    let mut keys = vec![Key::Account(username.to_owned())];
    keys.extend(address.map(Key::Address));
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    fn address(last: u8) -> Option<IpAddr> {
        Some(IpAddr::from([203, 0, 113, last]))
    }

    fn fail_login(throttle: &Throttle, username: &str, from: Option<IpAddr>, times: u32, now: Instant) {
        for _ in 0..times {
            throttle.fail(login_keys(username, from), now);
        }
    }

    #[test]
    fn account_is_blocked_after_five_failures() {
        let throttle = Throttle::default();
        let now = Instant::now();
        fail_login(&throttle, "anna", address(1), PER_ACCOUNT - 1, now);
        assert!(throttle.check(&login_keys("anna", address(1)), now).is_ok());

        fail_login(&throttle, "anna", address(1), 1, now);
        let blocked = throttle.check(&login_keys("anna", address(2)), now);
        assert!(matches!(blocked, Err(AppError::TooManyRequests { .. })));
    }

    #[test]
    fn block_lifts_when_the_window_passes() {
        let throttle = Throttle::default();
        let now = Instant::now();
        fail_login(&throttle, "anna", address(1), PER_ACCOUNT, now);

        assert!(throttle.check(&login_keys("anna", address(1)), now + WINDOW).is_ok());
    }

    #[test]
    fn retry_after_counts_down_from_the_first_failure() {
        let throttle = Throttle::default();
        let now = Instant::now();
        fail_login(&throttle, "anna", None, PER_ACCOUNT, now);

        let error = throttle.check(&login_keys("anna", None), now + Duration::from_secs(45)).err();
        assert_eq!(error.and_then(|e| e.retry_after()), Some(Duration::from_secs(15)));
    }

    #[test]
    fn address_is_blocked_across_accounts() {
        let throttle = Throttle::default();
        let now = Instant::now();
        for user in 0..PER_ADDRESS {
            fail_login(&throttle, &format!("user{user}"), address(1), 1, now);
        }

        assert!(throttle.check(&login_keys("someone", address(1)), now).is_err());
        assert!(throttle.check(&login_keys("someone", address(2)), now).is_ok());
    }

    #[test]
    fn success_clears_the_account_but_not_the_address() {
        let throttle = Throttle::default();
        let now = Instant::now();
        fail_login(&throttle, "anna", address(1), PER_ACCOUNT, now);
        throttle.login_succeeded("anna");
        assert!(throttle.check(&login_keys("anna", None), now).is_ok());

        fail_login(&throttle, "anna", address(1), PER_ADDRESS - PER_ACCOUNT, now);
        assert!(throttle.check(&login_keys("boris", address(1)), now).is_err());
    }

    #[test]
    fn password_change_is_limited_per_user() {
        let throttle = Throttle::default();
        let (anna, boris) = (Uuid::now_v7(), Uuid::now_v7());
        for _ in 0..PER_PASSWORD_CHANGE {
            throttle.password_change_failed(anna);
        }

        assert!(throttle.check_password_change(anna).is_err());
        assert!(throttle.check_password_change(boris).is_ok());
        throttle.password_changed(anna);
        assert!(throttle.check_password_change(anna).is_ok());
    }
}
