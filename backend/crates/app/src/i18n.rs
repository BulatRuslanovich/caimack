// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Lang {
    #[default]
    En,
    Ru,
}

impl Lang {
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Ru => "ru",
        }
    }

    pub fn from_accept_language(header: &str) -> Lang {
        let mut ranges: Vec<(f32, Option<Lang>)> = header
            .split(',')
            .filter_map(|range| {
                let mut parts = range.split(';');
                let tag = parts.next()?.trim();
                let quality = parts
                    .filter_map(|param| param.trim().strip_prefix("q="))
                    .find_map(|q| q.trim().parse::<f32>().ok())
                    .unwrap_or(1.0);

                (!tag.is_empty() && quality > 0.0).then(|| (quality, Lang::from_tag(tag)))
            })
            .collect();

        ranges.sort_by(|a, b| b.0.total_cmp(&a.0));
        ranges.into_iter().find_map(|(_, lang)| lang).unwrap_or_default()
    }

    fn from_tag(tag: &str) -> Option<Lang> {
        let primary = tag.split(['-', '_']).next()?;
        if primary.eq_ignore_ascii_case("ru") {
            Some(Lang::Ru)
        } else if primary.eq_ignore_ascii_case("en") {
            Some(Lang::En)
        } else {
            None
        }
    }
}

pub fn localize(template: &str, args: &[String], lang: Lang) -> String {
    let text = match lang {
        Lang::Ru => russian(template).unwrap_or(template),
        Lang::En => template,
    };
    format_template(text, args)
}

pub fn format_template(template: &str, args: &[String]) -> String {
    let mut text = template.to_owned();
    for (index, arg) in args.iter().enumerate() {
        text = text.replace(&format!("{{{index}}}"), arg);
    }
    text
}

