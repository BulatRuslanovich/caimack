// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, bail};
use ipnet::IpNet;
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct Config {
    pub app_env: AppEnv,
    pub listen_addr: SocketAddr,
    pub database: DatabaseConfig,
    pub jwt: JwtConfig,
    pub storage_root: PathBuf,
    pub owner: OwnerConfig,
    pub lrclib_base_url: String,
    pub deezer_base_url: String,
    pub yandex_music: YandexMusicConfig,
    pub trusted_proxies: Vec<IpNet>,
    pub library_scan_interval: Option<Duration>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppEnv {
    Development,
    Production,
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
}

impl DatabaseConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        #[derive(Deserialize)]
        struct Env {
            database_url: Option<String>,
        }

        let env: Env = envy::from_env().context("Could not read the configuration from the environment")?;
        let url = env
            .database_url
            .filter(|url| !url.trim().is_empty())
            .context("DATABASE_URL is required, e.g. postgres://music:password@localhost:5432/music.")?;
        Ok(Self { url, max_connections: 2 })
    }
}

#[derive(Debug, Clone)]
pub struct ModelConfig {
    pub url: String,
}

impl ModelConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        #[derive(Deserialize)]
        struct Env {
            mert_url: Option<String>,
        }
        let env: Env = envy::from_env().context("Could not read MERT configuration")?;
        let url = nonempty(env.mert_url).unwrap_or_else(|| "http://127.0.0.1:8090".to_owned());
        let parsed = reqwest::Url::parse(&url).context("MERT_URL must be an HTTP URL")?;
        anyhow::ensure!(
            matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some(),
            "MERT_URL must be an HTTP URL"
        );
        Ok(Self { url })
    }
}

#[derive(Debug, Clone)]
pub struct JwtConfig {
    pub signing_key: String,
    pub access_token_minutes: i64,
    pub refresh_token_days: i64,
}

#[derive(Debug, Clone)]
pub struct OwnerConfig {
    pub username: String,
    pub password: Option<String>,
    pub reset_password: bool,
}

#[derive(Debug, Clone)]
pub struct YandexMusicConfig {
    pub base_url: String,

    pub client: String,
    pub sign_key: String,
}

#[derive(Deserialize)]
struct Env {
    #[serde(default = "default_app_env")]
    app_env: AppEnv,
    #[serde(default = "default_listen_addr")]
    listen_addr: String,
    database_url: Option<String>,
    #[serde(default = "default_max_connections")]
    database_max_connections: u32,
    jwt_signing_key: Option<String>,
    #[serde(default = "default_access_token_minutes")]
    jwt_access_token_minutes: i64,
    #[serde(default = "default_refresh_token_days")]
    jwt_refresh_token_days: i64,
    #[serde(default = "default_storage_root")]
    storage_root: PathBuf,
    #[serde(default = "default_owner_username")]
    owner_username: String,
    owner_password: Option<String>,
    #[serde(default)]
    owner_reset_password: bool,
    #[serde(default = "default_lrclib_base_url")]
    lrclib_base_url: String,
    #[serde(default = "default_deezer_base_url")]
    deezer_base_url: String,
    #[serde(default = "default_yandex_base_url")]
    yandex_music_base_url: String,
    #[serde(default = "default_yandex_client")]
    yandex_music_client: String,
    #[serde(default = "default_yandex_sign_key")]
    yandex_music_sign_key: String,
    trusted_proxies: Option<String>,
    #[serde(default = "default_library_scan_interval_minutes")]
    library_scan_interval_minutes: u64,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let env: Env = envy::from_env().context("Could not read the configuration from the environment")?;
        Self::from(env)
    }

    fn from(env: Env) -> anyhow::Result<Self> {
        let mut problems = Vec::new();

        let database_url = env.database_url.filter(|url| !url.trim().is_empty()).unwrap_or_else(|| {
            problems.push("DATABASE_URL is required, e.g. postgres://music:password@localhost:5432/music.".to_owned());
            String::new()
        });

        let signing_key = env.jwt_signing_key.unwrap_or_default();
        if signing_key.trim().is_empty() {
            problems.push("JWT_SIGNING_KEY is required. Generate one with: openssl rand -base64 48".to_owned());
        } else if signing_key.len() < 32 {
            problems.push(
                "JWT_SIGNING_KEY must be at least 32 bytes. Generate one with: openssl rand -base64 48".to_owned(),
            );
        }

        if env.jwt_access_token_minutes <= 0 {
            problems.push("JWT_ACCESS_TOKEN_MINUTES must be greater than zero.".to_owned());
        }
        if env.jwt_refresh_token_days <= 0 {
            problems.push("JWT_REFRESH_TOKEN_DAYS must be greater than zero.".to_owned());
        }
        if env.database_max_connections == 0 {
            problems.push("DATABASE_MAX_CONNECTIONS must be greater than zero.".to_owned());
        }

        let listen_addr = env.listen_addr.parse().unwrap_or_else(|_| {
            problems.push(format!("LISTEN_ADDR '{}' is not an address like 0.0.0.0:8080.", env.listen_addr));
            SocketAddr::from(([0, 0, 0, 0], 8080))
        });

        let trusted_proxies = match env.trusted_proxies.as_deref().map(str::trim) {
            None | Some("") => default_trusted_proxies(),
            Some(list) => list
                .split(',')
                .map(str::trim)
                .filter(|network| !network.is_empty())
                .filter_map(|network| match network.parse() {
                    Ok(net) => Some(net),
                    Err(_) => {
                        problems.push(format!("TRUSTED_PROXIES: '{network}' is not a CIDR network."));
                        None
                    }
                })
                .collect(),
        };

        for (name, value) in [
            ("LRCLIB_BASE_URL", &env.lrclib_base_url),
            ("DEEZER_BASE_URL", &env.deezer_base_url),
            ("YANDEX_MUSIC_BASE_URL", &env.yandex_music_base_url),
            ("YANDEX_MUSIC_CLIENT", &env.yandex_music_client),
            ("YANDEX_MUSIC_SIGN_KEY", &env.yandex_music_sign_key),
        ] {
            if value.trim().is_empty() {
                problems.push(format!("{name} must not be empty."));
            }
        }

        if !problems.is_empty() {
            bail!("Invalid configuration:\n  {}", problems.join("\n  "));
        }

        Ok(Self {
            app_env: env.app_env,
            listen_addr,
            database: DatabaseConfig { url: database_url, max_connections: env.database_max_connections },
            jwt: JwtConfig {
                signing_key,
                access_token_minutes: env.jwt_access_token_minutes,
                refresh_token_days: env.jwt_refresh_token_days,
            },
            storage_root: env.storage_root,
            owner: OwnerConfig {
                username: env.owner_username,
                password: env.owner_password.filter(|password| !password.trim().is_empty()),
                reset_password: env.owner_reset_password,
            },
            lrclib_base_url: env.lrclib_base_url,
            deezer_base_url: env.deezer_base_url,
            yandex_music: YandexMusicConfig {
                base_url: env.yandex_music_base_url,
                client: env.yandex_music_client,
                sign_key: env.yandex_music_sign_key,
            },
            trusted_proxies,
            library_scan_interval: (env.library_scan_interval_minutes > 0)
                .then(|| Duration::from_secs(env.library_scan_interval_minutes * 60)),
        })
    }

    pub fn is_development(&self) -> bool {
        self.app_env == AppEnv::Development
    }
}

