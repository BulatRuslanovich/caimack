// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(3);

pub fn healthy() -> bool {
    let port = std::env::var("LISTEN_ADDR")
        .ok()
        .and_then(|addr| addr.parse::<SocketAddr>().ok())
        .map_or(8080, |addr| addr.port());
    let address = SocketAddr::from(([127, 0, 0, 1], port));

    let Ok(mut stream) = TcpStream::connect_timeout(&address, TIMEOUT) else { return false };
    if stream.set_read_timeout(Some(TIMEOUT)).is_err() || stream.set_write_timeout(Some(TIMEOUT)).is_err() {
        return false;
    }
    if stream.write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n").is_err() {
        return false;
    }
    let mut status = [0u8; 12];
    stream.read_exact(&mut status).is_ok() && status.starts_with(b"HTTP/1.") && &status[9..12] == b"200"
}
