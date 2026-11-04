// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::Response;
use ipnet::IpNet;

#[derive(Debug, Clone, Copy)]
pub struct ClientInfo {
    pub ip: Option<IpAddr>,
    pub https: bool,
}

pub async fn resolve(State(trusted): State<Arc<Vec<IpNet>>>, mut request: Request, next: Next) -> Response {
    let peer = request.extensions().get::<ConnectInfo<SocketAddr>>().map(|ConnectInfo(addr)| addr.ip());

    let client = client_info(peer, request.headers(), &trusted);
    request.extensions_mut().insert(client);
    next.run(request).await
}

fn client_info(peer: Option<IpAddr>, headers: &HeaderMap, trusted: &[IpNet]) -> ClientInfo {
    let from_proxy = peer.is_some_and(|ip| trusted.iter().any(|net| net.contains(&ip)));
    if !from_proxy {
        return ClientInfo { ip: peer, https: false };
    }

    let forwarded_ip = last_value(headers, "x-forwarded-for").and_then(|value| value.parse().ok());
    let https = last_value(headers, "x-forwarded-proto").is_some_and(|proto| proto.eq_ignore_ascii_case("https"));

    ClientInfo { ip: forwarded_ip.or(peer), https }
}

fn last_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(name)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .rfind(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn private() -> Vec<IpNet> {
        vec!["172.16.0.0/12".parse().unwrap()]
    }

    fn forwarded(for_: &str, proto: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_str(for_).unwrap());
        headers.insert("x-forwarded-proto", HeaderValue::from_str(proto).unwrap());
        headers
    }

    #[test]
    fn trusted_proxy_forwards_the_nearest_client() {
        let peer = "172.18.0.5".parse().ok();
        let client = client_info(peer, &forwarded("1.1.1.1, 203.0.113.7", "https"), &private());

        assert_eq!((client.ip, client.https), ("203.0.113.7".parse().ok(), true));
    }

    #[test]
    fn untrusted_peer_cannot_spoof_headers() {
        let peer = "198.51.100.1".parse().ok();
        let client = client_info(peer, &forwarded("203.0.113.7", "https"), &private());

        assert_eq!((client.ip, client.https), (peer, false));
    }
}
