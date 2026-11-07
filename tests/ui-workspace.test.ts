import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { BRAND, DEFAULTS } from '../shared/config';
import type { Expense, Session } from '../shared/types';

// A finite browser test: its Vite server and browser are always closed.
// API routing is deliberate contract isolation, not a substitute for backend tests.
test('stage 1 workspace: auth, durable API entry, draft, duplicates, edit, history, filters and mobile', { timeout: 90000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let authenticated = false;
  const records: Expense[] = [];
  const queries: URL[] = [];
  const keys: string[] = [];
  const session = (): Session => ({ user: authenticated ? { id: 'user-1', name: 'Maya Patel', email: 'maya@example.test' } : null, today: '2026-11-01', settings: { ...DEFAULTS }, brand: BRAND, ai: { configured: false, provider: null } });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = request.postDataJSON();
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (method !== 'GET') assert.equal(request.headers()['x-ledger-request'], '1');
    if (path === '/api/session') return respond(session());
    if (path.startsWith('/api/reminders')) return respond({due:false,dueAt:Date.now()+7200000,now:Date.now(),intervalMinutes:120});
    if (path === '/api/purchases') return respond({records:[]});
    if (path === '/api/login' || path === '/api/register') { authenticated = true; return respond(session()); }
    if (path === '/api/logout') { authenticated = false; return respond({ ok: true }); }
    if (path.endsWith('/history')) return respond({ records: [{ at: '2026-11-01T10:00:00Z', action: 'updated', before: { ...records[0], description: 'Packing supplies' }, after: records[0] }] });
    if (path === '/api/expenses' && method === 'GET') {
      queries.push(url);
      const selected = url.searchParams.get('space') === 'demo' ? [] : records.filter(record => (!url.searchParams.get('q') || record.description.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase())) && (!url.searchParams.get('method') || url.searchParams.get('method') === record.method));
      return respond({ records: selected, count: selected.length, total: selected.length ? '1250.50' : '0.00' });
    }
    if (path === '/api/expenses' && method === 'POST') {
      keys.push(body.requestKey);
      assert.equal(typeof body.amount, 'string');
      if (records.length && !body.allowDuplicate) return respond({ error: 'This looks like an existing expense.', code: 'DUPLICATE', candidates: [records[0]] }, 409);
      const record: Expense = { ...body, id: `expense-${records.length + 1}`, version: 1, documentsCount: 0, purchaseId: null, taxRate: null };
      records.push(record);
      return respond(record, 201);
    }
    if (path.startsWith('/api/expenses/') && method === 'PUT') {
      const index = records.findIndex(record => record.id === path.split('/').at(-1));
      assert.equal(body.version, records[index].version);
      records[index] = { ...records[index], ...body, version: body.version + 1 };
      return respond(records[index]);
    }
    return respond({ error: `Unmocked ${method} ${path}` }, 404);
  });
  try {
    await page.goto(server.resolvedUrls!.local[0]);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 10000 });
    await page.getByLabel('Email address').fill('maya@example.test');
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();
    await expect(page.getByText('No expenses yet', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`${BRAND.name} · Expenses`);
    await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload bill / payment receipt' })).toBeVisible(); // Real upload navigation is covered by ui-documents.test.ts.
    await page.getByRole('button', { name: 'Manual entry' }).click();
    await page.getByLabel('Description', { exact: true }).fill('Packing supplies');
    await page.getByLabel('Amount', { exact: true }).fill('1250.50');
    await expect(page.getByLabel('Payment method', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Save expense', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    assert.equal(records.length, 0, 'No implicit payment method');
    await page.getByLabel('Payment method', { exact: true }).selectOption('UPI');
    await page.getByLabel('Additional information', { exact: true }).fill('Paper bags and packaging');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: 'Reminders', exact: true }).click();
    await page.getByRole('button', { name: 'Expenses', exact: true }).click();
    await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Packing supplies');
    await page.getByRole('button', { name: 'Save expense', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('cell', { name: /^Packing supplies Version/ })).toBeVisible();
    assert.equal(records[0].amount, '1250.50');
    await page.reload();
    await expect(page.getByRole('cell', { name: /^Packing supplies Version/ })).toBeVisible();
    await page.getByRole('button', { name: 'Edit Packing supplies' }).click();
    await page.getByLabel('Description', { exact: true }).fill('Packing supplies revised');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: 'History for Packing supplies revised' }).click();
    await expect(page.getByRole('heading', { name: 'Expense history' })).toBeVisible();
    await expect(page.getByText('Packing supplies', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close history' }).click();
    await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
    await page.getByRole('button', { name: 'Manual entry' }).click();
    await page.getByLabel('Description', { exact: true }).fill('Packing supplies revised');
    await page.getByLabel('Amount', { exact: true }).fill('1250.50');
    await page.getByLabel('Payment method', { exact: true }).selectOption('UPI');
    await page.getByRole('button', { name: 'Save expense', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Possible duplicate' })).toBeVisible();
    await page.getByRole('button', { name: 'Save as a separate expense' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    assert.equal(keys.at(-1), keys.at(-2), 'Explicit duplicate retry retains its idempotency key');
    await page.getByLabel('Search expenses').fill('not-found');
    await expect(page.getByText('No matching expenses', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByLabel('From date').fill('2026-11-01');
    await page.getByLabel('To date').fill('2026-11-30');
    await page.getByLabel('Filter payment method').selectOption('Card');
    await expect(page.getByText('No matching expenses', { exact: true })).toBeVisible();
    assert.ok(queries.some(url => url.searchParams.get('from') === '2026-11-01' && url.searchParams.get('to') === '2026-11-30' && url.searchParams.get('method') === 'Card'));
    await page.getByLabel('Workspace space').selectOption('demo');
    await expect(page.getByText('Fictional demo space', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.getByText('No demo expenses yet', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/ledgersprout-mobile.png', fullPage: true });
    const overflow = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })).slice(0, 12) }));
    assert.equal(overflow.scroll <= overflow.width, true, `Mobile shell must not overflow: ${JSON.stringify(overflow)}`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: '/tmp/ledgersprout-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A fresh start for your books' })).toBeVisible();
    await page.getByLabel('Your name').fill('Maya Patel');
    await page.getByLabel('Email address').fill('maya@example.test');
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-123');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
