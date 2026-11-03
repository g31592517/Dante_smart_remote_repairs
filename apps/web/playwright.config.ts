import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running stack:
 *   API   : npm run db:reset -w @dante/api && npm run dev -w @dante/api      (demo data, port 4000)
 *   Web   : npm run build -w @dante/web && npm run preview -w @dante/web     (port 4173, proxies /api)
 * The API's CORS_ORIGINS must include the web origin (e.g. http://127.0.0.1:4173).
 * Set PW_CHROMIUM_PATH to use a pre-installed Chromium instead of Playwright's download.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } },
  ],
});
