// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

fn main() {
    println!("cargo:rerun-if-changed=../../../db/migrations");
}
