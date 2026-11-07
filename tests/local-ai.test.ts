import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImage, aiStatus } from '../server/ai';
import { Store } from '../server/store';

const names = ['AI_PROVIDER', 'AI_MODEL', 'AI_BASE_URL', 'AI_API_KEY', 'AI_LOCAL_ONLY', 'AI_TIMEOUT_MS'];

test('Ollama extraction uses a bounded context and a configurable cold-start timeout', async () => {
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const store = new Store(':memory:');
  const durations: number[] = [];
  let payload: any;
  try {
    process.env.AI_PROVIDER = 'ollama';
    process.env.AI_MODEL = 'qwen3-vl:4b';
    process.env.AI_BASE_URL = 'http://127.0.0.1:11434';
    process.env.AI_TIMEOUT_MS = '300000';
    AbortSignal.timeout = milliseconds => { durations.push(milliseconds); return originalTimeout(milliseconds); };
    globalThis.fetch = async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ message: { content: JSON.stringify({ paymentDate: null, orderedDate: null, description: null, amount: null, method: null, additionalInformation: '', transactionRef: null, supplierName: null, lines: [], warnings: [] }) } });
    };
    await extractImage(Buffer.from('synthetic'), 'bill', 'image/png', store, 'fixture', 'real');
    assert.deepEqual(durations, [300000]);
    assert.equal(payload.options.num_ctx, 8192);
    assert.equal(payload.options.num_predict, 4096);
    assert.equal(payload.think, false);
    assert.equal(payload.options.temperature, 0);
    assert.equal(payload.stream, false);
    assert.equal(payload.format.type, 'object');
    process.env.AI_TIMEOUT_MS = '-1';
    await extractImage(Buffer.from('synthetic'), 'bill', 'image/png', store, 'fixture', 'real');
    assert.equal(durations[1], 180000, 'Invalid timeout falls back to the bounded local default');
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    store.close();
    for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
  }
});

test('receipt extraction excludes payment metadata from purchased item lines', async () => {
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const store = new Store(':memory:');
  let prompt = '';
  try {
    process.env.AI_PROVIDER = 'ollama';
    process.env.AI_MODEL = 'qwen3-vl:4b-instruct';
    process.env.AI_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      prompt = payload.messages.map((message: { content: string }) => message.content).join('\n');
      return Response.json({ message: { content: JSON.stringify({ paymentDate: null, orderedDate: null, description: null, amount: null, method: null, additionalInformation: '', transactionRef: null, supplierName: null, lines: [], warnings: [] }) } });
    };
    await extractImage(Buffer.from('synthetic'), 'payment_receipt', 'image/png', store, 'fixture', 'real');
    assert.match(prompt, /lines must be empty/i);
    assert.match(prompt, /only purchased goods or services/i);
    assert.match(prompt, /accepted payment methods do not establish/i);
    assert.match(prompt, /HSN\/SAC codes are never quantities/i);
    assert.match(prompt, /tax percentages are not unit prices/i);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
    for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
  }
});

test('local-only AI refuses external providers even when explicitly requested', async () => {
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const store = new Store(':memory:');
  let calls = 0;
  try {
    process.env.AI_LOCAL_ONLY = '1';
    process.env.AI_PROVIDER = 'ollama';
    process.env.AI_MODEL = 'qwen3-vl:4b';
    process.env.AI_BASE_URL = 'http://127.0.0.1:11434';
    globalThis.fetch = async () => { calls++; throw new Error('No provider request should occur'); };
    await assert.rejects(extractImage(Buffer.from('synthetic'), 'bill', 'image/png', store, 'fixture', 'real', 'free'), /local-only/i);
    assert.equal(calls, 0, 'An explicit free-provider request must not transmit the image');
    process.env.AI_PROVIDER = 'openai';
    assert.equal(aiStatus().configured, false, 'A cloud provider is not configured in local-only mode');
    await assert.rejects(extractImage(Buffer.from('synthetic'), 'bill', 'image/png', store, 'fixture', 'real'), /local-only/i);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
    for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
  }
});
