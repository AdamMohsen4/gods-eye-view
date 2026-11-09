import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: 'pnpm --filter ./server start:test',
      cwd: '..',
      url: 'http://127.0.0.1:8787/api/attributions',
      reuseExistingServer: reuse,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      command: 'VITE_IMAGERY=offline pnpm exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
  ],
});
