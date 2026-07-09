import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const API_PORT = Number(process.env.API_PORT ?? 3001);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;

// Boot api + web from the workspace root so they pick up the same .env that
// `npm run dev` would. CI sets envs via the workflow itself; locally Vite +
// NestJS read from the repo `.env`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: './test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    // API runs as a production-style build (`nest build && node dist/main`)
    // because `nest start --watch` races its own emit on first run and
    // intermittently boots before main.js exists.
    {
      command: 'npm run start:e2e --workspace=@airmed/api',
      cwd: REPO_ROOT,
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev:web',
      cwd: REPO_ROOT,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
