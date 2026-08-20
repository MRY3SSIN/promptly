import { defineConfig, devices } from '@playwright/test';

/**
 * Adapter and anchoring tests run against saved DOM fixtures served over
 * http, not against the live sites. Live sites need an authenticated session
 * and change without warning; a fixture makes the test deterministic and
 * makes selector rot show up as a diff rather than as a flake.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  // The soak test genuinely runs for a minute.
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5599',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    },
  },
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: 'http://127.0.0.1:5599/fixtures/claude.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
