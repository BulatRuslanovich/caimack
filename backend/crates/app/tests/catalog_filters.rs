// SPDX-License-Identifier: AGPL-3.0-only

#![cfg(feature = "integration-tests")]

use app::AppResult;
use app::catalog::search;
use app::catalog::tracks::{self, TrackFilter, TrackSort};
use app::paging::PageRequest;
use media::key::MusicalKey;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../../db/migrations")]
async fn popular_search_ranks_tracks_and_aggregates_plays_by_album_and_credited_artist(db: PgPool) -> AppResult<()> {
    let listener = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users(id,username,password_hash,is_admin,created_at) VALUES ($1,'Listener','test',false,now())",
    )
    .bind(listener)
    .execute(&db)
    .await?;
    let mut artists = Vec::new();
    let mut albums = Vec::new();
    let mut tracks = Vec::new();
    for group in 0..6 {
        let artist = Uuid::now_v7();
        let album = Uuid::now_v7();
        artists.push(artist);
        albums.push(album);
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,$2,$2,now())")
            .bind(artist)
            .bind(format!("artist-{group}"))
            .execute(&db)
            .await?;
        sqlx::query("INSERT INTO albums(id,title,normalized_title,artist_id,created_at) VALUES ($1,$2,$2,$3,now())")
            .bind(album)
            .bind(format!("album-{group}"))
            .bind(artist)
            .execute(&db)
            .await?;

        for number in 0..2 {
            let track = Uuid::now_v7();
            tracks.push(track);
            let name = format!("track-{group}-{number}");
            sqlx::query(
                "INSERT INTO tracks(id,title,normalized_title,artist_id,album_id,duration_seconds,file_path,
                 original_file_name,mime_type,file_size,content_hash,created_at)
                 VALUES ($1,$2,$2,$3,$4,180,$2,$2,'audio/mpeg',1,$2,now())",
            )
            .bind(track)
            .bind(name)
            .bind(artist)
            .bind(album)
            .execute(&db)
            .await?;
            let plays = match (group, number) {
                (0, 0) => 8,
                (5, _) => 5,
                _ => 0,
            };
            sqlx::query(
                "INSERT INTO listening_history(id,user_id,track_id,played_at,playback_position)
                 SELECT gen_random_uuid(),$1,$2,now(),30 FROM generate_series(1,$3)",
            )
            .bind(listener)
            .bind(track)
            .bind(plays)
            .execute(&db)
            .await?;
        }
    }

    sqlx::query("INSERT INTO track_artists(track_id,artist_id,position) VALUES ($1,$2,0),($1,$3,1)")
        .bind(tracks[10])
        .bind(artists[5])
        .bind(artists[4])
        .execute(&db)
        .await?;
    let popular = search::popular(&db, Uuid::now_v7()).await?;
    assert_eq!((popular.tracks.len(), popular.albums.len(), popular.artists.len()), (10, 5, 5));
    assert_eq!(
        popular.tracks[..3].iter().map(|track| track.id).collect::<Vec<_>>(),
        [tracks[0], tracks[10], tracks[11]]
    );
    assert_eq!(popular.albums[..2].iter().map(|album| album.id).collect::<Vec<_>>(), [albums[5], albums[0]]);
    assert_eq!(
        popular.artists[..3].iter().map(|artist| artist.id).collect::<Vec<_>>(),
        [artists[5], artists[0], artists[4]]
    );
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn shuffle_applies_the_same_search_tempo_and_key_filters_as_the_track_list(db: PgPool) -> AppResult<()> {
    let user = Uuid::now_v7();
    let artist = Uuid::now_v7();
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    for (index, (title, bpm, key)) in [
        ("slow matching", Some(80.0), Some(0_i16)),
        ("slow too fast", Some(150.0), Some(0)),
        ("slow other key", Some(80.0), Some(1)),
        ("unrelated", Some(80.0), Some(0)),
        ("slow unknown analysis", None, None),
    ]
    .into_iter()
    .enumerate()
    {
        let track = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,
            original_file_name,mime_type,file_size,content_hash,created_at)
            VALUES ($1,$2,$2,$3,180,$4,$4,'audio/mpeg',1,$4,now())",
        )
        .bind(track)
        .bind(title)
        .bind(artist)
        .bind(format!("track-{index}.mp3"))
        .execute(&db)
        .await?;
        sqlx::query(
            "INSERT INTO track_cues(track_id,source_hash,version,succeeded,audio_start_seconds,audio_end_seconds,
            outro_start_seconds,tempo_bpm,musical_key,analyzed_at) VALUES ($1,'test',1,true,0,180,175,$2,$3,now())",
        )
        .bind(track)
        .bind(bpm)
        .bind(key)
        .execute(&db)
        .await?;
    }
    let filter =
        TrackFilter { bpm_min: Some(70.0), bpm_max: Some(90.0), keys: vec![MusicalKey { index: 0, confidence: 1.0 }] };
    let listed = tracks::list(&db, user, PageRequest::default(), TrackSort::Title, Some("slow"), &filter).await?;
    let shuffled = tracks::shuffle(&db, user, None, Some("slow"), &filter).await?;
    assert_eq!(listed.total, 1);
    assert_eq!(
        shuffled.iter().map(|t| t.id).collect::<Vec<_>>(),
        listed.items.iter().map(|t| t.id).collect::<Vec<_>>()
    );
    Ok(())
}
