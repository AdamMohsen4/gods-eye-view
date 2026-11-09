import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'test-results/screenshots';
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, info: TestInfo, name: string) {
  await page.waitForTimeout(450); // let the page fade-in finish
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` });
}

async function placePin(page: Page, fx = 0.55, fy = 0.45) {
  const toggle = page.locator('.sheet-toggle');
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.waitForTimeout(400); // sheet height transition
  }
  const map = page.getByTestId('guess-map');
  await expect(map.locator('svg path.gm-land')).toHaveAttribute('d', /M/);
  const box = (await map.boundingBox())!;
  const position = { x: box.width * fx, y: box.height * fy };
  if (test.info().project.name === 'mobile') await map.tap({ position });
  else await page.mouse.click(box.x + position.x, box.y + position.y);
  await expect(page.getByTestId('confirm')).toBeEnabled();
}

test('plays a full Daily Earth and shares the result', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByTestId('daily-card')).toBeVisible();
  await shot(page, info, 'home');
  await page.getByTestId('play-daily').click();

  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId('round-hud')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.loading-veil')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('timer')).toHaveText(/^\d:\d\d$/);
    const type = await page.locator('.type-badge svg').getAttribute('aria-label');
    await page.waitForTimeout(1500);
    await shot(page, info, `round-${i + 1}-${type}`);
    if (i === 0) {
      await page.getByTestId('clue-btn').click();
      await expect(page.getByTestId('clue')).toHaveCount(1);
    }
    await placePin(page, 0.3 + i * 0.1, 0.4);
    if (i === 0) await shot(page, info, 'guess-map');
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('reveal')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('attribution')).toContainText(/\w/);
    await expect(page.getByTestId('score')).toHaveText(/^[\d,]+$/);
    if (i === 0) {
      await page.waitForTimeout(800);
      await shot(page, info, 'reveal');
    }
    await page.getByTestId('next').click();
  }

  await expect(page.getByTestId('results')).toBeVisible();
  const share = await page.getByTestId('share-text').innerText();
  const lines = share.trim().split('\n');
  expect(lines[0]).toMatch(/^Earthnow #\d+ · [\d,]+ 🌍$/);
  expect(lines.slice(1, 6)).toHaveLength(5);
  for (const l of lines.slice(1, 6)) expect(l).toMatch(/^(✈️|🛰️|🔥|🌋) (🟩|🟨|🟥)$/u);
  expect(lines[6]).toMatch(/\/share\/\d+\/[\w-]+$/);
  await shot(page, info, 'results');

  // Home now shows the finished Daily.
  await page.goto('/');
  await expect(page.getByTestId('see-results')).toBeVisible();
});

test('plays one Live Arcade round', async ({ page }, info) => {
  await page.goto('/');
  await page.getByTestId('arcade-card').getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('round-hud')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('timer')).toHaveCount(0);
  await placePin(page);
  await page.getByTestId('confirm').click();
  await expect(page.getByTestId('reveal')).toBeVisible({ timeout: 30_000 });
  await shot(page, info, 'arcade-reveal');
});

test('share link opens the Daily directly', async ({ page }) => {
  await page.goto('/?ref=share&d=1');
  await expect(page.getByTestId('round-hud')).toBeVisible({ timeout: 60_000 });
});

test('about page lists data attributions and the MIT notice', async ({ page }, info) => {
  await page.goto('/#/about');
  const list = page.getByTestId('attributions');
  await expect(list.locator('li a').first()).toBeVisible();
  await expect(page.getByTestId('about')).toContainText('Bilawal Sidhu');
  await expect(page.getByTestId('about')).toContainText('CC BY 4.0');
  await shot(page, info, 'about');
});

test('leaderboard renders', async ({ page }, info) => {
  await page.goto('/#/leaderboard');
  await expect(page.getByTestId('leaderboard')).toBeVisible();
  await expect(page.locator('[data-lb] .empty, [data-lb] table')).toBeVisible();
  await shot(page, info, 'leaderboard');
});

test('the 3D view can be dragged and zoomed during a round', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'mouse drag; touch is handled by Cesium natively');
  await page.goto('/');
  await page.getByTestId('arcade-card').getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('round-hud')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.loading-veil')).toHaveCount(0, { timeout: 30_000 });
  // The overlay must let pointer events through to the 3D view (regression: it swallowed them).
  for (const [x, y] of [[400, 400], [200, 300], [640, 200]]) {
    expect(await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.tagName, [x, y])).toBe('CANVAS');
  }
  // And Cesium's camera actually moves when dragged.
  const height = () => page.evaluate(() => Number(document.body.dataset.cameraHeight));
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(600, 380, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const h0 = await height();
  expect(Number.isFinite(h0)).toBe(true);
  for (let k = 0; k < 5; k++) await page.mouse.wheel(0, -400);
  await page.waitForTimeout(800);
  expect(await height()).not.toBe(h0);
});
