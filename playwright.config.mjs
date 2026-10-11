// End-to-end suite. Needs a running stack (backend + Vite) and GB_BACKEND_LOG pointing at the
// backend's log, where the seeder reads sign-up codes. See e2e/README.md.
import { defineConfig, devices } from '@playwright/test';

const base = process.env.GB_E2E_BASE || 'http://localhost:5591';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.GB_E2E_WORKERS ? Number(process.env.GB_E2E_WORKERS) : 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: { baseURL: base, screenshot: 'on', trace: 'retain-on-failure' },
  // `engine` picks how the fixtures get a browser (e2e/fixtures.mjs): chrome attaches over CDP,
  // firefox/webkit connect to the servers e2e/servers.sh starts. The default run stays on the two
  // Chrome projects; GB_E2E_ALL=1 adds the rest.
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, engine: 'chrome' } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], engine: 'chrome' } },
    ...(process.env.GB_E2E_ALL
      ? [
          { name: 'tablet-chrome', use: { ...devices['iPad (gen 7)'], defaultBrowserType: 'chromium', engine: 'chrome' } },
          { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 }, engine: 'firefox' } },
          { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 }, engine: 'webkit' } },
          { name: 'mobile-webkit', use: { ...devices['iPhone 14'], engine: 'webkit' } },
        ]
      : []),
  ],
});
