import { defineConfig, devices } from '@playwright/test';

// Own ports, so a run never reuses (or writes test games into) a `pnpm dev` server
// and its persistent .data database. The test server is in-memory and seeded fresh.
const API_PORT = 8797;
const WEB_PORT = 5183;
const reuse = !process.env.CI;

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/pw',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: `MAP_STYLE=offline PORT=${API_PORT} pnpm --filter ./server start:test`,
      cwd: '..',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: reuse,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      command: `EARTHNOW_API=http://127.0.0.1:${API_PORT} pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
  ],
});
