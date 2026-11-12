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

test('play again starts a fresh, playable game', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'flow is viewport independent');
  await page.goto('/');
  await page.getByTestId('play-world').click();
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('.pano[data-status="ready"]')).toBeVisible();
    await pin(page);
    await page.getByTestId('guess-button').click();
    await page.getByTestId('next-button').click();
  }
  const first = page.url();
  await page.getByRole('button', { name: 'Play again' }).click();
  await expect(page).not.toHaveURL(first);
  await expect(page.locator('.pano[data-status="ready"]')).toBeVisible();
  // The old pin is gone and a new guess goes through.
  await expect(page.getByTestId('guess-button')).toHaveText(/Place your pin/);
  await pin(page);
  await page.getByTestId('guess-button').click();
  await expect(page.locator('.reveal-card')).toContainText('Round 1 of 5');
});

test('keyboard only: drop a pin with Enter and lock in with Space', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard flow');
  await page.goto('/');
  await page.getByTestId('play-world').click();
  await expect(page.locator('.pano[data-status="ready"]')).toBeVisible();
  const canvas = page.getByTestId('guess-map').locator('canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('guess-button')).toHaveText('Guess');
  await page.locator('body').focus();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect(page.locator('.reveal-card')).toContainText('Round 1 of 5');
});

test('party: leaving one room and opening another lands in the new room', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'multiplayer runs once');
  await page.goto('/party');
  await expect(page).toHaveURL(/\/party\/[A-Z0-9]{5}$/);
  const first = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: /party/i }).first().click();
  await expect(page).toHaveURL(/\/party\/[A-Z0-9]{5}$/);
  const second = page.url().split('/').pop()!;
  expect(second).not.toBe(first);
  await expect(page.locator('h1 .code')).toHaveText(second);
  // Still there a moment later (no bounce back to the old room).
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(new RegExp(`/party/${second}$`));
});

test('elimination party: rounds run until one player is left standing', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'multiplayer runs once');
  const open = async (b: Browser) => (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const host = await open(browser);
  const guest = await open(browser);
  await host.goto('/party');
  await expect(host).toHaveURL(/\/party\/[A-Z0-9]{5}$/);
  await guest.goto(host.url());
  await expect(host.locator('.players li')).toHaveCount(2);
  await host.getByRole('radio', { name: /Elimination/ }).click();
  await expect(guest.getByRole('radio', { name: /Elimination/ })).toHaveAttribute('aria-checked', 'true');
  await host.getByTestId('start-party').click();
  // Two players, three lives each: at most a handful of rounds (ties cost nobody a life).
  for (let i = 0; i < 12; i++) {
    if (await host.getByText(/last one standing|A draw/).isVisible()) break;
    for (const [p, x] of [
      [host, 0.5],
      [guest, 0.05],
    ] as const) {
      await expect(p.locator('.pano[data-status="ready"]')).toBeVisible({ timeout: 30_000 });
      await pin(p, x, 0.45);
      await p.getByTestId('guess-button').click();
    }
    await expect(host.locator('.round-table, .final-list').first()).toBeVisible();
    await expect(host.locator('.pano[data-status="ready"], .final-list').first()).toBeVisible({ timeout: 20_000 });
  }
  await expect(host.getByText(/last one standing|A draw/)).toBeVisible({ timeout: 20_000 });
  await expect(host.locator('.final-list .hearts').first()).toBeVisible();
});

test('friends: add by code, accept, and invite to a party', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'multiplayer runs once');
  const open = async (b: Browser) => (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const a = await open(browser);
  const b = await open(browser);
  await b.goto('/profile');
  const codeB = (await b.locator('.friend-code strong').textContent())!.trim();
  await a.goto('/profile');
  await a.getByPlaceholder('A friend’s code').fill(codeB);
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(a.getByText('Waiting for an answer')).toBeVisible();
  await b.reload();
  await b.getByRole('button', { name: 'Accept' }).click();
  await expect(b.getByText('are friends now')).toBeVisible();
  // b waits on the maps page; a opens a party and invites b.
  await b.goto('/maps');
  await a.goto('/party');
  await expect(a).toHaveURL(/\/party\/[A-Z0-9]{5}$/);
  await a.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(a.locator('.invite-friends .tag-ok')).toBeVisible();
  await expect(b.locator('.toast')).toContainText('invited you to a party');
  await b.locator('.toast').getByRole('button', { name: 'Join' }).click();
  await expect(b).toHaveURL(a.url());
  await expect(a.locator('.players li').filter({ hasNotText: 'Invite' })).toHaveCount(2);
});

test('phone: the tab bar steps aside during a live match', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout only');
  await page.goto('/party');
  await expect(page).toHaveURL(/\/party\/[A-Z0-9]{5}$/);
  await expect(page.locator('.tabbar')).toBeVisible();
  await page.getByRole('radio', { name: '3', exact: true }).click();
  await page.getByTestId('start-party').click();
  await expect(page.locator('.pano[data-status="ready"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.tabbar')).toBeHidden();
  await pin(page, 0.5, 0.4);
  await page.getByTestId('guess-button').click();
  await expect(page.locator('.round-table').first()).toBeVisible();
});