fn default_app_env() -> AppEnv {
    AppEnv::Production
}

fn default_listen_addr() -> String {
    "0.0.0.0:8080".to_owned()
}

fn default_max_connections() -> u32 {
    40
}

fn default_access_token_minutes() -> i64 {
    10
}

fn default_refresh_token_days() -> i64 {
    30
}

fn default_storage_root() -> PathBuf {
    PathBuf::from("/storage")
}

fn default_owner_username() -> String {
    "admin".to_owned()
}

fn default_deezer_base_url() -> String {
    "https://api.deezer.com".to_owned()
}

fn default_lrclib_base_url() -> String {
    "https://lrclib.net".to_owned()
}

fn default_yandex_base_url() -> String {
    "https://api.music.yandex.net".to_owned()
}

fn default_yandex_client() -> String {
    "YandexMusicWebNext/1.0.0".to_owned()
}

fn default_yandex_sign_key() -> String {
    "7tvSmFbyf5hJnIHhCimDDD".to_owned()
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty())
}

fn default_library_scan_interval_minutes() -> u64 {
    60
}

fn default_trusted_proxies() -> Vec<IpNet> {
    ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
        .iter()
        .filter_map(|network| network.parse().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> anyhow::Result<Config> {
        let vars = pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned()));
        Config::from(envy::from_iter(vars)?)
    }

    const KEY: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn minimal_environment_gets_defaults() -> anyhow::Result<()> {
        let config = env(&[("DATABASE_URL", "postgres://localhost/music"), ("JWT_SIGNING_KEY", KEY)])?;

        assert_eq!(config.database.max_connections, 40);
        assert_eq!(config.app_env, AppEnv::Production);
        assert_eq!(config.trusted_proxies.len(), 5);
        assert_eq!(config.library_scan_interval, Some(Duration::from_secs(3600)));
        Ok(())
    }

    #[test]
    fn short_signing_key_is_rejected() {
        let result = env(&[("DATABASE_URL", "postgres://localhost/music"), ("JWT_SIGNING_KEY", "short")]);
        assert!(result.is_err());
    }

    #[test]
    fn trusted_proxies_are_parsed_from_list() -> anyhow::Result<()> {
        let config = env(&[
            ("DATABASE_URL", "postgres://localhost/music"),
            ("JWT_SIGNING_KEY", KEY),
            ("TRUSTED_PROXIES", "10.0.0.0/8, 127.0.0.1/32"),
        ])?;

        assert_eq!(config.trusted_proxies.len(), 2);
        Ok(())
    }
}
