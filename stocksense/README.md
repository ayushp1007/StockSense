# StockSense

StockSense is a role-aware inventory operations app built on React, TypeScript, Express, and SQLite. It uses one API, database, authorization layer, and stock ledger for the Administrator, Inventory Manager, and Warehouse Staff workspaces.

## Included workflows

- **Administrator:** workspace overview, account creation and suspension, staff warehouse assignments, session revocation, configuration for locations/categories, searchable audit activity, and an audit CSV export.
- **Inventory Manager:** stock dashboard, product catalogue, supplier directory, receipts, deliveries, transfers, physical adjustments, replenishment signals, ledger, CSV report, and inventory copilot.
- **Warehouse Staff:** mobile-oriented assigned task queue, authorized stock lookup and movement history, task quantity/discrepancy submissions, and blind physical counts with required revision checks. A staff submission waits for manager review; it does not change stock.
- **Inventory controls:** per-product units, per-location balances, on-hand/reserved/available quantities, location availability, delivery/transfer reservations, release of unused reservations on cancellation, partial receipts/deliveries, direct quantity-conserving transfers, physical count adjustments, and immutable, idempotent ledger posting.
- **Security:** bcrypt password hashes with explicit byte limits, eight-hour HttpOnly sessions tracked by the server, logout and administrator revocation, role/organization checks, warehouse scoping, request-origin protection, rate limits, reset-code expiry/attempt limits, safe CSV exports, and production security headers.
- **Connected interface:** readable desktop/mobile layouts, refreshed branding, a live attention center, role-specific help, keyboard-accessible dialogs, request retry and session-expiry recovery, contextual physical adjustments, and replenishment items that open prefilled receipt drafts. Newly saved drafts open directly for review and posting.
- **Copilot:** server-side OpenAI Responses API when configured; otherwise explicitly labeled deterministic stock rules. The model cannot post stock or change settings.

## Requirements

- Node.js 24 was used for the build and test runs.
- npm 10 or newer is recommended.

## Local development

**Windows shortcut:** extract the full ZIP, open the `stocksense` folder, and double-click `START-STOCKSENSE.cmd`. It runs from the correct project folder, installs dependencies on the first launch, and keeps the server output visible. Node.js 24 and npm must already be installed; first-time dependency installation needs internet. Keep the command window open. If Vite prints a different port because 5173 is occupied, use the address printed in that window.

For manual setup, open a terminal in the folder containing `package.json` and run:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`. The development API uses port 4000 and Vite proxies `/api` requests to it. Both development servers bind to this computer's loopback address. An empty local database is seeded with clearly labeled demo data. Development startup refuses a production environment; keep production and demo database paths separate.

The proxy preserves the browser's host and port so same-origin security checks work with `localhost`, `127.0.0.1`, and the port printed by Vite. Leave `APP_ORIGIN` empty during local development. If upgrading from the earlier ZIP and sign-in reports “This request did not come from this StockSense application,” replace `vite.config.ts` with this version, stop the development server, run `npm run dev` again, and refresh the page. Keep request-origin protection enabled.

Demo accounts (password `Demo2026!`):

| Role | Email |
| --- | --- |
| Administrator | `admin@stocksense.demo` |
| Inventory Manager | `manager@stocksense.demo` |
| Warehouse Staff | `staff@stocksense.demo` |

The demo reset deletes the configured demo SQLite database and recreates the sample workspace. Stop the app first. It requires `APP_ENV=demo` and refuses a production environment or a database that is not the seeded demo workspace:

```powershell
npm run demo:reset
```

## Production setup

Build the server and client, then provision a persistent SQLite path, an independent random session secret, and reset-email delivery. Keep `.env` and provider keys out of source control and the ZIP.

```powershell
npm ci
npm run build
$env:NODE_ENV = "production"
$env:APP_ENV = "production"
$env:DB_PATH = "D:\StockSense\data\stocksense.db"
$env:JWT_SECRET = "<random value of at least 32 characters>"
$env:APP_ORIGIN = "https://inventory.your-domain.example"
$env:RESEND_API_KEY = "<Resend API key>"
$env:EMAIL_FROM = "StockSense <no-reply@your-domain.example>"
$env:BOOTSTRAP_COMPANY = "Your Company"
$env:BOOTSTRAP_ADMIN_NAME = "Workspace Administrator"
$env:BOOTSTRAP_ADMIN_EMAIL = "admin@your-domain.example"
$env:BOOTSTRAP_ADMIN_PASSWORD = "<unique password of at least 14 characters>"
npm run company:bootstrap
npm start
```

Bootstrap is one-time and stops if the database already contains any user. It validates its inputs before opening a database and creates no demo accounts. Passwords must be at least 14 characters and at most 72 UTF-8 bytes. `npm start` always selects production mode and rejects missing/example session secrets and demo databases. Keep `DB_PATH`, `JWT_SECRET`, and the public HTTPS `APP_ORIGIN` in the service environment. Put TLS in front of the app; allow direct access only from the trusted reverse proxy. Set `TRUST_PROXY=true` only when exactly one trusted proxy hop is configured. Back up the SQLite database using SQLite's online backup mechanism or while the app is stopped; a live WAL database should not be copied as a single file.

The security upgrade invalidates older login cookies; users sign in again. Database migrations add session and count-revision records without resetting existing inventory. Fresh demo workspaces also correct several sample opening balances; existing databases are not silently rewritten. Emails must be unique across accounts because the login form identifies a user by email. Ambiguous legacy accounts fail closed and need distinct email addresses before use.

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` to enable the live copilot. Without an AI key, replenishment and copilot rule-based fallback remain available. If Resend is not configured, production password reset asks the user to contact an administrator instead of pretending an email was sent.