fn russian(template: &str) -> Option<&'static str> {
    Some(match template {
        "The requested resource was not found." => "Не найдено.",
        "Invalid credentials." => "Нужно войти заново.",
        "Access denied." => "Нет доступа.",
        "An unexpected error occurred." => "Что-то пошло не так.",
        "One or more validation errors occurred." => "Запрос заполнен неверно.",

        "Invalid username or password." => "Неверное имя пользователя или пароль.",
        "This account has been deactivated." => "Учётная запись отключена.",
        "Too many attempts. Try again in {0} s." => "Слишком много попыток. Повторите через {0} с.",
        "Cross-site requests are not allowed." => "Запросы с чужих сайтов запрещены.",
        "A pause lasts from 1 to {0} days." => "Пауза длится от 1 до {0} дней.",
        "An invitation lasts from 1 to {0} days." => "Приглашение действует от 1 до {0} дней.",
        "The invitation was not found or has already been used." => "Приглашение не найдено или уже использовано.",
        "The invitation link is invalid or has expired." => "Ссылка-приглашение неверна или истекла.",
        "Use 5–20 characters for the username: lower-case letters, digits, . - _" => {
            "Имя пользователя — 5–20 символов: строчные латинские буквы, цифры, . - _"
        }
        "The password must contain at least 8 characters and at most 72 UTF-8 bytes." => {
            "Пароль должен содержать не меньше 8 символов и не больше 72 байт UTF-8."
        }
        "The current password is not correct." => "Текущий пароль неверный.",
        "Missing refresh token." => "Нужно войти заново.",
        "Refresh token is invalid or expired." => "Нужно войти заново.",
        "User not found." => "Пользователь не найден.",
        "A user with that username already exists." => "Пользователь с таким именем уже есть.",

        "Track not found." => "Трек не найден.",
        "Album not found." => "Альбом не найден.",
        "Artist not found." => "Исполнитель не найден.",
        "Genre not found." => "Жанр не найден.",
        "Playlist not found." => "Плейлист не найден.",
        "The playlist name must contain 1 to 200 characters." => {
            "Название плейлиста должно содержать от 1 до 200 символов."
        }
        "The playlist description must not exceed 1000 characters." => {
            "Описание плейлиста не должно превышать 1000 символов."
        }
        "The track is not in this playlist." => "Этого трека нет в плейлисте.",
        "At least one track id is required." => "Не выбрано ни одного трека.",
        "No tracks were selected." => "Не выбрано ни одного трека.",
        "At most {0} tracks can be looked up at once." => "За раз можно запросить не больше {0} треков.",
        "An artist named \"{0}\" already exists." => "Исполнитель «{0}» уже есть.",
        "\"{0}\" already exists for that artist." => "У этого исполнителя уже есть «{0}».",
        "The waveform is not ready yet." => "Волна трека ещё не готова.",

        "This album has no cover art" => "У альбома нет обложки.",
        "This track has no cover art." => "У трека нет обложки.",
        "This playlist has no cover art." => "У плейлиста нет обложки.",
        "This artist has no photo." => "У исполнителя нет фото.",
        "The image file is missing from storage." => "Файл картинки пропал из хранилища.",
        "No image was provided." => "Картинка не выбрана.",
        "Only JPEG, PNG and WebP images are accepted." => "Подходят только JPEG, PNG и WebP.",
        "Only .jpg, .png and .webp files are accepted." => "Подходят только файлы .jpg, .png и .webp.",
        "That file could not be read as an image." => "Этот файл не читается как картинка.",
        "That image has too many pixels to process." => "Картинка слишком большая.",

        "The file is empty." => "Файл пустой.",
        "The file contains no audio stream." => "В файле нет звука.",
        "The file exceeds the {0} MB limit." => "Файл больше {0} МБ.",
        "The file exceeds the {0} MB upload limit." => "Файл больше {0} МБ.",
        "Only {0} files are supported." => "Подходят только файлы {0}.",
        "The file is not a readable {0} file." => "Файл {0} не читается.",
        "The file is not a {0} file despite its name." => "Это не {0}, хотя так назван.",
        "The uploaded file could not be read back." => "Загруженный файл не читается.",
        "The file could not be processed." => "Файл не удалось обработать.",
        "This file is already in the library." => "Этот файл уже есть в библиотеке.",
        "A lossless version of this track is already in the library." => "Этот трек уже есть в библиотеке в lossless.",

        "The audio file for this track is missing from storage." => "Аудиофайл трека пропал из хранилища.",
        "HLS asset not found." => "Поток не найден.",
        "Original is not an HLS quality cap." => "Исходное качество не ограничивает поток.",
        "A deviceId is required." => "Не указано устройство.",
        "The index must point into the queue." => "Такого места в очереди нет.",
        "Repeat must be off, all or one." => "Неизвестный режим повтора.",
        "Another device holds playback." => "Музыка сейчас играет на другом устройстве.",
        "Nothing is playing on another device." => "На других устройствах ничего не играет.",
        "The tracks that were playing are gone." => "Треков, которые играли, больше нет.",
        "A play is only recorded after {0} seconds of listening." => "Прослушивание засчитывается после {0} с.",

        "Unknown mood '{0}'." => "Неизвестное настроение «{0}».",
        "Radio limit must be between 1 and {0}." => "Радио берёт от 1 до {0} треков.",
        "Days must be between 1 and {0}." => "Период — от 1 до {0} дней.",
        "Unknown audio quality." => "Неизвестное качество звука.",
        "The time zone name is not valid." => "Неверный часовой пояс.",
        "Unknown time zone '{0}'." => "Неизвестный часовой пояс «{0}».",

        "Select at least two tracks." => "Выберите хотя бы два трека.",
        "Select the tracks to remove." => "Выберите треки, которые убрать.",

        "Add a Yandex Music token in the settings first." => "Сначала добавьте токен Яндекс Музыки в настройках.",
        "The Yandex Music token is too long." => "Токен Яндекс Музыки слишком длинный.",
        "Yandex Music rejected the token." => "Яндекс Музыка не приняла токен.",
        "Yandex Music did not answer ({0})." => "Яндекс Музыка не ответила ({0}).",
        "Unknown import source." => "Непонятно, что импортировать.",
        "This import is already running." => "Этот импорт уже идёт.",
        "Import not found." => "Импорт не найден.",
        "Nothing to import here." => "Здесь нечего импортировать.",
        "This track is not available on Yandex Music." => "Трек недоступен в Яндекс Музыке.",
        "Yandex Music did not give a download link for this track." => "Яндекс Музыка не дала ссылку на этот трек.",
        "Yandex Music offered only {0}, which Caimack does not store." => {
            "Яндекс Музыка отдаёт только {0}, а Caimack такое не хранит."
        }
        "The FLAC stream could not be unpacked." => "Не удалось распаковать FLAC.",
        "The import failed." => "Импорт не удался.",

        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accept_language_picks_highest_supported_quality() {
        assert_eq!(Lang::from_accept_language("de-DE, en;q=0.5, ru-RU;q=0.8"), Lang::Ru);
    }

    #[test]
    fn accept_language_falls_back_to_english() {
        assert_eq!(Lang::from_accept_language("de, fr;q=0.9"), Lang::En);
    }

    #[test]
    fn accept_language_ignores_zero_quality() {
        assert_eq!(Lang::from_accept_language("ru;q=0, en;q=0.1"), Lang::En);
    }

    #[test]
    fn localize_substitutes_arguments_in_translation() {
        let text = localize("The file exceeds the {0} MB limit.", &["200".to_owned()], Lang::Ru);
        assert_eq!(text, "Файл больше 200 МБ.");
    }

    #[test]
    fn localize_keeps_english_without_translation() {
        assert_eq!(localize("Something new.", &[], Lang::Ru), "Something new.");
    }
}
