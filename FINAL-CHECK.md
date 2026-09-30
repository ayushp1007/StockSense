# StockSense final hackathon verification report

Reviewed on 26 September 2026. Environment: Windows, Node 24.16.0, npm 11.13.0, Chromium through Playwright 1.63.0, axe-core through @axe-core/playwright 4.13.0.

## Final hackathon review — 26 September 2026

**The final full `npm run check` completed successfully:** TypeScript checking, server/client production builds, inventory smoke checks, **27 security regression groups**, **14 production scenarios**, and **13 Chromium browser tests** all passed. The final dependency audit returned **0 known vulnerabilities across 236 dependency entries**. These are the current results; earlier review stages described below are retained as history.

The broader frontend review covered **24 page/dialog states** across the three roles, desktop, 390px mobile and 320px mobile layouts. A separate receipt walkthrough captured **four real workflow states**: assigned receipt, staff submission, manager review, and posted ledger. Both recorded zero automated axe WCAG A/AA findings, horizontal overflow findings, console runtime errors, and failed network requests in the states checked. The walkthrough confirmed that staff reporting leaves stock unchanged and manager posting updates the balance and ledger consistently.

The latest full check ran **after all final code changes**, including the quantity-hint accessibility correction and the Windows development-watcher fix described below. It rebuilt both the server and client and passed every listed suite. A separate live watcher regression kept a generated output file exclusively locked while checking the running app: API health remained successful and the frontend returned HTTP 200. The `START-STOCKSENSE.cmd` launcher also started the API on port 4000 and Vite on port 5173 from its own project directory.

All database-writing automated suites and the receipt walkthrough used isolated databases and dedicated test ports. Separate startup and watcher checks inspected the live development app without resetting or rewriting its inventory. The user's running workspace was preserved. The corrected sample ledger applies to fresh demo databases; existing sample audit history was preserved.

### Additional issues reproduced and fixed in this final review

| Confirmed issue | Fix and regression evidence |
| --- | --- |
| Repeated query parameters reached SQLite as arrays and produced HTTP 500 | API query values must be single, bounded strings. Duplicate and oversized values return controlled HTTP 400 responses; valid filters still work. |
| Sign-in could accept an added suffix beyond bcrypt's 72-byte boundary | Login now rejects passwords over 72 UTF-8 bytes before comparison and creates no session. Creation, reset, and bootstrap already enforced the same byte limit. |
| Canceled warehouse reports remained in pending-review counts and could request impossible rework | Canceled reports expose a closed status, review queues count only open authorized operations, and closed review actions return HTTP 409. Regression checks also verify reservation release, unchanged ledger/balances, and safe report retries after cancellation. |
| Fresh demo history had nonchronological before/after balances and missing historical warehouse links | Seeded receipt, delivery, and transfer events now produce a consistent chronological balance chain and linked locations, while retaining the intended 58-unit steel balance. The regression checks both history and the aggregate. |
| Packaging could crash the Windows development servers when Vite watched a locked generated ZIP | Vite now excludes `outputs/`, `work/`, and `data/` from file watching. A targeted exclusive-file-lock regression kept the live frontend and API healthy; the complete suite then passed with the corrected configuration. |

The final frontend fixes addressed remaining contrast problems in internal pages, keyboard access to scrollable regions, Arrow/Home/End navigation for operation tabs, narrow settings-grid overflow, the canceled-report label, and the final quantity hint's size and contrast. No security controls were weakened to make tests pass.

Local evidence is retained under `work/final-hackathon-check/`: **`check-release-final.log`** is the latest complete run; `windows-watcher-regression.json`, `audit.json`, and `verification-summary.json` record the supplemental evidence and current results. Earlier run logs and failing-before-fix logs preserve the review history. Supplemental interface evidence is in `work/frontend-qa-report.json`, `work/frontend-demo-report.json`, and `work/hackathon-assets/`. Intermediate logs, disposable databases and test artifacts are excluded from the source ZIP.

## Historical review: frontend design refresh — 26 September 2026

- Replaced the indigo identity with deep teal, warm paper surfaces and lime accents; added a geometric inventory logo and a decorative warehouse illustration built as SVG.
- Refreshed all three role landing screens, floating navigation, metric cards, stock charts, task cards, table controls, dialogs and sign-in. Demo account buttons now expose their selected state.
- Kept typography local, with no remote font/image requests. Added a reduced-motion presentation and corrected color contrast and inherited style conflicts found during review.
- Fixed mobile document overflow from absolutely positioned, screen-reader-only table labels. Wide tables remain scrollable inside their own container.
- Verification at that stage: TypeScript check and production build passed; **all 13 existing Chromium browser scenarios passed**, including desktop/mobile role access, sign-in accessibility, keyboard dialogs, saved draft flows and origin protection.
- Additional visual review at that stage covered the live local dashboards and inventory layouts at 390px and 320px. Repeated preview sign-ins reached the development login limiter; the limiter was left intact. Backend logic, the database schema and dependencies were unchanged by that visual-only refresh. The final hackathon review above subsequently reran the complete suite and expanded security coverage from 23 to 27 groups.

