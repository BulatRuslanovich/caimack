// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::LazyLock;

use regex::Regex;

#[expect(clippy::expect_used, reason = "unit tests compile this fixed expression")]
static CHAPTER_PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9]{1,3}(?:_[0-9]{1,3})+(?:_+|\.[ \t]+|[ \t]+)(?P<title>.+)$")
        .expect("a valid chapter filename prefix")
});

#[derive(Debug, PartialEq, Eq)]
pub(super) struct BookName {
    pub title: String,
    pub author: Option<String>,
    pub narrator: Option<String>,
    pub release: bool,
}

pub(super) fn book(label: &str) -> BookName {
    let (label, release) = without_release_suffix(label);
    let label = normalize_spacing(label);
    let (mut author, mut title) = [" - ", " – ", " — "]
        .into_iter()
        .filter_map(|separator| label.split_once(separator))
        .min_by_key(|(left, _)| left.len())
        .map_or((None, label.as_str()), |(left, right)| (Some(left), right));

    if let Some(left) = author.filter(|left| release && !person_name(left)) {
        (author, title) = if person_name(title) { (Some(title), left) } else { (None, label.as_str()) };
    }

    let suffix = trailing_credit(title, " [", ']')
        .filter(|(_, credit)| (author.is_some() && !title_qualifier(credit)) || person_name(credit))
        .or_else(|| author.and_then(|_| trailing_credit(title, " (", ')').filter(|(_, credit)| person_name(credit))));
    let narrator = suffix.map(|(name, credit)| {
        title = name;
        credit.to_owned()
    });
    let title = if author.is_none() { split_joined_words(title) } else { title.to_owned() };
    BookName { title, author: author.map(str::to_owned), narrator, release }
}

pub(super) fn chapter(label: &str) -> String {
    let (label, _) = without_release_suffix(label);
    let title = CHAPTER_PREFIX
        .captures(label)
        .and_then(|parts| parts.name("title"))
        .filter(|title| title.as_str().chars().any(char::is_alphabetic))
        .map_or(label, |title| title.as_str());
    normalize_spacing(title)
}

pub(super) fn display_label(label: &str) -> String {
    normalize_spacing(without_release_suffix(label).0)
}

fn normalize_spacing(label: &str) -> String {
    label
        .split(|character: char| character == '_' || character.is_whitespace())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn without_release_suffix(label: &str) -> (&str, bool) {
    let label = label.trim();
    let mut remaining = label;
    let mut tags = 0;
    let mut adjacent = false;
    let mut release_tag = false;
    while let Some((prefix, tag)) = remaining.strip_suffix(']').and_then(|body| body.rsplit_once('[')) {
        if tag.len() < 3 || !tag.bytes().all(|byte| byte.is_ascii_alphanumeric() || b".-_".contains(&byte)) {
            break;
        }
        adjacent |= prefix.ends_with(']');
        release_tag |=
            tag.bytes().any(|byte| byte.is_ascii_digit()) || tag.bytes().all(|byte| byte.is_ascii_lowercase());
        tags += 1;
        remaining = prefix.trim_end();
    }
    let media_suffix = remaining.strip_suffix(')').and_then(|name| name.rsplit_once(" (")).filter(|(_, format)| {
        ["audio", "audiobook", "mp3", "m4a", "m4b", "flac"].iter().any(|name| format.eq_ignore_ascii_case(name))
    });
    if tags >= 2 && (media_suffix.is_some() || adjacent && release_tag) && !remaining.is_empty() {
        (media_suffix.map_or(remaining, |(name, _)| name), true)
    } else {
        (label, false)
    }
}

fn trailing_credit<'a>(title: &'a str, delimiter: &str, ending: char) -> Option<(&'a str, &'a str)> {
    let (name, credit) = title.strip_suffix(ending)?.rsplit_once(delimiter)?;
    let credit = credit.trim();
    (!credit.is_empty() && !credit.contains(['[', ']', '(', ')'])).then_some((name, credit))
}

fn title_qualifier(text: &str) -> bool {
    let mut words = text.split_whitespace();
    let first = words.next().unwrap_or_default();
    let last = words.next_back().unwrap_or(first);
    let first = first.to_lowercase();
    let last = last.to_lowercase();
    matches!(last.as_str(), "edition" | "издание")
        || first.bytes().all(|byte| byte.is_ascii_digit())
        || [
            "a",
            "an",
            "the",
            "book",
            "part",
            "volume",
            "edition",
            "annotated",
            "revised",
            "chapter",
            "abridged",
            "unabridged",
            "illustrated",
            "audio",
            "audiobook",
            "том",
            "часть",
            "книга",
            "издание",
            "глава",
        ]
        .contains(&first.as_str())
}

