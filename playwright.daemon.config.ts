import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Config for the daemon's own API + dashboard tests (tests/daemon-*.spec.ts and
// tests/dashboard.spec.ts). Separate from playwright.config.ts, which holds generated
// specs for external sites. Run with:
//   pnpm --filter @trace2e/daemon build && playwright test -c playwright.daemon.config.ts

const PORT = 8790;
const HOME = mkdtempSync(join(tmpdir(), "trace2e-test-"));

export default defineConfig({
  testDir: "./tests",
  testMatch: ["daemon-api.spec.ts", "dashboard.spec.ts"],
  fullyParallel: false, // specs share one daemon + one store
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: "node daemon/dist/cli.js serve",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    env: {
      TRACE2E_HOME: HOME,
      TRACE2E_PORT: String(PORT),
      TRACE2E_TOKEN: "test-legacy-token",
      TRACE2E_ADMIN_PASSWORD: "admin-pass-123",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
