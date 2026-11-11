import { expect, test, type Browser, type Page } from '@playwright/test';

async function pin(page: Page, fx = 0.5, fy = 0.4) {
  const mobile = (page.viewportSize()?.width ?? 1000) < 820;
  if (mobile) await page.getByTestId('open-map').click();
  const map = page.getByTestId('guess-map');
  await expect(map.locator('canvas')).toBeVisible();
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test('classic game: five rounds to a summary', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('play-world').click();
  await expect(page).toHaveURL(/\/game\//);
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('.pano[data-status="ready"]')).toBeVisible();
    await pin(page);
    await page.getByTestId('guess-button').click();
    await expect(page.getByTestId('result-map')).toBeVisible();
    await expect(page.locator('.reveal-card')).toContainText(i === 0 ? 'Round 1 of 5' : `Round ${i + 1} of 5`);
    await page.getByTestId('next-button').click();
  }
  await expect(page.locator('.summary-card')).toContainText('/ 25,000');
  await expect(page.locator('.round-list li')).toHaveCount(5);
});

test('daily: plays and opens the leaderboard', async ({ page }) => {
  await page.goto('/daily');
  await page.getByTestId('play-challenge').click();
  for (let i = 0; i < 5; i++) {
    await pin(page, 0.3 + i * 0.1, 0.4);
    await page.getByTestId('guess-button').click();
    await page.getByTestId('next-button').click();
  }
  await expect(page.locator('.summary-card')).toContainText('Daily #');
  await expect(page.locator('.board-list li').first()).toBeVisible();
});

test('party: two players finish a 3-round game', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'multiplayer runs once');
  const open = async (b: Browser) => (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const host = await open(browser);
  const guest = await open(browser);
  await host.goto('/party');
  await expect(host).toHaveURL(/\/party\/[A-Z0-9]{5}$/);
  await guest.goto(host.url());
  await expect(host.locator('.players li')).toHaveCount(2);
  await host.getByRole('radio', { name: '3', exact: true }).click();
  await host.getByTestId('start-party').click();
  for (let i = 0; i < 3; i++) {
    for (const p of [host, guest]) {
      await expect(p.locator('.pano[data-status="ready"]')).toBeVisible({ timeout: 30_000 });
      await pin(p, 0.4 + Math.random() * 0.2, 0.4);
      await p.getByTestId('guess-button').click();
    }
    await expect(host.locator('.round-table, .final-list').first()).toBeVisible();
  }
  await expect(host.getByText(/You won|wins|A draw/)).toBeVisible({ timeout: 20_000 });
  await expect(guest.getByText(/You won|wins|A draw/)).toBeVisible();
});
