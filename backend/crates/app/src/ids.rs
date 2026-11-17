// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::HashSet;

use uuid::Uuid;

pub(crate) fn distinct(ids: impl IntoIterator<Item = Uuid>) -> Vec<Uuid> {
    let mut seen = HashSet::new();
    ids.into_iter().filter(|id| seen.insert(*id)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicates_keep_the_first_occurrence_and_input_order() {
        let ids = [Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7()];
        assert_eq!(distinct([ids[1], ids[0], ids[1], ids[2], ids[0]]), [ids[1], ids[0], ids[2]]);
    }
}
