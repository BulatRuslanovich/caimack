// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use uuid::Uuid;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0100_0000_01b3;

pub fn hash(start: u64, bytes: &[u8]) -> u64 {
    bytes.iter().fold(start, |hash, &byte| (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME))
}

pub fn seed(user: Uuid, key: &str, day: i64) -> u64 {
    let seed = hash(FNV_OFFSET, user.as_bytes());
    let seed = hash(seed, key.as_bytes());
    hash(seed, &day.to_be_bytes())
}

pub fn mix(mut value: u64) -> u64 {
    value ^= value >> 33;
    value = value.wrapping_mul(0xff51_afd7_ed55_8ccd);
    value ^= value >> 33;
    value = value.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    value ^ (value >> 33)
}

pub fn unit(seed: u64, track: Uuid) -> f64 {
    #[expect(clippy::cast_precision_loss, reason = "a uniform number does not need every bit")]
    let value = (mix(hash(seed, track.as_bytes())) as f64 + 1.0) / (u64::MAX as f64 + 1.0);
    value.clamp(f64::MIN_POSITIVE, 1.0)
}

#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        mix(self.0)
    }

    pub fn next_f64(&mut self) -> f64 {
        #[expect(clippy::cast_precision_loss, reason = "53 bits are exact in f64")]
        let value = (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64;
        value
    }

    pub fn below(&mut self, bound: usize) -> usize {
        if bound == 0 {
            return 0;
        }
        #[expect(clippy::cast_possible_truncation, reason = "the result is below bound, which is a usize")]
        let index = (self.next_u64() % bound as u64) as usize;
        index
    }
}

pub fn weighted_sample(pool: &[(Uuid, f64)], count: usize, seed: u64) -> Vec<Uuid> {
    const MINIMUM_WEIGHT: f64 = 0.02;
    let mut keyed: Vec<(f64, Uuid)> =
        pool.iter().map(|&(id, weight)| (unit(seed, id).ln() / (weight.max(0.0) + MINIMUM_WEIGHT), id)).collect();
    keyed.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    keyed.into_iter().take(count).map(|(_, id)| id).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_seed_gives_the_same_sample() {
        let pool: Vec<(Uuid, f64)> =
            (0..50).map(|i| (Uuid::from_u128(i), f64::from(u32::try_from(i).unwrap_or(0)))).collect();
        let user = Uuid::from_u128(7);
        let today = weighted_sample(&pool, 10, seed(user, "dailyMix", 100));
        assert_eq!(today, weighted_sample(&pool, 10, seed(user, "dailyMix", 100)));
        assert_ne!(today, weighted_sample(&pool, 10, seed(user, "dailyMix", 101)));
    }

    #[test]
    fn heavier_items_are_picked_more_often() {
        let pool = [(Uuid::from_u128(1), 10.0), (Uuid::from_u128(2), 0.1)];
        let heavy_first =
            (0..200).filter(|&day| weighted_sample(&pool, 1, seed(Uuid::nil(), "k", day))[0] == pool[0].0).count();
        assert!(heavy_first > 180, "{heavy_first}");
    }

    #[test]
    fn rng_stays_in_range() {
        let mut rng = Rng::new(5);
        assert!((0..1000).all(|_| rng.below(7) < 7 && (0.0..1.0).contains(&rng.next_f64())));
    }
}
