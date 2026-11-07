import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, expect, type Page } from '@playwright/test';
import { BRAND, DEFAULTS } from '../shared/config';
import type { Session, Supplier } from '../shared/types';

// Real App in Chromium; routed fixtures isolate UI contracts, not persistence.
async function withWorkspace(run: (page: Page, state: { suppliers: Supplier[]; gets: string[]; writes: string[] }) => Promise<void>) {
  const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = { suppliers: [] as Supplier[], gets: [] as string[], writes: [] as string[] };
  const session: Session = { user: { id: 'repairs', name: 'Workspace fixture', email: 'repairs@example.test' }, settings: { ...DEFAULTS }, today: '2026-11-01', brand: BRAND, ai: { configured: false, provider: null } };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const respond = (data: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'GET') state.gets.push(`${path}?${url.searchParams}`);
    else if (!path.startsWith('/api/reminders')) state.writes.push(path);
    if (path === '/api/session') return respond(session);
    if (path.startsWith('/api/reminders')) return respond({ due: false, dueAt: Date.now() + 86400000, now: Date.now(), intervalMinutes: 120 });
    if (path === '/api/inventory') return respond({ products: [], purchases: [] });
    if (path === '/api/suppliers') {
      if (request.method() === 'POST') {
        const supplier = { ...request.postDataJSON(), id: 'new-supplier', version: 1, productCount: 0 } as Supplier;
        state.suppliers.push(supplier);
        return respond(supplier);
      }
      return respond({ records: state.suppliers });
    }
    if (path === '/api/expenses') return respond({ records: [], count: 0, total: '0.00' });
    if (path === '/api/documents' || path === '/api/products' || path === '/api/purchases') return respond({ records: [] });
    return respond({});
  });
  try {
    await page.goto(server.resolvedUrls!.local[0]);
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();
    await run(page, state);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
}

const navigate = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
const main = (page: Page) => page.locator('main#main-content');

test('supplier-first onboarding offers direct navigation and refreshes preserved product drafts after explicit supplier creation', { timeout: 45000 }, async () => {
  await withWorkspace(async (page, state) => {
    await navigate(page, 'Inventory');
    await main(page).getByRole('button', { name: 'Add your first supplier', exact: true }).click();
    await expect(page).toHaveURL(/\/suppliers$/);
    assert.deepEqual(state.writes, []);
    await navigate(page, 'Inventory');
    await main(page).getByRole('button', { name: 'Add product', exact: true }).first().click();
    await page.getByLabel('Product name', { exact: true }).fill('Keep through onboarding');
    await page.getByRole('button', { name: 'Go to Suppliers', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await main(page).getByRole('button', { name: 'Add supplier', exact: true }).first().click();
    await page.getByLabel('Supplier name', { exact: true }).fill('Explicit new supplier');
    await page.getByRole('button', { name: 'Save supplier', exact: true }).click();
    await expect(page.getByRole('cell', { name: /^Explicit new supplier Version/ })).toBeVisible();
    await navigate(page, 'Inventory');
    await main(page).getByRole('button', { name: 'Add product', exact: true }).first().click();
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Keep through onboarding');
    await page.getByLabel('Product supplier', { exact: true }).selectOption('new-supplier');
    assert.deepEqual(state.writes, ['/api/suppliers'], 'Navigation and draft entry never create business records');
  });
});

for (const section of ['Inventory', 'Suppliers']) {
  test(`global refresh refetches ${section} and expenses without discarding drafts`, { timeout: 30000 }, async () => {
    await withWorkspace(async (page, state) => {
      await navigate(page, section);
      const isInventory = section === 'Inventory';
      const action = isInventory ? 'Add product' : 'Add supplier';
      const label = isInventory ? 'Product name' : 'Supplier name';
      const endpoint = isInventory ? '/api/inventory?' : '/api/suppliers?';
      await main(page).getByRole('button', { name: action, exact: true }).first().click();
      await page.getByLabel(label, { exact: true }).fill('Keep after refresh');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      const before = state.gets.filter(path => path.startsWith(endpoint)).length;
      const expenseBefore = state.gets.filter(path => path.startsWith('/api/expenses?')).length;
      await page.evaluate(() => { (window as any).refreshEvents = 0; window.addEventListener('ledger-refresh', () => (window as any).refreshEvents++); });
      await page.getByRole('button', { name: 'Reload workspace', exact: true }).click();
      await expect.poll(() => state.gets.filter(path => path.startsWith(endpoint)).length).toBeGreaterThan(before);
      await expect.poll(() => state.gets.filter(path => path.startsWith('/api/expenses?')).length).toBeGreaterThan(expenseBefore);
      assert.equal(await page.evaluate(() => (window as any).refreshEvents), 1);
      await main(page).getByRole('button', { name: action, exact: true }).first().click();
      await expect(page.getByLabel(label, { exact: true })).toHaveValue('Keep after refresh');
      assert.deepEqual(state.writes, []);
    });
  });
}

test('same-section navigation restores destination focus on desktop and mobile', { timeout: 30000 }, async () => {
  await withWorkspace(async page => {
    await navigate(page, 'Inventory');
    await navigate(page, 'Inventory');
    await expect(main(page)).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await navigate(page, 'Inventory');
    await expect(main(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
  });
});

test('visited sections retain product and supplier drafts across navigation and history, but not workspace switches', { timeout: 60000 }, async () => {
  await withWorkspace(async page => {
    await navigate(page, 'Inventory');
    await main(page).getByRole('button', { name: 'Add product', exact: true }).first().click();
    await page.getByLabel('Product name', { exact: true }).fill('Unsaved oat drink');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await navigate(page, 'Suppliers');
    await main(page).getByRole('button', { name: 'Add supplier', exact: true }).first().click();
    await page.getByLabel('Supplier name', { exact: true }).fill('Unsaved grove');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goBack();
    await main(page).getByRole('button', { name: 'Add product', exact: true }).first().click();
    await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Unsaved oat drink');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await main(page).getByRole('button', { name: 'Add supplier', exact: true }).first().click();
    await expect(page.getByLabel('Supplier name', { exact: true })).toHaveValue('Unsaved grove');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Workspace space', { exact: true }).selectOption('demo');
    await main(page).getByRole('button', { name: 'Add supplier', exact: true }).first().click();
    await expect(page.getByLabel('Supplier name', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Workspace space', { exact: true }).selectOption('real');
    await main(page).getByRole('button', { name: 'Add supplier', exact: true }).first().click();
    await expect(page.getByLabel('Supplier name', { exact: true })).toHaveValue('');
  });
});