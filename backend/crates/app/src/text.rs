// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

pub fn normalize_key(value: &str) -> String {
    value.trim().to_lowercase().split(' ').filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ")
}

pub fn normalize_username(value: &str) -> String {
    value.trim().to_lowercase()
}

pub fn valid_username(value: &str) -> bool {
    let allowed = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    let length = value.chars().count();
    (5..=20).contains(&length)
        && value.chars().next().is_some_and(allowed)
        && value.chars().all(|c| allowed(c) || matches!(c, '.' | '_' | '-'))
}

pub fn to_latin(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut latin = String::with_capacity(value.len());
    for (index, &symbol) in chars.iter().enumerate() {
        let lower = symbol.to_lowercase().next().unwrap_or(symbol);
        let Some(replacement) = latin_for(lower) else {
            latin.push(symbol);
            continue;
        };
        if replacement.is_empty() {
            continue;
        }
        if symbol == lower {
            latin.push_str(replacement);
        } else if chars.get(index + 1).is_some_and(|next| next.is_uppercase()) {
            latin.push_str(&replacement.to_uppercase());
        } else {
            let mut letters = replacement.chars();
            if let Some(first) = letters.next() {
                latin.extend(first.to_uppercase());
                latin.push_str(letters.as_str());
            }
        }
    }
    latin
}

fn latin_for(letter: char) -> Option<&'static str> {
    Some(match letter {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        'г' | 'ґ' => "g",
        'д' => "d",
        'е' | 'ё' | 'э' => "e",
        'ж' => "zh",
        'з' => "z",
        'и' | 'і' => "i",
        'й' | 'ы' => "y",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' | 'ў' => "u",
        'ф' => "f",
        'х' => "kh",
        'ц' => "ts",
        'ч' => "ch",
        'ш' => "sh",
        'щ' => "shch",
        'ю' => "yu",
        'я' => "ya",
        'ъ' | 'ь' => "",
        'ї' => "yi",
        'є' => "ye",
        _ => return None,
    })
}

pub fn hex_lower(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";

    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        hex.push(char::from(DIGITS[usize::from(byte >> 4)]));
        hex.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_key_collapses_whitespace_and_case() {
        assert_eq!(normalize_key("  Daft   PUNK "), "daft punk");
    }

    #[test]
    fn cyrillic_is_transliterated_keeping_case() {
        assert_eq!(to_latin("Щедрин и ЖУК, Rock"), "Shchedrin i ZHUK, Rock");
    }

    #[test]
    fn hex_lower_matches_dotnet_lowercase_hex() {
        assert_eq!(hex_lower(&[0x00, 0xab, 0x7f]), "00ab7f");
    }
}
