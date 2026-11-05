// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

#![cfg(feature = "integration-tests")]

mod common;

use app::AppResult;
use app::auth::Client;
use sqlx::PgPool;

#[sqlx::test(migrations = "../../../db/migrations")]
async fn logout_revokes_cached_access_from_every_rotation_but_preserves_other_devices(db: PgPool) -> AppResult<()> {
    common::user(&db, "alice", false).await?;
    let auth = common::auth(&db);
    let first = common::login(&auth, "alice").await?;
    let other_device = common::login(&auth, "alice").await?;
    let rotated = auth.refresh(Some(&first.refresh_token), &Client::default()).await?;
    let old_access = common::principal(&auth, &first)?;
    let new_access = common::principal(&auth, &rotated)?;
    let other_access = common::principal(&auth, &other_device)?;
    assert!(auth.session_alive(&old_access).await?, "rotation must preserve in-flight access requests");
    assert!(auth.session_alive(&new_access).await?);
    assert!(auth.session_alive(&other_access).await?);

    auth.logout(Some(&rotated.refresh_token)).await?;

    assert!(!auth.session_alive(&old_access).await?, "logout must revoke the cached pre-refresh access token");
    assert!(!auth.session_alive(&new_access).await?);
    assert!(auth.session_alive(&other_access).await?, "another device must stay signed in");
    assert!(auth.refresh(Some(&first.refresh_token), &Client::default()).await.is_err());
    assert!(auth.refresh(Some(&rotated.refresh_token), &Client::default()).await.is_err());
    assert!(auth.session_alive(&other_access).await?, "old refresh attempts must not revoke unrelated devices");
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn logout_with_a_rotated_cookie_also_revokes_the_latest_token(db: PgPool) -> AppResult<()> {
    common::user(&db, "alice", false).await?;
    let auth = common::auth(&db);
    let first = common::login(&auth, "alice").await?;
    let rotated = auth.refresh(Some(&first.refresh_token), &Client::default()).await?;

    auth.logout(Some(&first.refresh_token)).await?;

    assert!(!auth.session_alive(&common::principal(&auth, &rotated)?).await?);
    assert!(auth.refresh(Some(&rotated.refresh_token), &Client::default()).await.is_err());
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn concurrent_refresh_cannot_restore_a_logged_out_session(db: PgPool) -> AppResult<()> {
    common::user(&db, "alice", false).await?;
    let auth = common::auth(&db);
    for _ in 0..8 {
        let first = common::login(&auth, "alice").await?;
        let client = Client::default();
        let (refreshed, logged_out) =
            tokio::join!(auth.refresh(Some(&first.refresh_token), &client), auth.logout(Some(&first.refresh_token)));
        logged_out?;
        if let Ok(rotated) = refreshed {
            assert!(!auth.session_alive(&common::principal(&auth, &rotated)?).await?);
        }
        let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM refresh_tokens").fetch_one(&db).await?;
        assert_eq!(remaining, 0);
    }
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn changing_an_admin_role_revokes_old_access_and_refresh(db: PgPool) -> AppResult<()> {
    let alice = common::user(&db, "alice", true).await?;
    common::user(&db, "bob", false).await?;
    let auth = common::auth(&db);
    let session = common::login(&auth, "alice").await?;
    let other = common::login(&auth, "bob").await?;
    let access = common::principal(&auth, &session)?;
    assert!(auth.session_alive(&access).await?);

    app::library::admin::set_admin(&db, &auth, alice, false).await?;

    assert!(!auth.session_alive(&access).await?, "an old admin JWT must stop authorizing requests");
    assert!(auth.refresh(Some(&session.refresh_token), &Client::default()).await.is_err());
    assert!(auth.session_alive(&common::principal(&auth, &other)?).await?);
    let new_session = common::login(&auth, "alice").await?;
    assert!(!common::principal(&auth, &new_session)?.is_admin);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn resetting_owner_password_revokes_sessions_after_restart(db: PgPool) -> anyhow::Result<()> {
    common::user(&db, "alice", true).await?;
    let auth = common::auth(&db);
    let session = common::login(&auth, "alice").await?;
    let access = common::principal(&auth, &session)?;
    app::owner::ensure_owner(
        &db,
        &app::config::OwnerConfig {
            username: "alice".to_owned(),
            password: Some("replacement password".to_owned()),
            reset_password: true,
        },
    )
    .await?;
    let restarted_auth = common::auth(&db);

    assert!(!restarted_auth.session_alive(&access).await?);
    assert!(restarted_auth.refresh(Some(&session.refresh_token), &Client::default()).await.is_err());
    assert!(common::login(&restarted_auth, "alice").await.is_err());
    assert!(restarted_auth.login("alice", "replacement password", &Client::default()).await.is_ok());
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn invalid_password_changes_leave_the_password_and_sessions_intact(db: PgPool) -> AppResult<()> {
    let alice = common::user(&db, "alice", false).await?;
    let auth = common::auth(&db);
    let session = common::login(&auth, "alice").await?;
    let access = common::principal(&auth, &session)?;
    assert!(matches!(
        auth.change_password(alice, access.session_id, "password", "").await,
        Err(app::AppError::Validation(_))
    ));
    assert!(matches!(
        app::library::admin::reset_password(&db, &auth, alice, "short".to_owned()).await,
        Err(app::AppError::Validation(_))
    ));
    assert!(auth.session_alive(&access).await?);
    assert!(common::login(&auth, "alice").await.is_ok());
    Ok(())
}
