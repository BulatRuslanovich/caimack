# Optional local HTTP

**Allow HTTP on the local network** is available in connection settings on the
sign-in screen and in **Settings → Account**. It is off by default and saved only
on this device. Ordinary addresses without a scheme use HTTPS.

When enabled, HTTP is allowed only to the selected server, whose host must be a
private, loopback or link-local IP literal, or `localhost`. Public IP addresses
and public DNS names are rejected before connection. The actual connected IP is
checked again before HTTP bytes are sent, including after redirects.

TLS certificate and hostname verification are unchanged. HTTPS does not silently
fall back to HTTP, including through redirects. The separate update client always
requires HTTPS and does not receive the music server cookies.

Android allows the underlying cleartext capability so the setting can take effect
without reinstalling the app. Application and network interceptors enforce the
opt-in and local destination restriction for music API calls, audio, downloads
and images. Turning the setting off cancels active music-server requests when that
server uses HTTP; retained downloads remain available.

No build parameter or HTTP allowlist is required. Use HTTPS for public servers.
