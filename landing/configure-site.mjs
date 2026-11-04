// SPDX-License-Identifier: AGPL-3.0-only
// Set public metadata once the hosting URL is known. Does not publish the site.
import { readFile, writeFile } from "node:fs/promises";
const [flag, value, ...extra] = process.argv.slice(2);
if (flag !== "--origin" || !value || extra.length)
  throw new Error(
    "Usage: node landing/configure-site.mjs --origin https://your-domain.example/",
  );
const origin = new URL(value);
if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash
)
  throw new Error(
    "Provide an HTTP(S) site URL without credentials, query or fragment.",
  );
if (!origin.pathname.endsWith("/")) origin.pathname += "/";
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const path = new URL("./dist/index.html", import.meta.url);
let html = await readFile(path, "utf8");
const image = new URL("assets/social-card.png", origin).href;
html = html.replace(
  /<meta\b(?=[^>]*\bproperty="og:image")(?=[^>]*\bcontent=")[^>]*>/g,
  `<meta property="og:image" content="${escape(image)}">`,
);
html = html.replace(
  /<meta\b(?=[^>]*\bname="twitter:image")(?=[^>]*\bcontent=")[^>]*>/g,
  `<meta name="twitter:image" content="${escape(image)}">`,
);
html = html
  .replace(/\s*<link\b(?=[^>]*\brel="canonical")[^>]*>/g, "")
  .replace(/\s*<meta\b(?=[^>]*\bproperty="og:url")[^>]*>/g, "");
html = html.replace(
  "</head>",
  `<link rel="canonical" href="${escape(origin.href)}">\n<meta property="og:url" content="${escape(origin.href)}">\n</head>`,
);
html = html.replace(
  /(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g,
  (_, open, json, close) => {
    const data = JSON.parse(json);
    data.url = origin.href;
    return open + "\n" + JSON.stringify(data, null, 2) + "\n" + close;
  },
);
await writeFile(path, html);
await writeFile(
  new URL("./dist/robots.txt", import.meta.url),
  `User-agent: *\nAllow: /\nSitemap: ${new URL("sitemap.xml", origin).href}\n`,
);
await writeFile(
  new URL("./dist/sitemap.xml", import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(origin.href)}</loc></url></urlset>\n`,
);
console.log(
  `Public metadata configured for ${origin.href}. No deployment performed.`,
);
