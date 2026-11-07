import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { BRAND, DEFAULTS } from '../shared/config';
import type { Product, Purchase, Session, Supplier } from '../shared/types';

// Finite, isolated component browser test. Routed API fixtures exercise the
// frontend contract; real persistence belongs to the separate backend tests.
async function setup(view: 'inventory' | 'suppliers') {
  const session: Session = { user: { id: 'u', name: 'Maya', email: 'maya@example.test' }, settings: { ...DEFAULTS }, today: '2026-11-01', brand: BRAND, ai: { configured: false, provider: null } };
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {${view === 'inventory' ? 'Inventory' : 'Suppliers'}} from '/src/${view === 'inventory' ? 'Inventory' : 'Suppliers'}.tsx'; import '/src/styles.css'; const session=${JSON.stringify(session)}; window.payments=[]; createRoot(document.getElementById('root')).render(React.createElement(${view === 'inventory' ? 'Inventory' : 'Suppliers'}, {space:new URL(location.href).searchParams.get('space')||'real',session,onRecordPayment:p=>window.payments.push(p)}));`;
  const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{ name: 'inventory-component-harness', resolveId(id) { if (id === '/__inventory-entry.js') return id; }, load(id) { if (id === '/__inventory-entry.js') return entry; }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith('/__ui-inventory')) return next(); res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="main-content" id="root"></main><script type="module" src="/__inventory-entry.js"></script></body></html>')); }); } }] });
  await server.listen();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return { page, errors, url: `${server.resolvedUrls!.local[0]}__ui-inventory`, close: async () => { await browser.close(); await server.close(); } };
}

const supplier: Supplier = { id: 's1', name: 'Green Grove', contactName: 'Riya', email: 'riya@example.test', address: 'Pune', paymentTerms: 'Net 30', version: 1, productCount: 1 };
const product: Product = { id: 'p1', name: 'Oat drink', productType: 'Beverage', brand: 'Grove', flavour: 'Vanilla', packSize: '250', unit: 'ml', supplierId: 's1', supplierName: supplier.name, quantity: '0', orderedQuantity: '0', unitPrice: '12.123456', totalCost: '0.00' };

test('inventory product creation stays stock-free; purchase and receipt are deliberate, decimal and retry-safe', { timeout: 60000 }, async () => {
  const app = await setup('inventory');
  const { page } = app;
  const products: Product[] = [];
  const purchases: Purchase[] = [];
  const writes: { path: string; body: any }[] = [];
  const receiptKeys: string[] = [];
  let failOrder = true;
  let failReceive = true;
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const body = req.postDataJSON();
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    assert.equal(url.searchParams.get('space'), 'real');
    if (method !== 'GET') { assert.equal(req.headers()['x-ledger-request'], '1'); writes.push({ path, body }); }
    if (path === '/api/inventory') return respond({ products, purchases });
    if (path === '/api/suppliers') return respond({ records: [supplier] });
    if (path === '/api/products' && method === 'POST') { products.push({ ...product, ...body }); return respond(products[0], 201); }
    if (path === '/api/purchases' && method === 'POST') {
      if (failOrder) { failOrder = false; return respond({ error: 'Duplicate purchase reference. Review before retrying.', code: 'DUPLICATE' }, 409); }
      purchases.push({ id: 'po1', supplierId: 's1', supplierName: supplier.name, orderedDate: body.orderedDate, reference: body.reference, status: 'ordered', lines: body.lines.map((line: any, i: number) => ({ ...line, id: `l${i}`, productName: product.name, receivedQuantity: '0', packSize: '250', unit: 'ml', lineCost: '30.31', receivedCost: '0.00' })), totalCost: '30.31', paidTotal: '0.00', expenseIds: [] });
      products[0].orderedQuantity = '2.5'; return respond(purchases[0], 201);
    }
    if (path === '/api/purchases/po1/receive') {
      receiptKeys.push(body.requestKey);
      if (failReceive) { failReceive = false; return respond({ error: 'Receipt could not be confirmed. Retry safely.' }, 503); }
      assert.deepEqual(body.lines, [{ lineId: 'l0', quantity: '1.25' }]);
      products[0] = { ...products[0], quantity: '1.25', orderedQuantity: '1.25', totalCost: '15.15' };
      purchases[0] = { ...purchases[0], status: 'partial', lines: purchases[0].lines.map(line => ({ ...line, receivedQuantity: '1.25', receivedCost: '15.15' })) };
      return respond(purchases[0]);
    }
    return respond({ error: `Unexpected ${method} ${path}` }, 404);
  });
  try {
    await page.goto(app.url);
    await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
    await expect(page.getByText('No products yet', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add product', exact: true }).first().click();
    await page.getByLabel('Product name', { exact: true }).fill(product.name);
    await page.getByLabel('Product type', { exact: true }).fill(product.productType);
    await page.getByLabel('Brand', { exact: true }).fill(product.brand);
    await page.getByLabel('Flavour', { exact: true }).fill(product.flavour);
    await page.getByLabel('Pack size', { exact: true }).fill(product.packSize);
    await page.getByLabel('Unit', { exact: true }).fill(product.unit);
    await page.getByLabel('Product supplier', { exact: true }).selectOption('s1');
    await page.getByLabel('Initial unit price', { exact: true }).fill(product.unitPrice);
    await page.getByRole('button', { name: 'Save product', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    assert.equal(writes.length, 1, 'Product creation must not order, receive or pay');
    await expect(page.getByRole('columnheader', { name: 'Received stock', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Outstanding order quantity', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Historical-cost total', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Latest unit price', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New purchase order', exact: true }).click();
    await page.getByLabel('Order supplier', { exact: true }).selectOption('s1');
    await page.getByLabel('Ordered date', { exact: true }).fill('2026-11-01');
    await page.getByLabel('Order reference', { exact: true }).fill('PO-17');
    await page.getByLabel('Product for line 1', { exact: true }).selectOption('p1');
    await page.getByLabel('Quantity for line 1', { exact: true }).fill('2.5');
    await page.getByLabel('Unit price for line 1', { exact: true }).fill('12.123456');
    await page.getByLabel('Tax rate for line 1', { exact: true }).fill('18');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Duplicate purchase reference');
    await expect(page.getByLabel('Tax rate for line 1', { exact: true })).toHaveValue('18');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const orders = writes.filter(write => write.path === '/api/purchases');
    assert.equal(orders[0].body.requestKey, orders[1].body.requestKey);
    assert.deepEqual(orders[1].body.lines, [{ productId: 'p1', quantity: '2.5', unitPrice: '12.123456', taxRate: '18' }]);
    assert.equal(products[0].quantity, '0');
    assert.equal(purchases[0].paidTotal, '0.00');
    await expect(page.getByText('Ordered', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    await page.getByLabel('Receive now for Oat drink', { exact: true }).fill('1.25');
    assert.equal(receiptKeys.length, 0, 'Typing is not receipt confirmation');
    await page.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Retry safely');
    await expect(page.getByLabel('Receive now for Oat drink', { exact: true })).toHaveValue('1.25');
    await page.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    assert.equal(receiptKeys[0], receiptKeys[1]);
    await expect(page.getByText('Partially received', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Products and stock table' }).getByRole('cell', { name: '₹15.15', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Record payment', exact: true }).click();
    assert.equal(await page.evaluate(() => (window as any).payments.length), 1);
    assert.equal(writes.some(write => write.path.includes('expenses')), false);
    await expect(page.getByText(/External inventory app integration is pending/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('suppliers save controlled fields, review version conflicts and show linked products in the selected space', { timeout: 60000 }, async () => {
  const app = await setup('suppliers');
  const { page } = app;
  const records: Supplier[] = [];
  const writes: any[] = [];
  let conflict = true;
  let firstLoad = true;
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    assert.equal(url.searchParams.get('space'), 'demo');
    if (url.pathname === '/api/products') return respond({ records: [{ ...product, id: 'other-product', supplierId: 'other' }, product] });
    if (url.pathname === '/api/suppliers' && method === 'GET') {
      if (firstLoad) { firstLoad = false; return respond({ error: 'Suppliers are temporarily unavailable.' }, 503); }
      return respond({ records });
    }
    assert.equal(req.headers()['x-ledger-request'], '1');
    const body = req.postDataJSON(); writes.push({ method, ...body });
    if (url.pathname === '/api/suppliers' && method === 'POST') { records.push({ ...supplier, ...body }); return respond(records[0], 201); }
    if (url.pathname === '/api/suppliers/s1' && method === 'PUT') {
      if (conflict) { conflict = false; records[0] = { ...records[0], version: 2, paymentTerms: 'Net 45' }; return respond({ error: 'Supplier changed. Review the latest version.', code: 'STALE' }, 409); }
      assert.equal(body.version, 2); records[0] = { ...records[0], ...body, version: 3 }; return respond(records[0]);
    }
    return respond({ error: 'Unexpected supplier route' }, 404);
  });
  try {
    await page.goto(`${app.url}?space=demo`);
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('No suppliers yet', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add supplier', exact: true }).first().click();
    await page.getByLabel('Supplier name', { exact: true }).fill(supplier.name);
    await page.getByLabel('Contact name', { exact: true }).fill(supplier.contactName);
    await page.getByLabel('Email', { exact: true }).fill(supplier.email);
    await page.getByLabel('Address', { exact: true }).fill(supplier.address);
    await page.getByLabel('Payment terms', { exact: true }).fill(supplier.paymentTerms);
    await page.getByRole('button', { name: 'Save supplier', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('cell', { name: /^Green Grove Version/ })).toBeVisible();
    await page.getByRole('button', { name: 'View products for Green Grove', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Products from Green Grove' })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Oat drink', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('1 linked product', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Green Grove', exact: true }).click();
    await page.getByLabel('Contact name', { exact: true }).fill('Riya Shah');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Supplier changed');
    await expect(page.getByLabel('Contact name', { exact: true })).toHaveValue('Riya Shah');
    await expect(page.getByRole('dialog').getByText('Net 45', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use latest version, keep my entries', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    assert.deepEqual(writes.map(write => write.version), [undefined, 1, 2]);
    await expect(page.getByRole('cell', { name: 'Riya Shah', exact: true })).toBeVisible();
    await expect(page.getByText('Version 3', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
