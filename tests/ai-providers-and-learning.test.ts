import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { fixture } from './helpers.js';

test('Gemini and OpenAI provider formats, auto-matching, and learning from confirmed feedback', async () => {
 const names = ['AI_PROVIDER', 'AI_MODEL', 'AI_BASE_URL', 'AI_API_KEY'];
 const original = Object.fromEntries(names.map(k => [k, process.env[k]]));

 let receivedSystemPrompt = '';
 let receivedUserContents: any = null;

 // Mock AI server that handles both OpenAI and Gemini formats
 const server = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = text ? JSON.parse(text) : {};

  if (req.url?.includes(':generateContent')) {
   // Gemini endpoint
   receivedSystemPrompt = body.systemInstruction?.parts?.[0]?.text ?? '';
   receivedUserContents = body.contents;
   res.setHeader('Content-Type', 'application/json');
   res.end(JSON.stringify({
    candidates: [{
     content: {
      parts: [{
       text: JSON.stringify({
        paymentDate: '2026-11-02',
        orderedDate: null,
        description: 'Green Valley Farms Organic Produce',
        amount: '249.50',
        method: 'UPI',
        additionalInformation: 'Weekly inventory delivery',
        transactionRef: 'UPI-REF-998877',
        supplierName: 'Green Valley Farms',
        lines: [{
         description: 'Organic Milk 1L',
         productType: 'Dairy',
         brand: 'Green Valley',
         flavour: null,
         packSize: '1L',
         unit: 'bottle',
         quantity: '5',
         unitPrice: '49.90',
         taxRate: null,
         evidence: '5 bottles @ 49.90'
        }],
        warnings: []
       })
      }]
     }
    }]
   }));
   return;
  }

  if (req.url?.includes('/chat/completions')) {
   // OpenAI endpoint
   receivedSystemPrompt = body.messages?.[0]?.content ?? '';
   res.setHeader('Content-Type', 'application/json');
   res.end(JSON.stringify({
    choices: [{
     message: {
      content: JSON.stringify({
       paymentDate: '2026-11-02',
       orderedDate: null,
       description: 'OpenAI Test Merchant',
       amount: '100.00',
       method: 'Card',
       additionalInformation: '',
       transactionRef: 'CARD-1234',
       supplierName: null,
       lines: [],
       warnings: []
      })
     }
    }]
   }));
   return;
  }

  res.writeHead(404);
  res.end('Not found');
 });

 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 const addr = server.address();
 assert.ok(addr && typeof addr !== 'string');

 try {
  // 1. Test Gemini Provider & Auto-matching of Supplier and Product
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_MODEL = 'gemini-2.0-flash';
  process.env.AI_BASE_URL = `http://127.0.0.1:${addr.port}`;
  process.env.AI_API_KEY = 'test-gemini-key';

  const { app, request } = await fixture();

  // Create existing supplier and product in database
  const supplierRes = await request('POST', '/api/suppliers', {
   name: 'Green Valley Farms',
   contactName: 'Alice',
   email: 'alice@greenvalley.test',
   address: 'Farm Rd',
   paymentTerms: 'Net 30'
  });
  assert.equal(supplierRes.statusCode, 201);
  const supplier = supplierRes.json();

  const productRes = await request('POST', '/api/products', {
   name: 'Organic Milk 1L',
   productType: 'Dairy',
   brand: 'Green Valley',
   flavour: '',
   packSize: '1L',
   unit: 'bottle',
   supplierId: supplier.id,
   unitPrice: '49.90'
  });
  assert.equal(productRes.statusCode, 201);
  const product = productRes.json();

  // Upload an image and scan with Gemini
  const image = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#a0c0e0' } }).png().toBuffer();
  const doc = (await request('POST', '/api/documents', {
   name: 'green-valley-bill.png',
   kind: 'bill',
   mimeType: 'image/png',
   base64: image.toString('base64')
  })).json();

  const scanRes = await request('POST', `/api/documents/${doc.id}/scan`, { version: doc.version });
  assert.equal(scanRes.statusCode, 200, scanRes.body);
  const scanned = scanRes.json();

  // Verify extracted fields
  assert.equal(scanned.draft.paymentDate, '2026-11-02');
  assert.equal(scanned.draft.amount, '249.50');
  assert.equal(scanned.draft.method, 'UPI');
  // Verify auto-matching
  assert.equal(scanned.draft.supplierId, supplier.id, 'Supplier should be auto-matched');
  assert.equal(scanned.draft.lines[0].productId, product.id, 'Product line should be auto-matched');

  // Verify learning / feedback recording:
  // Confirm document with a user correction (e.g. adjust description)
  const patched = (await request('PATCH', `/api/documents/${doc.id}`, {
   version: scanned.version,
   draft: { ...scanned.draft, description: 'Green Valley Farms - Corrected Name' }
  })).json();

  const confirmRes = await request('POST', `/api/documents/${doc.id}/confirm`, {
   version: patched.version,
   reviewed: true,
   acknowledgeWarnings: true,
   target: 'expense',
   requestKey: 'req-confirm-feedback-test'
  });
  assert.equal(confirmRes.statusCode, 200, confirmRes.body);

  // Now scan a SECOND document to verify the feedback is injected as few-shot training into the prompt!
  const image2 = await sharp({ create: { width: 51, height: 51, channels: 3, background: '#b0d0f0' } }).png().toBuffer();
  const doc2 = (await request('POST', '/api/documents', {
   name: 'second-bill.png',
   kind: 'bill',
   mimeType: 'image/png',
   base64: image2.toString('base64')
  })).json();

  const scan2Res = await request('POST', `/api/documents/${doc2.id}/scan`, { version: doc2.version });
  assert.equal(scan2Res.statusCode, 200, scan2Res.body);

  assert.ok(receivedSystemPrompt.includes('Learn from these past extractions'), 'System prompt must include few-shot examples');
  assert.ok(receivedSystemPrompt.includes('Green Valley Farms - Corrected Name'), 'User correction must be present in prompt training');

  // 2. Test OpenAI Provider
  process.env.AI_PROVIDER = 'openai';
  process.env.AI_MODEL = 'gpt-4o';
  process.env.AI_BASE_URL = `http://127.0.0.1:${addr.port}`;
  process.env.AI_API_KEY = 'test-openai-key';

  const image3 = await sharp({ create: { width: 52, height: 52, channels: 3, background: '#c0e0d0' } }).png().toBuffer();
  const doc3 = (await request('POST', '/api/documents', {
   name: 'openai-bill.png',
   kind: 'bill',
   mimeType: 'image/png',
   base64: image3.toString('base64')
  })).json();

  const scan3 = await request('POST', `/api/documents/${doc3.id}/scan`, { version: doc3.version });
  assert.equal(scan3.statusCode, 200, scan3.body);
  assert.equal(scan3.json().draft.description, 'OpenAI Test Merchant');
  assert.equal(scan3.json().draft.method, 'Card');

  await app.close();
 } finally {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  for (const name of names) {
   if (original[name] === undefined) delete process.env[name];
   else process.env[name] = original[name];
  }
 }
});
