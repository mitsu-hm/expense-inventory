import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture } from './helpers.js';
import { parseInvoiceText } from '../server/ai.js';

test('Free invoice analyzer correctly parses dates, amounts, payment methods and vendor information', () => {
 const sampleInvoiceText = `
METRO WHOLESALE CASH & CARRY
GSTIN: 27AABCM1234F1Z5
Invoice No: INV-2026-8849
Date: 2026-11-02
Payment Mode: UPI (GooglePay)
Transaction Ref: UPI-9876543210

Item Description        Qty    Price    Total
Organic Cow Milk 1L      4     45.00   180.00
Whole Wheat Bread 400g   2     35.00    70.00

SUBTOTAL: 250.00
TAX: 0.00
GRAND TOTAL: 250.00
 `;

 const parsed = parseInvoiceText(sampleInvoiceText, 'bill');
 assert.equal(parsed.paymentDate, '2026-11-02');
 assert.equal(parsed.amount, '250.00');
 assert.equal(parsed.method, 'UPI');
 assert.equal(parsed.transactionRef, 'INV-2026-8849');
 assert.equal(parsed.supplierName, 'METRO WHOLESALE CASH & CARRY');
 assert.ok(parsed.lines.length >= 1);
});

test('Document scan with provider: free works without any AI provider configured', async () => {
 const originalProvider = process.env.AI_PROVIDER;
 delete process.env.AI_PROVIDER;

 const { app, request } = await fixture();
 try {
  const image = await sharp({ create: { width: 45, height: 45, channels: 3, background: '#f0f0f0' } }).png().toBuffer();
  const docRes = await request('POST', '/api/documents', {
   name: 'free-test-bill.png',
   kind: 'bill',
   mimeType: 'image/png',
   base64: image.toString('base64')
  });
  assert.equal(docRes.statusCode, 201);
  const doc = docRes.json();

  // Scan specifically with provider: 'free'
  const scanRes = await request('POST', `/api/documents/${doc.id}/scan`, {
   version: doc.version,
   provider: 'free'
  });

  assert.equal(scanRes.statusCode, 200, scanRes.body);
  const scanned = scanRes.json();
  assert.equal(scanned.processing, 'extracted');
  assert.ok(scanned.draft);

  await app.close();
 } finally {
  if (originalProvider !== undefined) process.env.AI_PROVIDER = originalProvider;
  else delete process.env.AI_PROVIDER;
 }
});

