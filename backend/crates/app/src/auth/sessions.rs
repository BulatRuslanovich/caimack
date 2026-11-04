// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::time::Duration;

use moka::sync::Cache;
use uuid::Uuid;

const LIFETIME: Duration = Duration::from_secs(30);
const CAPACITY: u64 = 10_000;

#[derive(Clone)]
pub struct LiveSessions {
    alive: Cache<Uuid, Uuid>,
}

impl Default for LiveSessions {
    fn default() -> Self {
        Self {
            alive: Cache::builder()
                .max_capacity(CAPACITY)
                .time_to_live(LIFETIME)
                .support_invalidation_closures()
                .build(),
        }
    }
}

impl LiveSessions {
    pub fn is_known_alive(&self, session_id: Uuid) -> bool {
        self.alive.contains_key(&session_id)
    }

    pub fn remember_alive(&self, session_id: Uuid, user_id: Uuid) {
        self.alive.insert(session_id, user_id);
    }

    pub fn forget(&self, session_id: Uuid) {
        self.alive.invalidate(&session_id);
    }

    pub fn forget_user(&self, user_id: Uuid) {
        if let Err(error) = self.alive.invalidate_entries_if(move |_, owner| *owner == user_id) {
            tracing::error!("Could not drop the cached sessions of user {user_id}: {error}");
            self.alive.invalidate_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembered_session_is_alive() {
        let sessions = LiveSessions::default();
        let session = Uuid::now_v7();

        sessions.remember_alive(session, Uuid::now_v7());

        assert!(sessions.is_known_alive(session));
    }

    #[test]
    fn forgetting_user_drops_only_their_sessions() {
        let sessions = LiveSessions::default();
        let (alice, bob) = (Uuid::now_v7(), Uuid::now_v7());
        let (alice_session, bob_session) = (Uuid::now_v7(), Uuid::now_v7());
        sessions.remember_alive(alice_session, alice);
        sessions.remember_alive(bob_session, bob);

        sessions.forget_user(alice);
        sessions.alive.run_pending_tasks();

        assert_eq!((sessions.is_known_alive(alice_session), sessions.is_known_alive(bob_session)), (false, true));
    }
}
