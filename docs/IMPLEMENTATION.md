# LedgerSprout implementation decisions

## Authority and scope
The latest implementation instructions in the conversation authorize local application development and supersede planning-only statements and undecided initial defaults in PLAN.md and graph.html. Those existing planning artifacts are preserved as received. No public deployment, paid service, domain purchase, remote repository, or GitHub push is authorized.

## Branding
`shared/config.ts` centrally defines the provisional name LedgerSprout and the tagline “Your stock and expenses, together.” Header, authentication screens and browser title consume that configuration. Domain and trademark availability have not been confirmed.

## Local architecture
React + TypeScript + Vite client; Fastify TypeScript API; local SQLite through Node's built-in `node:sqlite`; versioned SQL migrations under `server/migrations`. Requires Node 22.16 or newer with SQLite support. The tested runtime is Node 26.11.1. There was no existing application or Git repository at the start, only PLAN.md, graph.html and preinstalled node_modules. Existing planning documents remain untouched.

The SQLite development adapter avoids an external account or paid database. It is not the proposed managed production PostgreSQL deployment. Production identity, deployment infrastructure, managed backups, observability, database hosting and hardening remain separate work.

## Initial defaults
- Currency: INR, monetary display to two decimal places.
- Unit costs and quantities: decimal strings with up to six decimal places; Decimal.js handles arithmetic; purchase-line costs round to currency precision.
- Paid expenses: stored as integer paise with decimal-safe totals.
- Timezone: Asia/Kolkata.
- Reporting date: payment date, stored as a date-only YYYY-MM-DD value.
- Calendar weeks start Monday; months follow calendar boundaries.
- Reminders: while the website is open, per authenticated user; default interval 120 minutes.
- Successful document uploads and explicitly saved financial/inventory entries reset inactivity. Dismissal postpones another interval. Page views and opening a form are not successful entries.

Timezone, week-start and reminder interval are persisted user settings. Currency and the payment-date recognition rule are central deployment defaults; changing a currency label is not currency conversion and must not reinterpret historical values.

## Financial and inventory boundaries
Unpaid orders and purchase bills are not expenses. Orders do not add available stock. Only an explicit receipt increases stock. Receiving stock does not create a payment. Payments can explicitly link a purchase. Product stock cost sums received quantities at their historical purchase prices, never all stock at the latest price. Stock-out/sales/returns/wastage workflows are not included in this first local implementation.

Product identity preserves name, type, brand, flavour, pack size and unit. No pack conversion is inferred. Tax rates are retained as reference metadata; entered unit prices/payment totals are not automatically grossed up or taxed a second time.

Reports contain selected-period records and totals only. No previous-period metrics, change percentages, direction indicators or comparative day labels are authorized. Exports must use the same selection and totals as website reports, not just the current table page.

## Demo data
Each signed-in user has separate `real` and `demo` spaces. Real space starts empty. Demo space uses fictional suppliers/products/transactions and example.com supplier contacts. Demo fixtures are seeded once and never included in real-space totals.

## Authentication and security boundary
Local registration/sign-in uses salted scrypt password hashes and server-side expiring sessions with HttpOnly, SameSite=Strict cookies. API writes require a custom request header and allowed Origin. Every business operation is scoped to the signed-in user and selected data space. Parameters use prepared statements. Financial corrections retain audit history and use optimistic versions. Transaction references are unique within a user's space; legitimate repeat payments require explicit duplicate-warning review.

Use this as local development software, not a production security certification. Do not expose development servers publicly. Production requires TLS/secure cookies, a proper deployment origin policy, durable rate limiting, recovery/verification flows, storage quotas and monitored backups.

## External integrations
Existing inventory-application integration stays pending until the application, API/export format, direction and source-of-truth rules are supplied. AI scanning must show setup-required when no provider is configured; manual entry must continue to work. No simulated extraction may be shown as a provider result. Secrets belong on the server, not in Vite variables.
