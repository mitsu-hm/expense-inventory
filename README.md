# LedgerSprout

Your stock and expenses, together.

Provisional local-development application. No domain/trademark availability is claimed. No public deployment, paid service, remote repository or GitHub push has been performed.

## Start locally

Use Node 22.16+ with built-in SQLite support (tested with Node 26.11.1) and npm. From the project directory:

```sh
cd /host-cwd
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the TypeScript API on 127.0.0.1:3001. Create your own local account through the sign-in screen; there are no hardcoded real-user credentials or email delivery requirements. If the server is already running, do not start a second copy on the same ports.

When this project runs in a container, your browser needs the container's port 5173 forwarded to the host. Vite listens on the container's interfaces for this purpose; the backend stays on loopback. Publish/forward only to host loopback for local use. A successful check inside the container does not by itself prove Windows-host port forwarding. No public tunnel is created.

To exercise the production bundle locally instead:

```sh
npm run build
npm start
```

Open http://localhost:3001 from the same environment, or forward that port appropriately. This is a local production-build preview, not a production deployment. Stop the current dev command first if it is using API port 3001.

Optional `.env` configuration is described by `.env.example`. Node loads `.env` on server startup; restart the server after changing it. No environment file is required for manual use.

## What works

- Local registration/sign-in with salted scrypt password hashes, expiring server-side sessions and HttpOnly/SameSite cookies.
- Real and explicitly fictional demo spaces per user. Real records start empty. Demo expenses, products and example.com suppliers never enter real totals.
- Manual expense creation, payment-date/description/amount/Cash-UPI-Card/additional information, optional references/tax metadata, search, date/method filters, corrections, audit history and stale-edit protection.
- Idempotent save retries and duplicate warnings. One transaction reference cannot become two paid expenses. Bills and payment receipts can attach to the same existing payment.
- Suppliers and product variants with type, brand, flavour, unit/pack size and six-decimal unit-cost precision.
- Separate purchase orders, explicit incremental stock receipts, historical line prices, unpaid purchases excluded from paid expenses, and explicitly linked payments. An order screenshot never automatically increases stock.
- Daily, weekly and monthly calendar reports showing selected dates, matching saved records and exact decimal totals. No previous-period comparison metrics.
- Excel export of every matching expense (not just a page), matching totals, preserved tax metadata, and separately labelled Inventory/Suppliers snapshots with historical purchase prices and quantities.
- Private PNG/JPEG/WebP uploads (5 MB / 40 megapixel limit), source-image preview beside editable fields, persisted manual drafts, missing-field/product-match/total warnings, explicit review confirmation and duplicate linking.
- Honest AI setup-required state when no provider is configured. Manual expenses and manual screenshot transcription continue working.
- Per-user, open-website inactivity reminders using the exact required message, one-tab server leases, upload/manual/dismiss actions and preservation of existing forms. Successful uploads or saved manual entries reset inactivity; dismissal starts another interval.
- Configurable reminder interval, timezone and calendar week start; responsive desktop/mobile navigation and accessible labelled controls/native dialogs.

## Defaults and branding

`shared/config.ts` is the central branding/defaults configuration. Header, login, runtime browser titles and the Vite-generated initial HTML title use the configured name. Initial defaults:

- INR; totals displayed to two decimal places; unit prices/quantities retain up to six decimal places.
- Asia/Kolkata timezone.
- Reports recognize the payment date, not invoice/upload date.
- Calendar weeks start Monday; months follow calendar boundaries.
- Reminder interval: 120 minutes, per signed-in user while the site is open.

Currency is not an automatic conversion setting. Do not relabel historical monetary amounts into another currency. Tax rates are reference metadata; entered totals/prices are not taxed a second time. Inventory received-cost totals use the prices on the original purchase lines, not the product's latest price.

## Persistence and migrations

Default database: `data/ledger.sqlite`. Vite explicitly denies database files, the data directory, backend source, Git metadata and environment/credential files; the production server serves only the built frontend directory. Upload bytes, sessions, drafts, business records, correction history, reminder state and preferences are stored locally. Server startup applies unapplied SQL migrations from `server/migrations` automatically. These migrations create the local schema; no cloud database is needed.

Do not delete `data` to restart the app. Tests use temporary isolated databases, not your development records. For a consistent local backup, stop the API first and copy the database and any existing `-wal`/`-shm` files together, or use SQLite's backup facilities. Local storage is not encrypted at rest; protect the project directory. Production backup/restore operations require their own tested deployment procedure.

## Optional live AI setup

The implemented adapter uses an Ollama-compatible `/api/chat` API with a vision-capable model and structured JSON output. No model is downloaded and no paid provider is purchased by this project.

1. Supply a reachable Ollama-compatible service and an installed vision-capable model.
2. Copy `.env.example` to `.env` and set `AI_PROVIDER=ollama`, `AI_MODEL` to that model, and `AI_BASE_URL` to the service base URL.
3. Set server-only `AI_API_KEY` only if that service requires bearer authentication. Never put provider secrets in `src`, a VITE_ variable, Git, screenshots or chat.
4. Restart the API and use Scan document. Verify the returned draft against the image before confirming it.

If Ollama runs outside the development container, localhost inside the container is not the host. Use a service address reachable from that container. Processing failures preserve drafts and show a real error; there is no successful-extraction simulator. Provider requests time out after 45 seconds and scans are limited per user in the local process.

Live model availability and extraction accuracy have not been verified without a configured provider. The adapter protocol is tested with an explicitly labelled local HTTP test fixture; that is not a live-AI accuracy test. The provider can be wrong even when it returns valid JSON, so human verification is mandatory.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
npm audit --omit=dev
```

