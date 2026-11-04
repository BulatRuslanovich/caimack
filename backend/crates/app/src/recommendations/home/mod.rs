// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

mod mix;
mod shelves;

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_with::skip_serializing_none;
use uuid::Uuid;

use self::shelves::Hydrated;
use super::{ReasonDto, Recommendations};
use crate::AppResult;
use crate::catalog::dto::{AlbumDto, ArtistDto, TrackDto};
use crate::catalog::overview::{self, LibraryStats, StatsCache};
use crate::catalog::{albums, tracks};
use crate::library::history;
use crate::library::playlists::{self, PlaylistDto};
use crate::paging::PageRequest;
use crate::storage::Storage;

pub use self::mix::{HomeMixDto, MixKind};

const MINIMUM_BLOCK: usize = 4;
const MINIMUM_HERO: usize = 5;
const HERO_TRACKS: usize = 20;
const MOSAIC: usize = 4;
const QUICK_PLACES: usize = 5;
const QUICK_PLAYLISTS: usize = 2;
const MAX_TRACK_SHELVES: usize = 2;
const SHELF_PRIORITY: [&str; 3] = ["forYou", "becauseYouListened", "discover"];

#[derive(Debug, Clone, Copy, Serialize)]
pub enum Layout {
    Shelf,
    Hero,
    Tile,
    QuickTiles,
    Grid,
    Chart,
    Circles,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub enum Zone {
    Lead,
    Quick,
    Browse,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeBlockDto {
    pub key: String,
    pub base_key: String,
    pub layout: Layout,
    pub zone: Zone,
    pub reason: Option<ReasonDto>,
    pub tracks: Option<Vec<TrackDto>>,
    pub albums: Option<Vec<AlbumDto>>,
    pub artists: Option<Vec<ArtistDto>>,
    pub playlists: Option<Vec<PlaylistDto>>,
    pub total_count: Option<i64>,
}

impl HomeBlockDto {
    fn new(key: &str, layout: Layout, zone: Zone) -> Self {
        Self {
            key: key.to_owned(),
            base_key: key.to_owned(),
            layout,
            zone,
            reason: None,
            tracks: None,
            albums: None,
            artists: None,
            playlists: None,
            total_count: None,
        }
    }

    fn tracks(key: &str, layout: Layout, tracks: Vec<TrackDto>) -> Option<Self> {
        (tracks.len() >= MINIMUM_BLOCK).then(|| Self { tracks: Some(tracks), ..Self::new(key, layout, Zone::Browse) })
    }
}

#[derive(Debug, Serialize)]
pub struct HomeFeedDto {
    pub blocks: Vec<HomeBlockDto>,
    pub stats: LibraryStats,
}

impl Recommendations {
    pub async fn feed(
        &self,
        storage: &Storage,
        stats: &StatsCache,
        user: Uuid,
        section_size: i64,
    ) -> AppResult<HomeFeedDto> {
        let size = section_size.clamp(1, 50);
        let shelf_size = usize::try_from(size).unwrap_or(reco::shelves::SHELF_SIZE).min(reco::shelves::SHELF_SIZE);
        let listener = self.listeners.get(&self.db, user).await?;

        let (stats, recently_added, recently_played, (favorites, favorite_count), new_albums, own_playlists) = tokio::try_join!(
            overview::stats(&self.db, storage, stats, user),
            self.recently_added(user, size),
            self.recently_played(user, size),
            self.favorites(user, size),
            self.new_albums(size),
            self.own_playlists(user, size),
        )?;
        if recently_added.is_empty() {
            return Ok(HomeFeedDto { blocks: vec![], stats });
        }

        let quick_places = quick_places(&recently_played);
        let quick_album_ids: Vec<Uuid> = quick_places.iter().filter_map(|track| track.album_id).collect();
        let (personal, top, mix, mut quick_albums) = tokio::try_join!(
            self.personal_shelves(user, &listener, shelf_size),
            self.top_tracks(user, size),
            self.daily_mix_for(user, &listener),
            self.albums_by_ids(&quick_album_ids),
        )?;

        let (artist_shelf, track_shelves) = arrange(personal);
        let mut track_shelves = track_shelves.into_iter();
        let quick_playlists: Vec<PlaylistDto> = own_playlists.iter().take(QUICK_PLAYLISTS).cloned().collect();

        let blocks: Vec<Option<HomeBlockDto>> = vec![
            (mix.len() >= MINIMUM_HERO).then(|| HomeBlockDto {
                total_count: Some(i64::try_from(mix.len()).unwrap_or(i64::MAX)),
                tracks: Some(mix.iter().take(HERO_TRACKS).cloned().collect()),
                ..HomeBlockDto::new("dailyMix", Layout::Hero, Zone::Lead)
            }),
            (favorite_count > 0).then(|| HomeBlockDto {
                total_count: Some(favorite_count),
                tracks: Some(favorites.into_iter().take(MOSAIC).collect()),
                ..HomeBlockDto::new("favorites", Layout::Tile, Zone::Quick)
            }),
            (!quick_places.is_empty() || !quick_playlists.is_empty()).then(|| HomeBlockDto {
                tracks: Some(
                    quick_places.iter().filter(|track| track.album_id.is_none()).map(|&track| track.clone()).collect(),
                ),
                albums: Some(quick_album_ids.iter().filter_map(|id| quick_albums.remove(id)).collect()),
                playlists: Some(quick_playlists),
                ..HomeBlockDto::new("quickTiles", Layout::QuickTiles, Zone::Quick)
            }),
            (new_albums.len() >= MINIMUM_BLOCK).then(|| HomeBlockDto {
                albums: Some(new_albums),
                ..HomeBlockDto::new("newAlbums", Layout::Shelf, Zone::Browse)
            }),
            HomeBlockDto::tracks("newArrivals", Layout::Grid, recently_added),
            artist_shelf.map(Hydrated::block),
            track_shelves.next().map(Hydrated::block),
            (!own_playlists.is_empty()).then(|| HomeBlockDto {
                playlists: Some(own_playlists),
                ..HomeBlockDto::new("yourPlaylists", Layout::Shelf, Zone::Browse)
            }),
            HomeBlockDto::tracks("topTracks", Layout::Chart, top),
            track_shelves.next().map(Hydrated::block),
        ];
        Ok(HomeFeedDto { blocks: blocks.into_iter().flatten().collect(), stats })
    }

    async fn recently_added(&self, user: Uuid, size: i64) -> AppResult<Vec<TrackDto>> {
        let mut query = tracks::select(user);
        query.push(" ORDER BY t.created_at DESC LIMIT ").push_bind(size);
        tracks::fetch(&self.db, query).await
    }

    async fn recently_played(&self, user: Uuid, size: i64) -> AppResult<Vec<TrackDto>> {
        let page = PageRequest::new(Some(1), Some(i32::try_from(size).unwrap_or(50)));
        Ok(history::recent(&self.db, user, page).await?.items)
    }

    async fn favorites(&self, user: Uuid, size: i64) -> AppResult<(Vec<TrackDto>, i64)> {
        let mut query = tracks::select(user);
        query
            .push(" JOIN favorites fav ON fav.track_id = t.id AND fav.user_id = ")
            .push_bind(user)
            .push(" ORDER BY fav.created_at DESC LIMIT ")
            .push_bind(size);
        let count = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM favorites WHERE user_id = $1"#, user)
            .fetch_one(&self.db);
        let (favorites, count) = tokio::try_join!(tracks::fetch(&self.db, query), async { Ok(count.await?) })?;
        Ok((favorites, count))
    }

    async fn new_albums(&self, size: i64) -> AppResult<Vec<AlbumDto>> {
        let mut query = albums::select();
        query.push(" ORDER BY a.created_at DESC LIMIT ").push_bind(size);
        albums::fetch(&self.db, query).await
    }

    async fn albums_by_ids(&self, ids: &[Uuid]) -> AppResult<HashMap<Uuid, AlbumDto>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut query = albums::select();
        query.push(" WHERE a.id = ANY(").push_bind(ids.to_vec()).push(")");
        Ok(albums::fetch(&self.db, query).await?.into_iter().map(|album| (album.id, album)).collect())
    }

    async fn own_playlists(&self, user: Uuid, size: i64) -> AppResult<Vec<PlaylistDto>> {
        let mut query = playlists::select();
        query.push(" WHERE p.user_id = ").push_bind(user).push(" ORDER BY p.updated_at DESC LIMIT ").push_bind(size);
        playlists::fetch(&self.db, query).await
    }
}

fn quick_places(recently_played: &[TrackDto]) -> Vec<&TrackDto> {
    let mut seen = HashSet::new();
    recently_played.iter().filter(|track| seen.insert(track.album_id.unwrap_or(track.id))).take(QUICK_PLACES).collect()
}

fn arrange(personal: Vec<Hydrated>) -> (Option<Hydrated>, Vec<Hydrated>) {
    let mut artist_shelf = None;
    let mut track_shelves = Vec::new();
    for shelf in personal.into_iter().filter(|shelf| shelf.count() >= MINIMUM_BLOCK) {
        if shelf.shelf.base_key() == "artistsForYou" {
            artist_shelf.get_or_insert(shelf);
        } else {
            track_shelves.push(shelf);
        }
    }
    track_shelves.sort_by_key(|shelf| SHELF_PRIORITY.iter().position(|key| *key == shelf.shelf.base_key()));
    track_shelves.truncate(MAX_TRACK_SHELVES);
    (artist_shelf, track_shelves)
}
