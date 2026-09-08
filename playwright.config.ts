// Decision notes: e2e runs against the production build served by vite preview so the
// service worker and manifest are the real artefacts. Pixel 5 is the closest CI stand-in
// for the target Android handset.
import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    ...devices['Pixel 5'],
  },
  projects: [{ name: 'android-chromium', use: { ...devices['Pixel 5'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
