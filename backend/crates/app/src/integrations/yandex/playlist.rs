// SPDX-License-Identifier: AGPL-3.0-only

use reqwest::Url;
use uuid::Uuid;

pub fn api_path(source: &str) -> Option<String> {
    let url = Url::parse(source.trim()).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("music.yandex.ru")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return None;
    }

    let path: Vec<_> = url.path().trim_end_matches('/').split('/').collect();
    match path.as_slice() {
        ["", "playlists", id] => shared_path(id),
        ["", "users", owner, "playlists", id] => {
            let valid_owner = !owner.is_empty()
                && owner.len() <= 100
                && owner.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte));
            let kind = id.parse::<u32>().ok()?;
            (valid_owner && kind > 0).then(|| format!("/users/{owner}/playlists/{kind}"))
        }
        _ => None,
    }
}

fn shared_path(id: &str) -> Option<String> {
    let (prefix, uuid) = id.split_once('.').unwrap_or(("", id));
    if (!prefix.is_empty() && (prefix.len() != 2 || !prefix.bytes().all(|byte| byte.is_ascii_lowercase())))
        || uuid.len() != 36
    {
        return None;
    }
    let uuid = Uuid::parse_str(uuid).ok()?;
    Some(if prefix.is_empty() { format!("/playlist/{uuid}") } else { format!("/playlist/{prefix}.{uuid}") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_share_and_owner_links_to_fixed_api_paths() {
        let id = "92ad51cd-9305-4765-a925-4efb44b86543";
        assert_eq!(
            api_path(&format!("https://music.yandex.ru/playlists/{id}?utm_source=web&utm_medium=copy_link")),
            Some(format!("/playlist/{id}")),
        );
        assert_eq!(api_path(&format!("https://music.yandex.ru/playlists/lk.{id}")), Some(format!("/playlist/lk.{id}")));
        let expected = Some("/users/owner/playlists/1107".into());
        assert_eq!(api_path("https://music.yandex.ru/users/owner/playlists/1107/"), expected);
    }

    #[test]
    fn rejects_other_hosts_and_non_playlist_paths() {
        for source in [
            "http://music.yandex.ru/users/owner/playlists/1",
            "https://music.yandex.ru.example/users/owner/playlists/1",
            "https://name@music.yandex.ru/users/owner/playlists/1",
            "https://music.yandex.ru/users/a%2Fb/playlists/1",
            "https://music.yandex.ru/iframe/playlist/owner/1",
            "https://music.yandex.ru/playlists/1107",
            "https://music.yandex.ru/album/1107",
        ] {
            assert_eq!(api_path(source), None, "{source}");
        }
    }
}
