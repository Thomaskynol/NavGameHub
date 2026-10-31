import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT ?? '4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 768 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Build + servidor de produção com hooks de teste habilitados (somente ambiente de teste).
    command: 'npm run build && node scripts/e2e-server.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { PORT: PORT, HOST: '127.0.0.1', CATAN_TEST_HOOKS: '1' },
  },
});