## Earlier implementation improvements retained in the final build

- Refreshed all three workspaces with larger, readable text, stronger contrast, responsive layouts, and consistent teal/lime branding.
- Connected the help button to role-specific instructions and alerts to current low stock and pending work. Added visible refresh/sync feedback and periodic refresh while the page is visible.
- Connected product adjustments to the selected product, warehouse, and local balance. Replenishment rows now open receipt drafts with the selected product and suggested quantity. Receipt forms suggest stored suppliers.
- Saved drafts open their operation details immediately. Details load directly from the API, so actions do not depend on a capped list response.
- Added session-expiry recovery, request timeouts, failed-request retry, render-error recovery, and sign-out error handling.
- Added keyboard focus containment/restoration for dialogs and mobile navigation. Closed mobile navigation cannot receive keyboard focus.
- Preserved three-decimal quantities in forms and displayed stock values. Validation previews show the actual quantities to post.

## Earlier findings and fixes retained in the final build

An earlier follow-up reproduced a default-development login 403 that an explicit-origin test setup had masked. The proxy correction and its default-origin browser regression are retained. The table below records that and the other earlier fixes; the four newly reproduced backend issues from the final review are listed above.

| Issue found | Change and verification |
| --- | --- |
| Local sign-in was rejected when APP_ORIGIN was left empty | Vite string proxy shorthand rewrote Host to the API address. An explicit proxy object with changeOrigin false preserves the browser host and port. Browser tests now use the default empty-origin setup and cover both localhost and 127.0.0.1, plus hostile-origin rejection. |
| A logged-out JWT could be reused until expiry | Hashed sessions are recorded in the database and revoked at logout. Regression checks replay the old cookie and verify that another session remains valid. |
| Cookie mutations lacked explicit cross-origin checks | Origin and Fetch Metadata validation reject unrelated browser writes; API responses use `Cache-Control: no-store`. |
| Published/example secrets and demo-mode startup could be used accidentally | Production entry always selects production and rejects missing/example secrets and demo databases. Development binds to loopback and refuses production configuration. |
| Bootstrap opened the database before validating its environment | Bootstrap now validates mode and inputs before opening the database. Tests verify that refusal leaves no database file. |
| The reset command overrode environment safety settings | It now requires explicit demo mode and verifies the seeded demo workspace before deleting anything. Tests confirm real company data survives a refused reset. |
| Reset flows exposed delivery differences and had inconsistent attempt handling | Requests return a generic message; confirmation has a separate rate limit, per-code attempt limit, expiry, single use, and session invalidation. Provider failures are logged for operators. |
| Bcrypt could truncate passwords longer than 72 bytes | Creation, reset, and bootstrap reject overlong UTF-8 passwords; the final review extended this guard to login. |
| The email-only login could encounter the same email in multiple companies | New accounts require globally unique emails. Ambiguous legacy login/reset identities fail closed. |
| Idempotency keys could be reused with changed quantities; final-operation retries were inconsistent | Keys bind to canonical request content; unchanged retries replay safely, changed requests conflict, and completion does not cause another stock movement. |
| Blind-count retries could disclose internal fields | Staff responses exclude expected targets and internal snapshot/request fields, including retry responses. |
| Stale counts could overwrite newer movements or consume reserved units | Ledger revision snapshots and mandatory staff `countVersion` detect stale counts, including a balance that changes and later returns to the same value. Counts cannot undercut active reservations. |
| Partial multiline posting and decimal handling had edge cases | Zero on untouched/completed lines is supported; positive total movement is required; stock math and input precision use three decimal places. |
| Products with live stock/open work could be archived; units could change after use | API guards reject those changes. |
| CSV escaping did not cover formulas after leading whitespace/control characters | Exported text neutralizes those spreadsheet formula prefixes. |
| Malformed/oversized requests and invalid pagination were not consistently handled | They return controlled 400/413 errors without changing stock. |
| An old-schema index could be created before its column migration | Column migration now precedes that index. |
| Some fresh demo balances used the product index as a quantity | Fresh seed/reset uses the intended quantity columns; existing user databases are not rewritten. |
| Warning/status text failed automated contrast checks | Manager warning colors, staff status labels, and a login label were darkened. |
| A smoke assertion revoked the wrong user | The fixture now revokes the manager whose cookie it checks. This was a test error. Browser selectors were also corrected for badges and native select labels. |

