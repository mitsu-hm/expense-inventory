import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { buildApp } from '../server/app';

// Opt-in real-model smoke check. Never reads or writes the business database.
if (existsSync('.env')) process.loadEnvFile('.env');
assert.equal(process.env.AI_PROVIDER, 'ollama', 'Configure Ollama before running this check');
assert.equal(process.env.AI_LOCAL_ONLY, '1', 'This verification must use local-only mode');
const base = process.env.AI_BASE_URL || 'http://127.0.0.1:11434';
const model = process.env.AI_MODEL;
const tags = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
assert.ok(tags.ok, 'Ollama must be reachable');
const installed = await tags.json() as { models: { name: string }[] };
assert.ok(installed.models.some(item => item.name === model), `Install ${model} in Ollama first`);
await mkdir('artifacts/local-ai', { recursive: true });
const app = await buildApp({ dbPath: ':memory:' });
const evidence: Record<string, unknown> = { model, base, fixtures: [], reviewFindings: [], passed: false };
try {
  const registration = await app.inject({ method: 'POST', url: '/api/register', headers: { 'x-ledger-request': '1' }, payload: { name: 'Synthetic AI Check', email: 'ai-check@example.test', password: 'Synthetic-AI-Check42!' } });
  assert.equal(registration.statusCode, 201);
  const cookies = registration.headers['set-cookie'];
  const headers = { 'x-ledger-request': '1', cookie: (Array.isArray(cookies) ? cookies[0] : cookies!).split(';')[0] };
  const fixtures = [
    { name: 'paid-receipt', kind: 'payment_receipt', lines: ['FICTIONAL TEST RECEIPT', 'Merchant: Cedar Test Store', 'Paid on: 2026-11-07', 'Amount paid: INR 1250.00', 'Paid via: UPI', 'Payment reference: TEST-UPI-123456', 'Synthetic verification image - not a real payment.'] },
    { name: 'unpaid-bill', kind: 'bill', lines: ['FICTIONAL UNPAID INVOICE', 'Merchant: Cedar Test Store', 'Invoice date: 2026-11-07', 'Grand total: INR 118.00', 'Payment status: UNPAID', 'We accept UPI, Visa and cash.', 'No payment date or payment method is recorded.', 'Synthetic verification image - not a real bill.'] },
  ];
  for (const fixture of fixtures) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="660"><rect width="1000" height="660" fill="white"/>${fixture.lines.map((line, index) => `<text x="40" y="${65 + index * 65}" font-family="sans-serif" font-size="28" fill="black">${line}</text>`).join('')}</svg>`;
    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    await writeFile(`artifacts/local-ai/${fixture.name}.png`, image);
    const uploaded = await app.inject({ method: 'POST', url: '/api/documents?space=real', headers, payload: { name: `${fixture.name}.png`, kind: fixture.kind, mimeType: 'image/png', base64: image.toString('base64') } });
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const document = uploaded.json();
    const started = performance.now();
    const response = await app.inject({ method: 'POST', url: `/api/documents/${document.id}/scan?space=real`, headers, payload: { version: document.version } });
    const elapsedMs = Math.round(performance.now() - started);
    assert.equal(response.statusCode, 200, response.body);
    const record = response.json();
    (evidence.fixtures as unknown[]).push({ name: fixture.name, elapsedMs, draft: record.draft, status: record.status, warnings: record.warnings });
    assert.equal(record.status, 'draft');
    assert.equal(record.processing, 'extracted');
    assert.equal(record.draft.amount, fixture.name === 'paid-receipt' ? '1250.00' : '118.00');
    assert.equal(record.draft.method, fixture.name === 'paid-receipt' ? 'UPI' : null);
    assert.equal(record.draft.paymentDate, fixture.name === 'paid-receipt' ? '2026-11-07' : null);
    if (fixture.name === 'paid-receipt') {
      assert.equal(record.draft.transactionRef, 'TEST-UPI-123456');
      assert.equal(record.draft.lines.length, 0, 'A payment-only receipt has no purchased goods lines');
    } else {
      if (record.draft.transactionRef) (evidence.reviewFindings as string[]).push('Unpaid sample: model supplied a reference although no reference field was present. Human correction is required.');
      if (record.draft.lines.length) (evidence.reviewFindings as string[]).push('Unpaid sample: model supplied item lines although no purchased items were listed. Human correction is required.');
    }
    const saved = await app.inject({ method: 'GET', url: `/api/documents/${document.id}?space=real`, headers });
    assert.equal(saved.json().draft.amount, record.draft.amount, 'Read back the exact saved draft');
  }
  const expenses = (await app.inject({ method: 'GET', url: '/api/expenses?space=real', headers })).json();
  assert.equal(expenses.count, 0, 'AI scans must never post a payment automatically');
  const inventory = (await app.inject({ method: 'GET', url: '/api/inventory?space=real', headers })).json();
  assert.equal(inventory.products.length, 0);
  assert.equal(inventory.purchases.length, 0);
  evidence.automaticPayments = expenses.count;
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await app.close();
  await writeFile('artifacts/local-ai/verification.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
