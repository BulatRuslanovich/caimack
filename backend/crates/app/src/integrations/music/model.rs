// SPDX-License-Identifier: AGPL-3.0-only

use std::borrow::Cow;
use std::cmp::Reverse;
use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::text::normalize_key;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub duration: i32,
    pub isrc: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    #[serde(flatten)]
    pub track: Recording,
    pub source: String,
    pub id: String,
    pub format: Option<String>,
    pub bitrate: Option<i32>,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    #[serde(default)]
    pub restricted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAlbum {
    pub url: String,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub track_count: Option<i32>,
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchKind {
    #[default]
    All,
    Tracks,
    Albums,
}

pub struct SearchResults {
    pub tracks: Vec<Candidate>,
    pub albums: Vec<SearchAlbum>,
}

const SEARCH_TRACK_LIMIT: usize = 30;

pub struct SearchGroups {
    query: String,
    original_query: String,
    candidates: Vec<Candidate>,
}

impl SearchGroups {
    pub fn new(query: &str) -> Self {
        Self { query: search_key(&provider_query(query)), original_query: search_key(query), candidates: Vec::new() }
    }

    /// Rebuild from a deterministic order as independent providers finish.
    pub fn add(&mut self, tracks: Vec<Candidate>) -> Vec<Vec<&Candidate>> {
        self.candidates.extend(tracks);
        let mut tracks: Vec<_> = self.candidates.iter().collect();
        tracks.sort_by_cached_key(|candidate| {
            (
                Reverse(relevance(&self.query, &self.original_query, &candidate.track)),
                candidate.restricted,
                Reverse(advertised_quality(candidate)),
                &candidate.track.title,
                &candidate.track.artist,
                &candidate.source,
                &candidate.id,
            )
        });

        let mut groups: Vec<Vec<&Candidate>> = Vec::new();
        let mut seen = HashSet::new();
        for candidate in tracks {
            if !seen.insert((&candidate.source, &candidate.id)) {
                continue;
            }
            let matching = groups.iter_mut().find(|group| {
                group.iter().all(|other| {
                    same_recording(&other.track, &candidate.track) || same_recording(&candidate.track, &other.track)
                })
            });
            if let Some(group) = matching {
                group.push(candidate);
            } else {
                groups.push(vec![candidate]);
            }
        }
        let mut ranked: Vec<_> = groups
            .into_iter()
            .map(|mut group| {
                let match_rank = relevance(&self.query, &self.original_query, &group[0].track);
                group.sort_by_cached_key(|candidate| {
                    (
                        candidate.restricted,
                        Reverse(advertised_quality(candidate)),
                        Reverse(relevance(&self.query, &self.original_query, &candidate.track)),
                        &candidate.source,
                        &candidate.id,
                    )
                });
                let mut variants = HashSet::new();
                group.retain(|candidate| {
                    variants.insert((
                        candidate.source.as_str(),
                        candidate.format.as_deref().map(str::to_ascii_lowercase),
                        candidate.bitrate.filter(|bitrate| *bitrate > 0),
                        candidate.track.duration.max(0),
                    ))
                });
                (match_rank, group)
            })
            .collect();
        ranked.sort_by_cached_key(|(match_rank, group)| {
            let top = group[0];
            (
                Reverse(*match_rank),
                top.restricted,
                Reverse(advertised_quality(top)),
                &top.track.title,
                &top.track.artist,
                &top.source,
                &top.id,
            )
        });
        ranked.into_iter().take(SEARCH_TRACK_LIMIT).map(|(_, group)| group).collect()
    }
}

fn advertised_quality(candidate: &Candidate) -> (bool, i32, bool) {
    let format = candidate.format.as_deref().map(str::to_ascii_lowercase);
    let (lossless, bitrate) = rank(format.as_deref(), candidate.bitrate);
    (lossless, bitrate.max(0), format.is_some())
}

fn search_key(value: &str) -> String {
    normalize_key(value)
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn provider_query(value: &str) -> Cow<'_, str> {
    static REMASTER: LazyLock<Option<Regex>> = LazyLock::new(|| {
        Regex::new(
            r"(?ix) [\[(] \s* (?: [0-9]{4} \s+ )? (?: digital \s+ )? remaster(?:ed)? (?: \s+ [0-9]{4} )? \s* [\])]",
        )
        .ok()
    });

    match REMASTER.as_ref().map(|pattern| pattern.replace_all(value, " ")) {
        Some(Cow::Owned(clean)) if clean.trim().chars().count() >= 2 => {
            Cow::Owned(clean.split_whitespace().collect::<Vec<_>>().join(" "))
        }
        _ => Cow::Borrowed(value),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum TitleMatch {
    Other,
    TitleWords,
    TitlePhrase,
    ExactTitle,
    TitleAndArtist,
}

fn title_and_artist_match(query: &str, title: &str, artist: &str) -> bool {
    !title.is_empty()
        && !artist.is_empty()
        && (query.strip_prefix(title).and_then(|rest| rest.strip_prefix(' ')) == Some(artist)
            || query.strip_prefix(artist).and_then(|rest| rest.strip_prefix(' ')) == Some(title))
}

fn relevance(query: &str, original_query: &str, track: &Recording) -> (TitleMatch, bool, usize, usize) {
    let clean_title = title(&provider_query(&track.title), &track.artist);
    let title_key = search_key(&clean_title);
    let artist_key = search_key(normalize_key(&track.artist).trim_end_matches(" - topic"));

    // Video providers sometimes put the performing artist in the title and the uploader in the artist field.
    let credited = clean_title
        .split_once(" - ")
        .map(|(credit, name)| (search_key(name), search_key(credit)))
        .filter(|(name, credit)| title_and_artist_match(query, name, credit));
    let (scoring_title, scoring_artist) = credited
        .as_ref()
        .map_or((title_key.as_str(), artist_key.as_str()), |(name, credit)| (name.as_str(), credit.as_str()));
    let title_words = matching_words(query, scoring_title);
    let full_words = matching_words(query, &format!("{scoring_title} {scoring_artist}"));
    let title_match = if title_and_artist_match(query, scoring_title, scoring_artist) {
        TitleMatch::TitleAndArtist
    } else if query == scoring_title {
        TitleMatch::ExactTitle
    } else if scoring_title.contains(' ') && format!(" {query} ").contains(&format!(" {scoring_title} ")) {
        TitleMatch::TitlePhrase
    } else if title_words > 0 {
        TitleMatch::TitleWords
    } else {
        TitleMatch::Other
    };
    let edition_match = query != original_query && {
        let original_title = search_key(&title(&track.title, &track.artist));
        original_query == original_title || title_and_artist_match(original_query, &original_title, scoring_artist)
    };
    (title_match, edition_match, title_words, full_words)
}

fn matching_words(query: &str, text: &str) -> usize {
    query.split_whitespace().filter(|word| text.split_whitespace().any(|part| part == *word)).count()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSnapshot {
    pub name: String,
    pub tracks: Vec<Candidate>,
    #[serde(default)]
    pub omitted: usize,
    #[serde(default)]
    pub partial: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ImportRequest {
    Track {
        candidate: Candidate,
        automatic: bool,
        sources: Vec<String>,
        search_query: Option<String>,
    },
    Playlist {
        url: String,
        sources: Vec<String>,
        #[serde(default)]
        allow_partial: bool,
        preview_id: Option<Uuid>,
    },
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub id: Uuid,
    pub title: Option<String>,
    pub state: String,
    pub error: Option<String>,
    pub playlist_id: Option<Uuid>,
    pub partial: bool,
    pub omitted: i32,
    pub total: i64,
    pub done: i64,
    pub failed: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub position: i32,
    pub track: Candidate,
    pub state: String,
    pub track_id: Option<Uuid>,
    pub error: Option<String>,
    pub attempts: serde_json::Value,
    pub upgrade: Option<Candidate>,
}

pub fn query(track: &Recording) -> String {
    format!("{} {}", track.artist, track.title).chars().take(200).collect()
}

fn artist(value: &str) -> String {
    let mut names: Vec<_> = normalize_key(value)
        .split([',', ';'])
        .map(|name| name.trim().trim_end_matches(" - topic").to_owned())
        .filter(|name| !name.is_empty())
        .collect();
    names.sort_unstable();
    names.dedup();
    names.join(",")
}

fn title(value: &str, expected_artist: &str) -> String {
    let mut value = normalize_key(value);
    for suffix in [
        " (official audio)",
        " (official video)",
        " (official music video)",
        " (official hd music video)",
        " [official audio]",
        " [official video]",
        " (lyric video)",
        " (official lyric video)",
    ] {
        if value.ends_with(suffix) {
            value.truncate(value.len() - suffix.len());
            break;
        }
    }
    if let Some((name, credit)) = value.rsplit_once(" (from ")
        && let Some(album) = credit.strip_suffix(')')
        && [('"', '"'), ('“', '”'), ('\'', '\'')].into_iter().any(|(open, close)| {
            album.strip_prefix(open).and_then(|name| name.strip_suffix(close)).is_some_and(|name| !name.is_empty())
        })
    {
        value.truncate(name.len());
    }
    let prefix = format!("{} - ", normalize_key(expected_artist));
    value.strip_prefix(&prefix).unwrap_or(&value).to_owned()
}

pub fn same_recording(expected: &Recording, candidate: &Recording) -> bool {
    if let (Some(a), Some(b)) = (&expected.isrc, &candidate.isrc) {
        return !a.is_empty() && a.eq_ignore_ascii_case(b);
    }
    if expected.title.trim().is_empty() || expected.artist.trim().is_empty() {
        return false;
    }
    let candidate_artist = artist(&candidate.artist);
    let title_credit = normalize_key(&candidate.title).starts_with(&format!("{} - ", normalize_key(&expected.artist)));
    (artist(&expected.artist) == candidate_artist || title_credit)
        && title(&expected.title, &expected.artist) == title(&candidate.title, &expected.artist)
        && (expected.duration <= 0 || candidate.duration <= 0 || expected.duration.abs_diff(candidate.duration) <= 3)
}

pub fn rank(format: Option<&str>, bitrate: Option<i32>) -> (bool, i32) {
    (format == Some("flac"), bitrate.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(title: &str, artist: &str, duration: i32) -> Recording {
        Recording { title: title.into(), artist: artist.into(), duration, isrc: None }
    }

    #[test]
    fn exact_recording_ranks_first_regardless_of_provider_completion_order() {
        let make = |source: &str, title, artist, duration| Candidate {
            track: track(title, artist, duration),
            source: source.into(),
            id: "1".into(),
            format: None,
            bitrate: None,
            album: None,
            cover_url: None,
            restricted: false,
        };
        let mut results = SearchGroups::new("Last Christmas Wham!");
        let _ = results.add(vec![
            make("soundcloud", "Last Christmas - Wham! (1 Hour)", "Suit14", 3600),
            make("jiosaavn", "Last Christmas (By Wham!) (Karaoke Version)", "ZZang KARAOKE", 265),
        ]);
        let groups = results.add(vec![
            make("youtube", "Wham! - Last Christmas (Official Audio)", "Wham! - Topic", 265),
            make("yandex", "Last Christmas", "Wham!", 266),
        ]);

        assert_eq!(groups[0][0].source, "yandex");
        assert_eq!(groups[0][1].source, "youtube");
        assert_eq!(groups.len(), 3);
    }

    fn copy(source: &str, id: &str, title: &str, format: Option<&str>, bitrate: Option<i32>) -> Candidate {
        Candidate {
            track: track(title, "Artist", 200),
            source: source.into(),
            id: id.into(),
            format: format.map(str::to_owned),
            bitrate,
            album: None,
            cover_url: None,
            restricted: false,
        }
    }

    #[test]
    fn late_exact_match_preserves_previously_shown_version() {
        let mut search = SearchGroups::new("Snowman (Sped Up Version) Sia");
        let mut first = copy("yandex", "first", "Snowman (Sped Up)", None, None);
        first.track = track("Snowman (Sped Up)", "Sia", 138);
        assert_eq!(search.add(vec![first])[0][0].track.duration, 138);

        let mut second = copy("youtube", "second", "[Sia] - Snowman - (Sped up Version)", None, None);
        second.track = track("[Sia] - Snowman - (Sped up Version)", "MusicCore", 135);
        let groups = search.add(vec![second]);
        let durations: Vec<_> = groups.iter().map(|group| group[0].track.duration).collect();

        assert_eq!(durations, [135, 138]);
    }

    #[test]
    fn search_ranks_copies_by_quality_and_hides_duplicate_source_formats() {
        let mut search = SearchGroups::new("Window Artist");
        let mut restricted = copy("jiosaavn", "a", "Window", Some("aac"), Some(320));
        restricted.restricted = true;
        let groups = search.add(vec![
            restricted,
            copy("jiosaavn", "b", "Window", Some("AAC"), Some(320)),
            copy("jiosaavn", "c", "Window", Some("aac"), Some(320)),
            copy("jiosaavn", "d", "Window", Some("aac"), Some(160)),
            copy("yandex", "e", "Window", Some("flac"), None),
            copy("youtube", "f", "Window", None, None),
        ]);
        let ids: Vec<_> = groups[0].iter().map(|candidate| candidate.id.as_str()).collect();

        assert_eq!(ids, ["e", "b", "d", "f"]);
    }

    #[test]
    fn search_preserves_distinct_durations_with_the_same_source_and_quality() {
        let mut search = SearchGroups::new("Window Artist");
        let mut longer = copy("jiosaavn", "a", "Window", Some("aac"), Some(320));
        longer.track.duration = 138;
        let mut shorter = longer.clone();
        shorter.id = "b".into();
        shorter.track.duration = 135;
        let mut duplicate = longer.clone();
        duplicate.id = "c".into();

        let groups = search.add(vec![longer, shorter, duplicate]);
        assert_eq!(groups.len(), 1);
        let durations: Vec<_> = groups[0].iter().map(|candidate| candidate.track.duration).collect();
        assert_eq!(durations, [138, 135]);
    }

    #[test]
    fn search_keeps_only_thirty_recordings_and_promotes_quality_on_equal_relevance() {
        let mut search = SearchGroups::new("Window");
        let first: Vec<_> =
            (0..30).map(|i| copy("youtube", &i.to_string(), &format!("Window {i}"), None, None)).collect();
        assert_eq!(search.add(first).len(), 30);
        let groups = search.add(vec![copy("yandex", "lossless", "Window FLAC", Some("flac"), None)]);
        assert_eq!(groups.len(), 30);
        assert_eq!(groups[0][0].id, "lossless");
    }

    #[test]
    fn remaster_label_does_not_rank_other_songs_from_the_same_release() {
        let query = "My Song (2006 Digital Remaster) Labi Siffre";
        assert_eq!(provider_query(query), "My Song Labi Siffre");
        assert_eq!(provider_query("Window (Live) Artist"), "Window (Live) Artist");
        let with_artist = |source, id, name, artist, format| {
            let mut candidate = copy(source, id, name, format, None);
            candidate.track.artist = artist;
            candidate
        };
        let mut search = SearchGroups::new(query);
        let groups = search.add(vec![
            with_artist(
                "yandex",
                "other-song",
                "Bless The Telephone (2006 Digital Remaster)",
                "Labi Siffre".into(),
                Some("flac"),
            ),
            with_artist(
                "youtube",
                "publisher",
                "Labi Siffre - My Song (Official HD Music Video)",
                "DemonMusicGroup".into(),
                None,
            ),
            with_artist("jiosaavn", "cover", "My Song", "Another Artist".into(), Some("flac")),
            with_artist("yandex", "remaster", "My Song (2006 Digital Remaster)", "Labi Siffre".into(), None),
        ]);

        assert_eq!(groups[0][0].id, "remaster");
        assert_eq!(groups[1][0].id, "publisher");
        assert_eq!(groups[3][0].id, "other-song");
    }

    #[test]
    fn recording_identity_rejects_remixes_covers_and_wrong_lengths() {
        let wanted = track("Window", "The Artist", 200);
        assert!(same_recording(&wanted, &track("The Artist - Window (Official Audio)", "The Artist - Topic", 202)));
        assert!(!same_recording(&wanted, &track("Window (Live)", "The Artist", 200)));
        assert!(!same_recording(&wanted, &track("Window", "Another Artist", 200)));
        assert!(!same_recording(&wanted, &track("Window", "The Artist", 30)));
        assert!(same_recording(&wanted, &track("Window (From \"Album\")", "The Artist", 200)));
        assert!(rank(Some("flac"), None) > rank(Some("mp3"), Some(320)));
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TrackSelection {
    pub query: String,
    pub candidate: Candidate,
}
