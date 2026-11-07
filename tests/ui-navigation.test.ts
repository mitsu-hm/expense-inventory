import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { buildApp } from '../server/app';

// Real production routes and API, with an isolated in-memory database.
async function withWorkspace(run: (page: Page, base: string) => Promise<void>) {
  await build({ logLevel: 'error' });
  const app = await buildApp({ dbPath: ':memory:' });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const previousOrigins = process.env.LOCAL_ORIGINS;
  process.env.LOCAL_ORIGINS = base;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const signup = await page.request.post(`${base}/api/register`, {
      headers: { 'x-ledger-request': '1' },
      data: { name: 'Navigation fixture', email: 'navigation@example.test', password: 'NavigationFixture42!' },
    });
    assert.equal(signup.status(), 201);
    await run(page, base);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    if (previousOrigins === undefined) delete process.env.LOCAL_ORIGINS;
    else process.env.LOCAL_ORIGINS = previousOrigins;
  }
}

test('section URLs support direct loads, reload, history, mobile navigation and missing pages', { timeout: 90000 }, async () => {
  await withWorkspace(async (page, base) => {
    for (const section of ['Inventory', 'Suppliers', 'Reports', 'Documents', 'Reminders', 'Expenses']) {
      await page.goto(`${base}/${section.toLowerCase()}`);
      await expect(page.getByRole('heading', { level: 1, name: section === 'Reports' ? 'Expense reports' : section, exact: true })).toBeVisible();
      await expect(page.getByRole('navigation').getByRole('button', { name: section, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page).toHaveTitle(`LedgerSprout · ${section}`);
    }
    await page.getByRole('button', { name: 'Inventory', exact: true }).click();
    await expect(page).toHaveURL(`${base}/inventory`);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Suppliers', exact: true }).click();
    await page.getByRole('button', { name: 'Suppliers', exact: true }).click();
    await page.goBack();
    await expect(page).toHaveURL(`${base}/inventory`);
    await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'Suppliers', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Reminders', exact: true }).click();
    await expect(page).toHaveURL(`${base}/reminders`);
    await expect(page.getByRole('main')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Back to expenses' }).click();
    await expect(page).toHaveURL(`${base}/expenses`);
    await page.goto(`${base}/not-a-section`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to expenses' }).click();
    await expect(page).toHaveURL(`${base}/expenses`);
    await page.goto(base);
    await expect(page).toHaveURL(`${base}/expenses`);
  });
});
