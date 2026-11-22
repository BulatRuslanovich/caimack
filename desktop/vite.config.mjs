// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateIntegrations } from "../frontend/scripts/generate-integrations.mjs";

generateIntegrations();

const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const outDir = fileURLToPath(new URL("renderer/", import.meta.url));
const { version } = JSON.parse(
  readFileSync(new URL("../frontend/package.json", import.meta.url)),
);

export default {
  root: frontend,
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": frontend + "src",
      "next/navigation": frontend + "src/desktop/navigation.ts",
      "next/link": frontend + "src/desktop/Link.tsx",
      "next/dynamic": frontend + "src/desktop/dynamic.tsx",
      "next/image": frontend + "src/desktop/Image.tsx",
    },
  },
  define: {
    "process.env.APP_VERSION": JSON.stringify(version),
    "process.env.APP_SOURCE_URL": JSON.stringify(
      process.env.CAIMACK_SOURCE_URL ?? "https://github.com/MX-Goliath/caimack",
    ),
    "process.env.NEXT_PUBLIC_CAIMACK_DESKTOP": JSON.stringify("1"),
  },
  build: {
    target: "chrome130",
    outDir,
    emptyOutDir: true,
    rolldownOptions: {
      input: frontend + "desktop.html",
      onwarn(warning, show) {
        if (
          warning.code !== "MODULE_LEVEL_DIRECTIVE" &&
          warning.code !== "INEFFECTIVE_DYNAMIC_IMPORT"
        )
          show(warning);
      },
    },
    reportCompressedSize: false,
  },
};
