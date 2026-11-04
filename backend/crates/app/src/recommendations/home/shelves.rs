// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;
use std::sync::Arc;

use reco::Listener;
use reco::shelves::{self, Reason, Shelf, ShelfItems};
use reco::taste;
use uuid::Uuid;

use super::{HomeBlockDto, Layout, Zone};
use crate::AppResult;
use crate::catalog::dto::{ArtistDto, TrackDto};
use crate::catalog::{artists, tracks};
use crate::recommendations::{ReasonDto, Recommendations, reasons};

pub(super) struct Hydrated {
    pub(super) shelf: Shelf,
    reason: ReasonDto,
    tracks: Vec<TrackDto>,
    artists: Vec<ArtistDto>,
}

impl Hydrated {
    pub(super) fn count(&self) -> usize {
        self.tracks.len().max(self.artists.len())
    }

    pub(super) fn block(self) -> HomeBlockDto {
        let circles = self.shelf.base_key() == "artistsForYou";
        HomeBlockDto {
            key: self.shelf.key.clone(),
            reason: Some(self.reason),
            tracks: (!circles).then_some(self.tracks),
            artists: circles.then_some(self.artists),
            ..HomeBlockDto::new(
                self.shelf.base_key(),
                if circles { Layout::Circles } else { Layout::Shelf },
                Zone::Browse,
            )
        }
    }
}

impl Recommendations {
    pub(super) async fn personal_shelves(
        &self,
        user: Uuid,
        listener: &Arc<Listener>,
        size: usize,
    ) -> AppResult<Vec<Hydrated>> {
        let library = self.index.library();
        let snapshot = &library.snapshot;
        let computing_library = Arc::clone(&library);
        let listener = Arc::clone(listener);
        let shelves = self
            .compute
            .run(move || {
                let snapshot = &computing_library.snapshot;
                let taste = taste::taste(snapshot, &listener);
                shelves::home(snapshot, &listener, &taste)
            })
            .await?;

        let mut track_ids = Vec::new();
        let mut artist_ids = Vec::new();
        for shelf in &shelves {
            match &shelf.items {
                ShelfItems::Tracks(picks) => {
                    track_ids.extend(picks.iter().take(size).map(|pick| snapshot.meta(pick.row).track_id));
                }
                ShelfItems::Artists(ids) => artist_ids.extend(ids.iter().take(size)),
            }
            if let Reason::BecauseYouListened(artist) = shelf.reason {
                artist_ids.push(artist);
            }
        }
        let artist_query = artists::fetch_where(
            &self.db,
            |query| {
                query.push(" WHERE a.id = ANY(").push_bind(artist_ids.clone()).push(")");
            },
            "a.name",
            i64::try_from(artist_ids.len()).unwrap_or(i64::MAX).max(1),
        );
        let (found_tracks, found_artists) = tokio::try_join!(tracks::by_ids(&self.db, user, &track_ids), artist_query)?;
        let found_artists: HashMap<Uuid, ArtistDto> =
            found_artists.into_iter().map(|artist| (artist.id, artist)).collect();

        Ok(shelves
            .into_iter()
            .map(|shelf| {
                let reason = match shelf.reason {
                    Reason::MatchesYourTaste => ReasonDto::new(reasons::MATCHES_YOUR_TASTE),
                    Reason::FreshInLibrary => ReasonDto::new(reasons::FRESH_IN_LIBRARY),
                    Reason::Discovery => ReasonDto::new(reasons::DISCOVERY),
                    Reason::BecauseYouListened(artist) => ReasonDto {
                        kind: reasons::BECAUSE_YOU_LISTENED,
                        subject: found_artists.get(&artist).map(|a| a.name.clone()),
                        subject_id: Some(artist),
                    },
                };
                let (tracks, artists) = match &shelf.items {
                    ShelfItems::Tracks(picks) => (
                        picks
                            .iter()
                            .take(size)
                            .filter_map(|pick| found_tracks.get(&snapshot.meta(pick.row).track_id).cloned())
                            .collect(),
                        vec![],
                    ),
                    ShelfItems::Artists(ids) => {
                        (vec![], ids.iter().take(size).filter_map(|id| found_artists.get(id).cloned()).collect())
                    }
                };
                Hydrated { shelf, reason, tracks, artists }
            })
            .collect())
    }
}