## Checks

```powershell
npx playwright install chromium
npm run check
npm audit
```

`check` runs TypeScript checking, the production build, inventory smoke checks, security regression checks, production startup checks, and Chromium browser tests. Use `npm run smoke`, `npm run test:security`, `npm run test:production`, or `npm run test:browser` for a particular suite. Production checks require the current build. Tests use isolated databases and disable external AI/email providers; they do not reset your workspace.

Browser tests exercise all three roles at desktop and mobile widths, keyboard dialogs, session recovery, request retry, product adjustments, receipt-draft context, and automated WCAG A/AA checks on role landing screens. The HTML report, screenshots, failure traces, and disposable browser database are under `work/`. Automated accessibility scans cover a subset of accessibility requirements; they do not replace assistive-technology testing. See `SECURITY-AND-TEST-REPORT.md` for the latest recorded results and remaining deployment checks.

## Interface and branding

The interface uses a teal, warm white and lime visual system shared by the administrator, inventory manager and warehouse workspaces. The logo is in `public/stocksense-mark.svg`; the decorative warehouse illustration is in `src/client/StockIllustration.tsx`. Presentation overrides live in `src/client/refresh.css`, loaded after the workflow styles. All visual assets and fonts work without an external asset service. If an already-open local tab still shows the earlier design, refresh it with Ctrl+F5.

## Stock posting rules

1. Drafts do not change on-hand stock.
2. Marking a delivery or transfer ready reserves the requested quantity. `available = on hand − reserved` at that product/location. Another operation cannot reserve the same units.
3. A warehouse staff submission stores reported quantities and exceptions only. A manager reviews it before validating the operation.
4. Validation runs in a database transaction, writes the ledger, updates balances, advances the operation, and stores the idempotency result. Repeating the same validation key and payload does not post twice, including after completion. Reusing the key for different quantities is rejected.
5. A partial receipt or delivery keeps its unfulfilled remainder open. A canceled unposted remainder releases its reservation; quantities already posted stay in the ledger.
6. Direct transfers post equal source and destination movements in the same transaction. A physical count is treated as a target balance; its difference is recorded as an adjustment movement.
7. Counts use ledger revisions to reject intervening stock movements, including movements that return the balance to its previous value. Staff must reopen/recount after a stale submission; managers can request a correction. For a stale manager-created adjustment, cancel the draft and create a new count. A count cannot reduce on-hand stock below active reservations. Quantities support three decimal places.

## Current boundaries before a live rollout

This is a production-oriented application foundation, not a complete ERP or a horizontally scalable inventory service. Review these scope limits before making it a system of record:

- SQLite is a single-node deployment; PostgreSQL, high availability, distributed queues, automated backup retention/restore testing, and operational monitoring are not configured.
- Transfers are direct. Transit locations, dispatch/receipt stages, and backorder documents are not implemented.
- Supplier contacts are stored in a directory, while a receipt's supplier is still free text; supplier-to-product purchasing links are not modeled.
- Count revisions detect stale work, but there is no dedicated scheduled cycle-count program or count-freeze workflow. Recounts use corrected staff submissions or a new adjustment draft.
- Staff can submit quantity and text exceptions. Photo attachments, camera/barcode scanning, a staff AI task assistant, and push/email task notifications are not included.
- Location parent IDs are stored, but the UI does not yet edit hierarchies or archive locations. Full company settings (timezone, operation numbering, notification preferences) are not exposed.
- Inventory and operations lists are intended for small-to-medium workspaces and currently cap returned records; server-side paging, saved filters, and full report families need additional work for larger deployments.
- Costs, currency, valuation, reservations for incoming supply, and confirmed-incoming calculations are not modeled. Reorder signals use recent posted customer deliveries and configured thresholds/lead days.

Do not treat absence of one of these listed features as a successful workflow. Enable only the workflows your deployment has operationally validated.
