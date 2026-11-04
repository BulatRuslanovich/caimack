// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashSet;

use uuid::Uuid;

use crate::snapshot::TrackMeta;

pub const DOWNRANK: f64 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Allowed,
    Downranked,
    Blocked,
}

#[derive(Debug, Clone, Default)]
pub struct Rules {
    blocked: HashSet<Uuid>,
    downranked: HashSet<Uuid>,
}

impl Rules {
    pub fn new(blocked: impl IntoIterator<Item = Uuid>, downranked: impl IntoIterator<Item = Uuid>) -> Self {
        Self { blocked: blocked.into_iter().collect(), downranked: downranked.into_iter().collect() }
    }

    pub fn is_empty(&self) -> bool {
        self.blocked.is_empty() && self.downranked.is_empty()
    }

    pub fn verdict(&self, meta: &TrackMeta) -> Verdict {
        if self.is_empty() {
            return Verdict::Allowed;
        }
        let targets = || {
            std::iter::once(meta.track_id).chain(meta.artists.iter().copied()).chain(meta.album_id).chain(meta.genre_id)
        };
        if targets().any(|target| self.blocked.contains(&target)) {
            Verdict::Blocked
        } else if targets().any(|target| self.downranked.contains(&target)) {
            Verdict::Downranked
        } else {
            Verdict::Allowed
        }
    }

    pub fn weight(&self, meta: &TrackMeta) -> Option<f64> {
        match self.verdict(meta) {
            Verdict::Allowed => Some(1.0),
            Verdict::Downranked => Some(DOWNRANK),
            Verdict::Blocked => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::tests::meta;

    #[test]
    fn a_rule_on_any_credit_applies_to_the_track() {
        let mut track = meta(1, 10, "song");
        track.artists.push(Uuid::from_u128(11));
        track.album_id = Some(Uuid::from_u128(20));
        track.genre_id = Some(Uuid::from_u128(30));

        assert_eq!(Rules::default().verdict(&track), Verdict::Allowed);
        assert_eq!(Rules::new([Uuid::from_u128(11)], []).verdict(&track), Verdict::Blocked);
        assert_eq!(Rules::new([], [Uuid::from_u128(30)]).verdict(&track), Verdict::Downranked);
        assert_eq!(Rules::new([Uuid::from_u128(1)], [Uuid::from_u128(20)]).verdict(&track), Verdict::Blocked);
        assert_eq!(Rules::new([Uuid::from_u128(99)], []).weight(&track), Some(1.0));
    }
}
