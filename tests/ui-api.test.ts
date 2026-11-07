import test from 'node:test';
import assert from 'node:assert/strict';

// Import lazily so the RED run identifies the absent behavior, not a loader crash.
test('API helper sends cookies and protects JSON writes', async () => {
  const module = await import('../src/api').catch(() => null);
  assert.ok(module, 'The frontend must provide a reusable API helper');
  const original = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await module.api('/session');
    await module.api('/expenses?space=real', { method: 'POST', body: JSON.stringify({ amount: '10.25' }) });
    assert.equal(requests[0].credentials, 'same-origin');
    assert.equal(requests[1].credentials, 'same-origin');
    assert.equal(new Headers(requests[1].headers).get('x-ledger-request'), '1');
    assert.equal(new Headers(requests[1].headers).get('content-type'), 'application/json');
    assert.equal(requests[1].body, '{"amount":"10.25"}');
  } finally { globalThis.fetch = original; }
});

test('API helper preserves duplicate candidates and HTTP status', async () => {
  const module = await import('../src/api').catch(() => null);
  assert.ok(module, 'The frontend must provide typed API errors');
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Possible duplicate', code: 'DUPLICATE', candidates: [{ id: 'existing' }] }), { status: 409 });
  try {
    await assert.rejects(module.api('/expenses'), (error: unknown) => {
      assert.ok(error instanceof module.ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'DUPLICATE');
      assert.deepEqual(error.candidates, [{ id: 'existing' }]);
      return true;
    });
  } finally { globalThis.fetch = original; }
});
