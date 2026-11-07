import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, expect, type Page } from '@playwright/test';
import { BRAND, DEFAULTS } from '../shared/config';

// Real components, routed API fixtures: copy coverage, not persistence evidence.
async function withCopyPage(run: (page: Page, base: string) => Promise<void>) {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{ name: 'copy-test-harness', configureServer(vite) {
  vite.middlewares.use('/copy-test', async (_req, res, next) => {
    try {
      const html = await server.transformIndexHtml('/copy-test', `<!doctype html><html><body><div id="root"></div><script type="module">
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { Documents } from '/src/Documents.tsx';
        import { ReminderSettings } from '/src/Reminders.tsx';
        const params = new URLSearchParams(location.search);
        const provider = params.get('provider');
        const session = ${JSON.stringify({ user: { id: 'copy-test', name: 'Copy Test', email: 'copy@example.test' }, today: '2026-11-02', settings: DEFAULTS, brand: BRAND })};
        session.ai = { configured: Boolean(provider), provider };
        createRoot(document.getElementById('root')).render(React.createElement(params.has('reminders') ? ReminderSettings : Documents, { session, space: 'real', onUpdated: () => {}, onBack: () => {} }));
      </script></body></html>`);
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    } catch (error) { next(error); }
  });
  } }] });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.route('**/api/**', route => {
      const provider = new URL(page.url()).searchParams.get('provider');
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ records: [], ai: { configured: Boolean(provider), provider } }) });
    });
    await run(page, server.resolvedUrls!.local[0]);
  } finally {
    await browser?.close();
    await server.close();
  }
}

test('Reminders explains tab coordination and fixed currency without internal jargon', { timeout: 30000 }, async () => {
  await withCopyPage(async (page, base) => {
    await page.goto(`${base}copy-test?reminders=1`);
    await expect(page.getByRole('heading', { name: 'Reminders', exact: true })).toBeVisible();
    const text = await page.locator('.reminder-settings').innerText();
    assert.match(text, /Only one visible tab shows a reminder at a time/);
    assert.match(text, /Amounts are recorded in INR; changing currency is not supported/);
    assert.match(text, /Reports use payment dates and calendar months/);
    assert.match(text, /Changing the reminder interval starts a new interval/);
    assert.doesNotMatch(text, /leases|explicit data policy|relabelling/);
    await expect(page.getByLabel('Reminder interval (minutes)', { exact: true })).toHaveValue(String(DEFAULTS.reminderMinutes));
    await expect(page.getByRole('button', { name: 'Save preferences', exact: true })).toBeEnabled();
  });
});

test('Documents discloses storage, automatic provider sharing and correction example reuse without training promises', { timeout: 60000 }, async () => {
  await withCopyPage(async (page, base) => {
    for (const provider of ['', 'free', 'gemini', 'openai', 'ollama']) {
      await page.goto(`${base}copy-test${provider ? `?provider=${provider}` : ''}`);
      await expect(page.getByText('No screenshots yet.', { exact: false })).toBeVisible();
      const text = await page.locator('.documents-page').innerText();
      assert.match(text, /Uploads, extracted values and confirmed corrections are stored on this app's server/);
      assert.match(text, /Up to three recent confirmations from your account, workspace and document type may be reused as examples in later AI requests/);
      assert.match(text, /This app does not retrain a model/);
      assert.match(text, /Scanned values remain editable drafts until confirmed/);
      assert.doesNotMatch(text, /trains the (AI|system)|Free Invoice AI Active|stay private/);
      if (!provider || provider === 'free') {
        assert.match(text, /Uploading automatically sends the image to OCR\.space, an external OCR service/);
        assert.match(text, /Free OCR does not use correction examples/);
      } else {
        assert.match(text, new RegExp(`Uploading automatically sends the image to the configured ${provider} provider`));
        assert.match(text, /These requests include the examples, which may contain financial details/);
      }
      await expect(page.getByRole('button', { name: 'Upload screenshot', exact: true })).toBeDisabled();
    }
  });
});