fn person_name(name: &str) -> bool {
    if title_qualifier(name) {
        return false;
    }
    let words = name.split_whitespace();
    let count = words.clone().count();
    (2..=5).contains(&count)
        && words.into_iter().all(|word| {
            word.starts_with(char::is_uppercase)
                && word.chars().all(|letter| letter.is_alphabetic() || ".-'’".contains(letter))
        })
}

fn split_joined_words(title: &str) -> String {
    if title.contains(char::is_whitespace) {
        return title.to_owned();
    }
    let mut spaced = String::new();
    let mut boundaries = 0;
    let mut previous = None::<char>;
    for character in title.chars() {
        if previous.is_some_and(char::is_lowercase) && character.is_uppercase() {
            spaced.push(' ');
            boundaries += 1;
        }
        spaced.push(character);
        previous = Some(character);
    }
    if boundaries >= 2 { spaced } else { title.to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_release_titles_keep_the_author_and_skip_scene_groups() {
        let name = book("a brief history of time - Stephen Hawking (Audio) [h33t][spooner]");
        assert_eq!(name.title, "a brief history of time");
        assert_eq!(name.author.as_deref(), Some("Stephen Hawking"));
        assert_eq!(name.narrator, None);
        assert_eq!(book("Author Name - Title [group23][release]").title, "Title");
        assert_eq!(book("A story - Surname [group23][release]").title, "A story - Surname");
        assert_eq!(book("The File [A][B]").title, "The File [A][B]");
        assert_eq!(book("The File [A1][B]").title, "The File [A1][B]");
    }

    #[test]
    fn fallback_labels_expand_joined_words_without_splitting_single_stylized_names() {
        assert_eq!(book("SurelyYoureJokingMrFeynman").title, "Surely Youre Joking Mr Feynman");
        assert_eq!(book("eBook").title, "eBook");
    }

    #[test]
    fn book_names_keep_literary_punctuation_qualifiers_and_reader_credits() {
        let name = book("Млодинов Леонард – (Не)совершенная случайность [Росляков Михаил]");
        assert_eq!(name.title, "(Не)совершенная случайность");
        assert_eq!(name.author.as_deref(), Some("Млодинов Леонард"));
        assert_eq!(name.narrator.as_deref(), Some("Росляков Михаил"));
        assert_eq!(book("Лебон_Гюстав_-_Психология_масс_(Таганов_П)").narrator.as_deref(), Some("Таганов П"));
        assert_eq!(book("Author Name - The Book (An Ambiguous Utopia)").title, "The Book (An Ambiguous Utopia)");
        assert_eq!(book("Author Name - Я - легенда (Book One)").title, "Я - легенда (Book One)");
        let name = book("Author Name — The Book - Part One [王明]");
        assert_eq!(name.narrator.as_deref(), Some("王明"));
        assert_eq!(name.title, "The Book - Part One");
        assert_eq!(book("Author Name — The Book [Annotated Edition]").title, "The Book [Annotated Edition]");
        assert_eq!(book("Author Name — The Book (Second Edition)").title, "The Book (Second Edition)");
        assert_eq!(book("Author Name — The Book [2024]").title, "The Book [2024]");
    }

    #[test]
    fn chapter_names_strip_numeric_file_prefixes_and_keep_meaningful_numbers() {
        assert_eq!(chapter("00_01_Содержание"), "Содержание");
        assert_eq!(chapter("1_1. Что такое жизнь?"), "Что такое жизнь?");
        assert_eq!(chapter("00_00_01_Содержание"), "Содержание");
        assert_eq!(chapter("01_02"), "01 02");
        assert_eq!(chapter("01_02___"), "01 02");
        assert_eq!(chapter("01_02_03 04"), "01 02 03 04");
        assert_eq!(chapter("1. Рассвет"), "1. Рассвет");
        assert_eq!(chapter("2001: A Space Odyssey"), "2001: A Space Odyssey");
        assert_eq!(chapter("00_01_(Не)совершенная случайность"), "(Не)совершенная случайность");
    }
}
