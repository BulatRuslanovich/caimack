// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;

use uuid::Uuid;

use crate::{Snapshot, vector};

const WINDOW_SECONDS: i64 = 45 * 60;
const IDLE_SECONDS: i64 = 20 * 60;
const HALF_LIFE_SECONDS: f32 = 10.0 * 60.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Started,
    Progress,
    Completed,
    Skipped,
    Replayed,
    Liked,
    Unliked,
    Queued,
}

#[derive(Debug, Clone, Copy)]
pub struct Event {
    pub track: Uuid,
    pub action: Action,
    pub at: i64,
    pub listened: i32,
    pub duration: i32,
    pub chosen: bool,
}

#[derive(Debug, Default)]
pub struct Session {
    pub heard: Vec<Uuid>,
    pub current: Option<Uuid>,
    pub last_good: Option<Uuid>,
    pub skip_streak: usize,
    pub successes: usize,
    centre: Option<Vec<f32>>,
    negative: Vec<(usize, f32)>,
    confidence: f32,
}

impl Session {
    /// Events are chronological. Heartbeats describe one listen, so they must
    /// never accumulate into a stronger preference than an explicit like.
    pub fn build(snapshot: &Snapshot, events: &[Event], now: i64) -> Self {
        let mut session = Self::default();
        let floor = now - WINDOW_SECONDS;
        let mut evidence: HashMap<usize, (f32, f32)> = HashMap::new();
        let mut previous = None;
        let mut successful = std::collections::HashSet::new();
        for event in events.iter().filter(|event| event.at >= floor && event.at <= now) {
            if previous.is_some_and(|at| event.at - at > IDLE_SECONDS) {
                session = Self::default();
                evidence.clear();
                successful.clear();
            }
            previous = Some(event.at);
            let Some(row) = snapshot.row_of(event.track) else { continue };
            if event.action == Action::Started {
                session.current = Some(event.track);
                session.heard.retain(|id| *id != event.track);
                session.heard.push(event.track);
            }
            let rating = rating(event);
            if rating > 0.0 && event.action != Action::Started {
                session.last_good = Some(event.track);
                successful.insert(event.track);
            }
            match event.action {
                Action::Skipped if rating < 0.0 => session.skip_streak += 1,
                Action::Completed | Action::Liked | Action::Replayed => session.skip_streak = 0,
                Action::Progress if rating > 0.0 => session.skip_streak = 0,
                _ => {}
            }
            #[expect(clippy::cast_precision_loss, reason = "bounded age in seconds")]
            let decay = 0.5_f32.powf((now - event.at) as f32 / HALF_LIFE_SECONDS);
            let entry = evidence.entry(row).or_default();
            if event.action == Action::Unliked {
                entry.0 = 0.0;
                successful.remove(&event.track);
                if session.last_good == Some(event.track) {
                    session.last_good = None;
                }
            }
            if rating > 0.0 {
                entry.0 = entry.0.max(rating * decay);
                // A new deliberate choice can rehabilitate an earlier skip.
                if matches!(event.action, Action::Liked | Action::Replayed) {
                    entry.1 = 0.0;
                }
            } else {
                entry.1 = entry.1.max(-rating * decay);
            }
        }
        // A paused session should not dictate the next listening session.
        if previous.is_none_or(|at| now - at > IDLE_SECONDS) {
            return Self::default();
        }
        let mut centre = vec![0.0; snapshot.dimension()];
        let mut strength = 0.0_f32;
        // Stable accumulation keeps identical requests reproducible.
        let mut evidence: Vec<_> = evidence.into_iter().collect();
        evidence.sort_by_key(|(row, _)| *row);
        for (row, (positive, negative)) in evidence {
            let weight = (positive - negative).max(0.0);
            vector::add_scaled(&mut centre, snapshot.vector(row), weight);
            strength += weight;
            session.successes += usize::from(weight >= 0.2 && successful.contains(&snapshot.meta(row).track_id));
            if negative > positive {
                session.negative.push((row, negative - positive));
            }
        }
        if strength > 0.0 {
            vector::normalize(&mut centre);
            session.centre = Some(centre);
        }
        session.confidence = (strength / 2.0).min(1.0);
        // Bound scoring work even during a long burst of skips.
        session.negative.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        session.negative.truncate(6);
        session
    }