The suite includes real SQLite/API and production-Chromium workflows, restart persistence, financial precision, duplicate handling, historical price preservation, ordered-versus-received quantities, filtered full XLSX exports, private drafts, document linking, provider failure handling, date boundaries, cross-tab reminders and unsaved-form preservation. Some smaller frontend tests deliberately isolate API contracts; they are not substituted for the real-backend browser tests.

Browser tests require Playwright Chromium. It is already available in this development environment. On another machine, install the project's browser binary with `npx playwright install chromium` before running browser tests. Runtime use of the website does not require Playwright.

Final QA artifacts are generated under `artifacts/qa-summary.json` and `artifacts/screenshots`. Automated accessibility scans are limited to the tested states and do not constitute full manual WCAG certification.

Production dependencies use documented overrides for the current patched glob/minimatch/uuid releases. This avoids known findings in the static/export dependency trees; XLSX generation and production serving are exercised after these changes. Re-check the audit and tests whenever updating dependencies rather than blindly forcing a downgrade or suppressing advisories.

## Remaining limitations / production work

- External inventory-application integration is intentionally pending its connection details.
- No sales/POS, stock-out/wastage/return workflows, supplier credit ledger, bank feeds, general accounting or tax filing. Received stock is accumulated from explicit receipts; do not mistake this version for a full sales-adjusted warehouse ledger.
- No automatic pack conversion. Selecting a product never invents a document quantity or purchase price.
- No closed-browser notifications, push service or email reminders. Visible tabs check reminder eligibility every five seconds; background throttling and short lease recovery can delay presentation. Reminder actions preserve forms; opening an action briefly defers presentation without counting it as a successful upload/save.
- Unsaved manual form text is held in the current tab; cancel/reminder interactions preserve it, but refresh/sign-out can clear unsaved text. Use Save draft for persistent document review.
- Production PostgreSQL/managed authentication/background workers, HTTPS/secure cookies, verification/recovery/MFA, shared-business roles, storage quotas, distributed rate limits, retention/erasure policies, monitored backups and deployment hardening are not provisioned.
- Local user isolation is implemented; multi-user team sharing is not.
- This has been browser-tested in Chromium, not certified across every browser/device or a live AI model.

## Source documents

PLAN.md and graph.html are preserved. The user's later implementation authorization and initial defaults override their older planning-only/undecided statements; see `docs/IMPLEMENTATION.md` and `docs/API.md` for the current implementation contracts. No historical transaction data has been migrated or erased to change reporting behavior.
