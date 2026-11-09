// Per-round "round shown → all imagery tiles loaded" on a throttled phone profile
// (9 Mbps, 150 ms RTT, 4x CPU). Needs the server and an esri-imagery client running:
//   pnpm --filter ./server start:test & VITE_IMAGERY=esri pnpm --filter ./client dev
//   node client/scripts/measure-tiles.mjs
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const base = process.env.BASE_URL ?? 'http://localhost:5173';
await page.goto(base + '/');
await page.getByTestId('play-daily').click();
for (let i = 0; i < 5; i++) {
  await page.getByTestId('round-hud').waitFor({ timeout: 90000 });
  const t = await page.waitForFunction(() => {
    const s = performance.getEntriesByName('round-shown').at(-1); const e = performance.getEntriesByName('tiles-settled').at(-1);
    return s && e && e.startTime > s.startTime ? Math.round(e.startTime - s.startTime) : false;
  }, null, { timeout: 60000, polling: 250 }).then((h) => h.jsonValue()).catch(() => 'timeout');
  const type = await page.locator('.type-badge svg').getAttribute('aria-label');
  console.log(type, 'tiles settled after', t, 'ms');
  await page.waitForTimeout(9000); // a player looks around before guessing
  await page.locator('.sheet-toggle').click(); await page.waitForTimeout(400);
  const map = page.getByTestId('guess-map'); const box = await map.boundingBox();
  await map.tap({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByTestId('confirm').click(); await page.getByTestId('reveal').waitFor(); await page.getByTestId('next').click();
}
await browser.close();
