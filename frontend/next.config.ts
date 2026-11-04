// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:5199";
const proxyApiInDev = process.env.NEXT_DISABLE_API_PROXY !== "1";
const sourceUrl = new URL(
  process.env.CAIMACK_SOURCE_URL || "https://github.com/BulatRuslanovich/caimack",
);
if (!["http:", "https:"].includes(sourceUrl.protocol)) {
  throw new Error("CAIMACK_SOURCE_URL must be an HTTP(S) URL to this build's source code.");
}

function resolveVersion(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

    if (pkg && typeof pkg === "object" && "version" in pkg && typeof pkg.version === "string") {
      return pkg.version;
    }
  } catch {}

  return "0.0.0";
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local"],
  typedRoutes: true,

  agentRules: false,

  devIndicators: { position: "top-right" },

  logging: {
    browserToTerminal: true,
  },

  env: {
    APP_VERSION: resolveVersion(),
    APP_SOURCE_URL: sourceUrl.href,
  },

  typescript: { ignoreBuildErrors: true },

  experimental: {
    proxyClientMaxBodySize: "1gb",

    inlineCss: true,

    useTypeScriptCli: false,

    optimizePackageImports: ["lucide-react", "@dnd-kit/core", "@dnd-kit/sortable"],

    staleTimes: {
      dynamic: 60,
      static: 300,
    },

    requestInsights: true,

    webVitalsAttribution: ["LCP", "INP", "CLS"],
  },

  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },

  async rewrites() {
    if (process.env.NODE_ENV === "production" || !proxyApiInDev) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