## Reproducible checks and current results

```powershell
npm ci
npx playwright install chromium
npm run check
npm audit
```

| Check | Coverage | Final result |
| --- | --- | --- |
| TypeScript and production build | Client, server, browser tests/config, deployable output | PASS |
| Inventory smoke suite | All roles, warehouse scope, receipt/delivery/transfer/count posting, reservations, submission/review, idempotency, ledger, deterministic copilot | PASS |
| Security regression suite | 27 groups: tenant isolation, authentication/session replay, CSRF, validation, reset codes, CSV injection, concurrent reservation attempts, stale counts, atomic rollback, ledger reconciliation, query limits, login byte limits, canceled-review consistency, and chronological sample history | 27 passed, 0 failed |
| Production suite | 14 scenarios: mode/secret/bootstrap/reset guards, clean administrator, production cookies/headers, no demo/reset-code exposure, built app/assets/API responses | 14 passed, 0 failed |
| Browser suite | 13 scenarios: three roles at desktop/mobile widths, real sign-in, navigation, keyboard dialogs, session/retry recovery, saved adjustment drafts, replenishment context, login and role landing-screen accessibility, default proxy origins and hostile-origin rejection | 13 passed, 0 failed |
| Supplemental interface review | 24 page/dialog states across roles, desktop and mobile layouts | No recorded axe, overflow, runtime or network findings |
| Receipt walkthrough | 4 captured states from assigned work through posted ledger; stock reconciliation checked | No recorded axe, overflow, runtime or network findings |
| Windows watcher and local launcher | Live frontend/API remain healthy during an exclusive generated-file lock; project-relative launcher starts ports 5173/4000 | PASS |
| Dependency advisory audit | `npm audit`, 236 dependency entries in its metadata | 0 known vulnerabilities |

Tests use isolated databases and disabled external email/AI providers. The browser suite leaves its disposable database, screenshots, report, and traces under `work/`; these are excluded from the source ZIP. No test resets the user's current workspace. Automated WCAG A/AA checks cover the sign-in and role landing screens, the 24 supplemental page/dialog states, and the four walkthrough states at their tested viewport sizes. They do not cover every possible state or establish complete WCAG conformance. Supplemental review counts describe inspected states, not additional permanent tests in `npm run check`.

## Remaining issues and deployment checks

1. **Live infrastructure is not verified.** TLS, reverse-proxy trust, HTTPS `APP_ORIGIN`, firewall rules, database permissions, backup restore, and monitoring must be checked on the actual host. Production checks here launch the built server locally; they do not certify a deployed domain.
2. **Email and AI provider success paths are untested.** Tests disable external providers. A real reset email and OpenAI response need valid credentials and a deployment check. Reset delivery failures are logged after the generic response and need operator monitoring.
3. **Authentication has no MFA or account-specific login throttle.** The app has an IP login limiter, a separate reset confirmation limiter, code attempt limits, session revocation, and role/location restrictions. Public exposure may need an identity provider or further abuse controls.
4. **Scale and disaster recovery are untested.** SQLite remains a single-node design. No sustained-load, multi-instance, failover, or backup-restore test was performed. Concurrent reservation regression checks verify consistency for a small local scenario, not throughput capacity.
5. **Browser coverage is Chromium only.** Firefox, Safari, screen-reader testing, and every device/browser combination have not been checked. Automated accessibility tools cannot establish complete WCAG conformance.
6. **Existing sessions/count drafts need upgrade handling.** Existing cookies require a fresh sign-in. Old adjustment drafts without snapshots must be recreated; stale staff counts require correction/recount. Make a database backup before deployment migration.
7. **Functional scope remains bounded.** No push notification inbox, transit/backorder documents, attachment/barcode workflow, full server-side list pagination, cost valuation, or scheduled count program. The README records these limits. Alerts refresh from current workspace snapshots; they are not pushed in real time.
8. **Earlier demo audit history is preserved.** The chronological seed correction is included for fresh demo databases. Existing workspaces retain their previous sample history; no automatic rewrite or demo reset was performed.

No advisory audit or local regression suite can establish that an application has no vulnerabilities. This report describes the checks performed and their practical limits.

## Review references

- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): Origin and Fetch Metadata defense guidance.
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): bcrypt input limits and password storage considerations.
- [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing): automated axe checks and coverage limitations.

The findings and pass/fail results in this report come from the local source review and test runs, not from those reference documents.
