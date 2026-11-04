// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use serde::Serialize;

const DEFAULT_PAGE_SIZE: i32 = 50;
const MAX_PAGE_SIZE: i32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageRequest {
    pub page: i32,
    pub page_size: i32,
}

impl PageRequest {
    pub fn new(page: Option<i32>, page_size: Option<i32>) -> Self {
        Self {
            page: page.filter(|&p| p >= 1).unwrap_or(1),
            page_size: page_size.filter(|&s| s >= 1).map_or(DEFAULT_PAGE_SIZE, |s| s.min(MAX_PAGE_SIZE)),
        }
    }

    pub fn offset(self) -> i64 {
        i64::from(self.page - 1) * i64::from(self.page_size)
    }

    pub fn limit(self) -> i64 {
        i64::from(self.page_size)
    }
}

impl Default for PageRequest {
    fn default() -> Self {
        Self::new(None, None)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i64,
}

impl<T> Paged<T> {
    pub fn new(items: Vec<T>, total: i64, page: PageRequest) -> Self {
        let size = i64::from(page.page_size);
        Self { items, total, page: page.page, page_size: page.page_size, total_pages: (total + size - 1) / size }
    }

    pub fn empty(page: PageRequest) -> Self {
        Self::new(Vec::new(), 0, page)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn out_of_range_requests_are_clamped() {
        assert_eq!(PageRequest::new(Some(0), Some(5000)), PageRequest { page: 1, page_size: 200 });
    }

    #[test]
    fn total_pages_round_up() {
        assert_eq!(Paged::<()>::new(Vec::new(), 5, PageRequest::new(Some(1), Some(2))).total_pages, 3);
    }
}
