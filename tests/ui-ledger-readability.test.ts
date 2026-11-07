import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, expect, type Page } from '@playwright/test';
import { BRAND, DEFAULTS } from '../shared/config';

// Contract-isolated UI tests: never read or write the user's workspace records.
async function withLedger(run: (page: Page) => Promise<void>) {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      const data = path === '/api/session'
        ? { user: { id: 'readability-test', name: 'UI test', email: 'ui@example.test' }, today: '2026-11-02', settings: { ...DEFAULTS }, brand: BRAND, ai: { configured: false, provider: null } }
        : path.startsWith('/api/reminders')
          ? { due: false, dueAt: Date.now() + 7200000, now: Date.now(), intervalMinutes: 120 }
          : { records: [], count: 0, total: '0.00' };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(server.resolvedUrls!.local[0]);
    await expect(page.getByRole('heading', { name: 'No expenses yet', exact: true })).toBeVisible();
    await run(page);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function assertWithinPanel(page: Page) {
  const panel = await page.getByRole('region', { name: 'Expense ledger', exact: true }).boundingBox();
  const empty = await page.locator('.ledger-empty').boundingBox();
  assert.ok(panel && empty);
  assert.ok(empty.x >= panel.x && empty.x + empty.width <= panel.x + panel.width + 1,
    `Empty state must fit the visible ledger panel: ${JSON.stringify({ panel, empty })}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

test('expense text and controls stay readable on mobile and desktop', { timeout: 60000 }, async () => {
  await withLedger(async page => {
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const selector of ['.page-heading .muted', '.page-heading .button', '.ledger-empty p', '.ledger-empty .button']) {
        const size = await page.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        assert.ok(size >= 14, `${selector} must be at least 14px at ${width}px (was ${size})`);
      }
      for (const selector of ['.summary-label', '.summary-strip .field-hint', '.date-filters label:not(.sr-only)', '.table-footer', '.ledger-footnote']) {
        const sizes = await page.locator(selector).evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).fontSize)));
        assert.ok(sizes.every(size => size >= 12), `${selector} must be at least 12px at ${width}px`);
      }
      for (const label of ['Search expenses', 'From date', 'To date', 'Filter payment method']) {
        const control = page.getByLabel(label, { exact: true });
        const size = await control.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        assert.ok(size >= 16, `${label} must be at least 16px`);
        const box = await control.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height >= 44, `${label} must fit and be at least 44px tall`);
      }
      await assertWithinPanel(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    await page.getByRole('button', { name: 'Manual entry' }).click();
    for (const label of ['Payment date', 'Amount', 'Description', 'Payment method']) {
      const size = await page.getByLabel(label, { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(size >= 16, `${label} in the expense form must be at least 16px`);
    }
    await page.keyboard.press('Escape');
  });
});

test('empty and filtered ledger states fit the panel without horizontal scrolling', { timeout: 60000 }, async () => {
  await withLedger(async page => {
    for (const width of [320, 390, 540, 541, 768, 800, 801, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await assertWithinPanel(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Add your first expense' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('Search expenses').fill('not found');
    await expect(page.getByRole('heading', { name: 'No matching expenses' })).toBeVisible();
    await assertWithinPanel(page);
    await page.getByRole('button', { name: 'Reset selection' }).click();
    await expect(page.getByLabel('Search expenses')).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'No expenses yet' })).toBeVisible();
  });
});
