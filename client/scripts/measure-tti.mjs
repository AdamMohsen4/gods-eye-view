/**
 * Time to first round interactive under a mid-range-phone-over-4G profile.
 * Usage: start the server (pnpm --filter ./server start:test), then
 *   pnpm --filter ./client build && pnpm --filter ./client preview &
 *   node client/scripts/measure-tti.mjs [baseUrl] [runs]
 * Profile: 9 Mbps down / 1.5 Mbps up, 150 ms RTT, 4× CPU slowdown, 390×844 @2x.
 * "Interactive" = round HUD visible, loading veil gone, globe tiles settled
 * (the client waits up to 4 s for tiles before lifting the veil).
 */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const runs = Number(process.argv[3] ?? 3);
const results = [];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));

  // Cold start from a share link: straight into round 1.
  const t0 = Date.now();
  await page.goto(`${base}/?ref=share&d=1`);
  await page.waitForSelector('.boot, [data-testid="round-hud"], .loading-veil', { timeout: 60_000 });
  const shell = Date.now() - t0;
  await page.waitForSelector('[data-testid="round-hud"]', { timeout: 120_000 });
  await page.waitForSelector('.loading-veil', { state: 'detached', timeout: 120_000 });
  const tti = Date.now() - t0;
  results.push({ shellMs: shell, firstRoundInteractiveMs: tti, transferredKB: Math.round(bytes / 1024) });
  await ctx.close();
}
await browser.close();
console.table(results);
const med = (k) => results.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
console.log(JSON.stringify({ medianShellMs: med('shellMs'), medianFirstRoundInteractiveMs: med('firstRoundInteractiveMs') }));
