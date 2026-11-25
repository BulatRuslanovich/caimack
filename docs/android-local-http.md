[Documentation](README.md#listen-on-your-devices)

# Optional local HTTP

Use local HTTP when your Caimack server exposes a separate HTTP endpoint on
your home network. Addresses entered without a scheme use HTTPS.

## Connect to a local HTTP endpoint

1. Open the connection settings on the sign-in screen or in **Settings → Account**.
2. Turn on **Allow HTTP on the local network**. The setting is off by default
   and is saved on this device.
3. Enter the full server address, including `http://`, the local IP, and the
   listening port.

The default Caddy configuration serves the configured HTTPS hostname and can
redirect a plain HTTP request. Use an explicitly configured HTTP endpoint
for a local IP, or use your usual hostname with
[local DNS](android-library-sync.md#a-public-domain-on-the-home-wi-fi).

## Connection checks

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

On Android 17 and later, reaching a local server also requires Android's local
network permission. The app requests it at startup when it has not already
been granted. Review the permission in Android's app settings. The Caimack
switch controls HTTP separately and blocks it immediately when turned off.
