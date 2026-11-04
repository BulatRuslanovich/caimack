# Caimack landing page

A standalone English product page built around the real Caimack interface. OLED black,
warm white type, muted gold and album artwork carry the visual identity. Onest handles
body text; Unbounded handles headings; the existing handwritten wordmark closes the page.

The landing stays separate because the application's `/` route is an authenticated home.
It does not change frontend routes, sessions, themes, the PWA, the backend or the API.
This version is local only and has not been published.

## Local preview

From the repository root:

```bash
node landing/preview.mjs
```

Open <http://127.0.0.1:4173>. Stop with Ctrl+C. Set `PORT` if 4173 is already in use.
Node.js is the only preview requirement. There is no package installation or build step.
You can also open `landing/dist/index.html` directly; the content and interactions work
without a server. Clipboard access depends on browser permissions and has a fallback.

## Page and interactions

- Product hero: a real player, mobile web overlay, subtle vinyl, Get Started and GitHub.
- Library map: overview and close-up views, plus a link to the live application.
- Listening: personal radio, daily mix, synced lyrics and queue in keyboard-accessible tabs.
- Collection: artist and album views, search, and expandable listening history.
- Web and Android: mobile web screenshot with Android offline and Android Auto described separately.
- Self-hosting: Library → Caimack Server → Devices and the actual README setup commands.
- FAQ, closing demo link, documentation, releases and AGPL license links.

All twelve product screenshots open in a native dialog. Use the previous/next buttons or
arrow keys to browse, Escape to close, and 100% to inspect the original image. Enlarged
images can be scrolled on mobile. Closing restores the previous focus and scroll position.

OLED / Coffee changes the landing palette. It does not recolour screenshots; their captions
identify the actual application theme. The header includes a motion toggle, with both
controls inside the navigation menu on small screens. The selected colour theme persists
locally; motion follows the system preference unless overridden for the current visit.

## Motion and accessibility

Native Web Animations, CSS and an event-driven requestAnimationFrame loop handle the
coordinated hero entrance, vinyl rotation, pointer depth, subtle parallax and footer reveal.
There is no animation library, scroll hijacking, pinned story or CDN. Effects stop when
disabled; the record pauses offscreen and when the page is hidden.

The page respects `prefers-reduced-motion`, including changes while it is open. Content
remains readable with motion off and without JavaScript; a static listening gallery is
available as a fallback. Navigation, tabs, copy actions and the screenshot dialog have
keyboard controls, visible focus states and screen-reader labels.

## Files

| File                      | Responsibility                                                      |
| ------------------------- | ------------------------------------------------------------------- |
| `dist/index.html`         | Semantic content, metadata, SVG icons and no-JavaScript fallback    |
| `dist/styles.css`         | Layout, typography, OLED / Coffee palettes and responsive rules     |
| `dist/core.js`            | Shared browser helpers, motion preferences and announcements        |
| `dist/showcase.js`        | Screenshot registry, view switches, tabs and image dialog           |
| `dist/app.js`             | Navigation, theme, demo details and clipboard actions               |
| `dist/motion.js`          | Entrance, scroll, pointer and vinyl effects                         |
| `dist/assets/`            | Local brand assets, fonts, optimized screenshots and social preview |
| `preview.mjs`             | Local static HTTP server                                            |
| `configure-site.mjs`      | Public metadata configuration for a future hosting URL              |
| `screenshot-sources.json` | Production capture routes, themes and date                          |

Scripts are deferred classic scripts, in dependency order, to support direct file opening.
Screenshots have explicit dimensions; below-the-fold images load lazily. Fonts and all
visual assets are local. The page makes no external asset requests.

## Before publishing

Serve the contents of `dist/` as a static site. Once its actual public URL is known, run:

```bash
node landing/configure-site.mjs --origin https://your-domain.example/
```

Replace the example with the real landing URL; a path such as `/caimack/` is supported.
The script sets the canonical URL, Open Graph URL, absolute Open Graph / Twitter image
URLs and structured-data URL, then writes `robots.txt` and `sitemap.xml`. It is safe to
run again. It changes local files and does not deploy anything.

The 1200 × 630 social preview is `dist/assets/social-card.png`. A canonical URL is
intentionally unset until hosting is chosen. Social crawlers require the final public
image URL. When serving under a subpath, expose `robots.txt` at the host root if needed.

## Validation and limits

Checked in Chromium / Microsoft Edge at 320, 360, 390, 650, 768, 900, 1024, 1280, 1440
and 1920 px: no horizontal overflow or clipped headings. Browser checks cover the menus,
saved theme, screenshot switches, twelve-slide dialog, mobile image panning, keyboard
navigation, clipboard, reduced motion, no-JavaScript fallback and direct file opening.
Metadata configuration is checked for repeatability. No failed requests or browser errors
were observed. Local performance measurements are development checks, not field Core
Web Vitals or a cross-browser certification. Safari and physical Android devices still
need a release check on the eventual host.

Screenshots show the production web client, including its responsive player. A native
Android screenshot is not substituted with a mockup. Demo availability and external
GitHub / documentation links depend on their respective services.

Original landing code is AGPL-3.0-only. Bundled fonts keep their own licenses; album
artwork retains its owners' rights. See [THIRD_PARTY.md](THIRD_PARTY.md).
