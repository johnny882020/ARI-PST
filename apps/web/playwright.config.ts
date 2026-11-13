import { defineConfig, devices } from "@playwright/test";

// e2e runs against the production build served by the in-repo mock API (mock-server/server.mjs).
const PORT = 4300;
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node mock-server/server.mjs`,
    env: { PORT: String(PORT), SERVE_DIST: "1" },
    url: `http://localhost:${PORT}/api/v1/readyz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
