import { defineConfig } from "vitest/config";
import { generateIntegrations } from "./scripts/generate-integrations.mjs";

generateIntegrations();

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
