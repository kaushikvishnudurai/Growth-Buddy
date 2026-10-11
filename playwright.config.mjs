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
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
});
