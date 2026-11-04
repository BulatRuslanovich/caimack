// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Timelike, Utc};
use serde::Serializer;

pub fn format_time(at: &DateTime<Utc>) -> String {
    let mut text = at.format("%Y-%m-%dT%H:%M:%S").to_string();
    let ticks = at.nanosecond() % 1_000_000_000 / 100;
    if ticks > 0 {
        let fraction = format!("{ticks:07}");
        text.push('.');
        text.push_str(fraction.trim_end_matches('0'));
    }
    text.push_str("+00:00");
    text
}

pub fn time<S: Serializer>(at: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&format_time(at))
}

pub fn optional_time<S: Serializer>(at: &Option<DateTime<Utc>>, serializer: S) -> Result<S::Ok, S::Error> {
    match at {
        Some(at) => time(at, serializer),
        None => serializer.serialize_none(),
    }
}

pub fn number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    const EXACT_INTEGERS: f64 = 9_007_199_254_740_992.0;
    if value.fract() == 0.0 && value.abs() < EXACT_INTEGERS {
        #[expect(clippy::cast_possible_truncation, reason = "the value is a whole number below 2^53")]
        serializer.serialize_i64(*value as i64)
    } else {
        serializer.serialize_f64(*value)
    }
}

pub fn optional_number<S: Serializer>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => number(value, serializer),
        None => serializer.serialize_none(),
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use serde::Serialize;

    use super::*;

    #[test]
    fn time_trims_trailing_zeros_of_the_fraction() {
        let at = Utc.with_ymd_and_hms(2026, 10, 26, 21, 42, 48).unwrap() + chrono::Duration::microseconds(334_460);
        assert_eq!(format_time(&at), "2026-10-26T21:42:48.33446+00:00");
    }

    #[test]
    fn time_without_fraction_has_no_dot() {
        let at = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
        assert_eq!(format_time(&at), "2026-01-02T03:04:05+00:00");
    }

    #[derive(Serialize)]
    struct Value(#[serde(serialize_with = "number")] f64);

    #[test]
    fn whole_double_is_written_without_fraction() {
        assert_eq!(serde_json::to_string(&Value(30.0)).unwrap(), "30");
    }

    #[test]
    fn fractional_double_keeps_shortest_form() {
        assert_eq!(serde_json::to_string(&Value(29.931)).unwrap(), "29.931");
    }
}
