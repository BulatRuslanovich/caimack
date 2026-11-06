// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

//! Implicit grades from actual listening time, never the seek position.

pub const NEAR_COMPLETE: f64 = 0.8;
pub const PARTIAL: f64 = 0.5;
pub const EARLY: f64 = 0.2;
pub const EARLY_SECONDS: i32 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum End {
    Completed,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grade {
    EarlySkip,
    Partial,
    NearComplete,
}

pub fn grade(end: End, listened: i32, duration: i32) -> Option<Grade> {
    if duration <= 0 || listened < 0 {
        return None;
    }
    let fraction = f64::from(listened) / f64::from(duration);
    if fraction >= NEAR_COMPLETE {
        Some(Grade::NearComplete)
    } else if fraction >= PARTIAL {
        Some(Grade::Partial)
    } else if end == End::Skipped && listened < EARLY_SECONDS && fraction < EARLY {
        Some(Grade::EarlySkip)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grades_fraction_boundaries_for_both_terminal_actions() {
        for end in [End::Completed, End::Skipped] {
            assert_eq!(grade(end, 160, 200), Some(Grade::NearComplete));
            assert_eq!(grade(end, 159, 200), Some(Grade::Partial));
            assert_eq!(grade(end, 100, 200), Some(Grade::Partial));
            assert_eq!(grade(end, 99, 200), None);
        }
    }

    #[test]
    fn immediate_skips_are_negative_but_long_or_ambiguous_listens_are_not() {
        assert_eq!(grade(End::Skipped, 0, 200), Some(Grade::EarlySkip));
        assert_eq!(grade(End::Skipped, 10, 200), Some(Grade::EarlySkip));
        assert_eq!(grade(End::Skipped, 30, 1000), None);
        assert_eq!(grade(End::Skipped, 10, 20), Some(Grade::Partial));
        assert_eq!(grade(End::Skipped, 20, 100), None);
    }

    #[test]
    fn seeking_to_the_end_missing_duration_and_invalid_times_do_not_create_grades() {
        assert_eq!(grade(End::Completed, 1, 200), None);
        assert_eq!(grade(End::Completed, 0, 200), None);
        assert_eq!(grade(End::Skipped, 10, 0), None);
        assert_eq!(grade(End::Skipped, -1, 200), None);
    }
}