    pub fn affinity(&self, snapshot: &Snapshot, row: usize) -> f32 {
        let positive = self
            .centre
            .as_ref()
            .map_or(0.0, |centre| vector::dot(centre, snapshot.vector(row)).max(0.0) * self.confidence);
        let negative = self
            .negative
            .iter()
            .map(|&(other, weight)| ((snapshot.between(row, other) - 0.25) / 0.75).clamp(0.0, 1.0) * weight)
            .fold(0.0_f32, f32::max);
        (positive - negative).clamp(-1.0, 1.0)
    }

    pub fn exploration(&self, cold: bool) -> f64 {
        if self.skip_streak >= 3 {
            0.0
        } else if self.skip_streak >= 2 {
            0.1
        } else if self.successes >= 3 {
            0.4
        } else if cold {
            0.3
        } else {
            0.2
        }
    }
}

fn rating(event: &Event) -> f32 {
    #[expect(clippy::cast_precision_loss, reason = "bounded track durations")]
    let fraction =
        if event.duration > 0 { (event.listened as f32 / event.duration as f32).clamp(0.0, 1.0) } else { 0.0 };
    match event.action {
        Action::Started if event.chosen => 0.35,
        Action::Completed if event.listened < 3 => 0.0,
        Action::Completed if fraction >= 0.8 => 0.8,
        Action::Completed if fraction >= 0.5 => 0.5,
        Action::Completed if event.listened >= 60 => 0.3,
        Action::Completed => 0.1,
        Action::Skipped if event.listened < 3 => -0.15,
        Action::Skipped if event.listened < 30 || fraction < 0.2 => -0.7,
        Action::Skipped if fraction >= 0.5 => 0.2,
        Action::Replayed => 1.2,
        Action::Liked => 1.5,
        Action::Unliked => -0.3,
        Action::Queued => 0.6,
        Action::Progress if event.listened >= 60 || fraction >= 0.5 => 0.4,
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::tests::snapshot;

    fn event(track: u128, action: Action, at: i64) -> Event {
        Event { track: Uuid::from_u128(track), action, at, listened: 10, duration: 200, chosen: false }
    }

    #[test]
    fn skips_change_the_direction_without_changing_long_term_taste() {
        let library = snapshot(&[(1, 1, "a", [1.0, 0.0, 0.0]), (2, 2, "b", [0.0, 1.0, 0.0])]);
        let session = Session::build(&library, &[event(1, Action::Skipped, 990), event(2, Action::Liked, 999)], 1000);
        assert!(session.affinity(&library, 1) > session.affinity(&library, 0));
    }

    #[test]
    fn a_long_pause_discards_the_previous_mood() {
        let library = snapshot(&[(1, 1, "a", [1.0, 0.0, 0.0]), (2, 2, "b", [0.0, 1.0, 0.0])]);
        let session = Session::build(&library, &[event(1, Action::Liked, 100), event(2, Action::Liked, 1400)], 1401);
        assert!(session.affinity(&library, 1) > session.affinity(&library, 0));
        assert_eq!(Session::build(&library, &[event(1, Action::Liked, 100)], 1401).successes, 0);
    }

    #[test]
    fn heartbeats_do_not_multiply_preferences() {
        let library = snapshot(&[(1, 1, "a", [1.0, 0.0, 0.0])]);
        let mut progress = event(1, Action::Progress, 999);
        progress.listened = 90;
        let once = Session::build(&library, &[progress], 1000);
        let repeated = Session::build(&library, &[progress; 20], 1000);
        assert_eq!(once.affinity(&library, 0), repeated.affinity(&library, 0));
        assert_eq!(repeated.successes, 1);
    }

    #[test]
    fn repeated_skips_reduce_experiments() {
        let library = snapshot(&[(1, 1, "a", [1.0, 0.0, 0.0])]);
        let session = Session::build(&library, &[event(1, Action::Skipped, 998), event(1, Action::Skipped, 999)], 1000);
        assert!(session.exploration(false) < Session::default().exploration(false));
    }
}
