// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

mod images;
mod stream;
mod upload;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};

use self::images::{
    album_cover, artist_image, playlist_cover, remove_album_cover, remove_artist_image, remove_playlist_cover,
    set_album_cover, set_artist_image, set_playlist_cover, track_cover,
};
use self::stream::{download, hls_asset, hls_master, stream, waveform};
use self::upload::{library_scan, rescan_library, upload, upload_check};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/tracks/{id}/stream", get(stream))
        .route("/api/tracks/{id}/download", get(download))
        .route("/api/tracks/{id}/waveform", get(waveform))
        .route("/api/tracks/{id}/cover", get(track_cover))
        .route("/api/tracks/{id}/hls/master.m3u8", get(hls_master))
        .route("/api/tracks/{id}/hls/{quality}/{file_name}", get(hls_asset))
        .route("/api/tracks/upload/check", post(upload_check))
        .route("/api/tracks/upload", post(upload).layer(DefaultBodyLimit::disable()))
        .route("/api/library/scan", get(library_scan).post(rescan_library))
        .route(
            "/api/albums/{id}/cover",
            get(album_cover).post(set_album_cover).delete(remove_album_cover).layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/api/artists/{id}/image",
            get(artist_image).post(set_artist_image).delete(remove_artist_image).layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/api/playlists/{id}/cover",
            get(playlist_cover)
                .post(set_playlist_cover)
                .delete(remove_playlist_cover)
                .layer(DefaultBodyLimit::disable()),
        )
}
