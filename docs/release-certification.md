# Dashboard pre-release certification

20 October 2026 · Africa/Kampala · `claude/cool-mendel-3ey330` · reviewed base `cf2b4b2` plus the accompanying corrections.

**Decision: HOLD. Frontend checks pass; authenticated release certification remains incomplete.**

| Check | Result |
| --- | --- |
| Lint, TypeScript, production build | PASS. |
| Responsive dashboards | PASS: Member at 10 widths, five staff dashboards at eight widths each, Super Admin at six and Overview at ten. Approved layouts preserved. |
| Keyboard accessibility | PASS: eight navigation variants; focus containment/restoration, Escape, closed drawers, desktop resizing and six account-menu permission states. |
| Branding | PASS: Bakenye SACCO fits the member header at 320, 360, 390 and 600px. Custom branding and page titles are preserved. |
| Role assignments | READ-ONLY AUDIT: nine active roles inspected through configuration-only SELECT; mapping below. No account or financial records read. |
| Financial display | Source scoping, full UGX formatting, Uganda date boundaries and fixture arithmetic pass. Actual authorized balances and report reconciliation are UNVERIFIED. |
| Actions and notifications | Fixture destinations, filter links, permission-conditioned controls and collection modal selection/cancellation pass. Persisted filters, notification updates, exports and financial submissions are UNVERIFIED. |
| Loading/error/empty | Component presentation passes at 320/1440px. Real backend failure/retry recovery is UNVERIFIED. |
| Production previews | PASS: all five compiled preview page functions throw 404 before data requests. Local production HTML/RSC requests redirect signed-out users to login; checked fixture markers are absent from public client bundles. No authenticated HTTP session was simulated. |
| Shared styling | No dashboard/global CSS changed. Default member/staff samples preserve original cards and centered member content at 320/390/1440px. Other authenticated non-dashboard pages remain unverified end to end. |
| Authentication, sessions, RLS | UNVERIFIED: no test credentials or Supabase development branch; configured local auth gateway is offline. |

## Observed role assignments

| Role | Dashboard / destination |
| --- | --- |
| Super Admin | Administration — `/staff/admin`, approved Super Admin presentation |
| Admin | Administration — `/staff/admin` |
| SACCO Manager | Overview — `/staff` |
| Loan Officer | Loans — `/staff/loans-desk` |
| Cashier / Teller | Cashier — `/staff/desk` |
| Accountant | Finance — `/staff/finance` |
| Field Officer / Collections | Collections — `/staff/savings/collect` |
| Viewer | Overview — `/staff` |
| Member | Member portal — `/` |
| Owner, Secretary, Treasurer | No separate configured role rows. They may be operational titles using existing roles; account assignments cannot be inferred. |

`landingPath()` and its permission fallbacks are unchanged. Existing database/session rules supply Super Admin and core permissions; explicit role-permission rows alone are not the effective permission set.

## Corrections and test evidence

Corrected the legacy mobile header, drawer keyboard behavior and Settings visibility in the staff account menu. Native dialogs provide focus containment and background inertness without changing the layout. Menu arrows/Home/End/Escape work without capturing search-field keys. No unresolved frontend failure remains in completed checks.

Reproducible suites:

- `npm run lint -- --ignore-pattern 'work/**'`, `npm run typecheck`, `npm run build`.
- `node scripts/dashboard-certification.test.mjs`, `node scripts/dashboard-fixtures.test.mjs`, `npm run test:phone`.
- `scripts/member-dashboard-check.mjs`, `staff-dashboards-check.mjs`, `super-admin-check.mjs`, `overview-check.mjs`, `dashboard-accessibility-check.mjs` against the development server with `CHROMIUM_PATH=/usr/bin/chromium`.
- After build/start on port 3001: `NODE_ENV=production node scripts/dashboard-production-check.mjs http://localhost:3001`.

## Release blockers

1. Provide an isolated Supabase environment and safe accounts for every configured role, including two independent members. Verify real login/session redirects, refresh, expiry, logout/back, temporary-password and suspended-account flows, denied direct URLs, RLS ownership, report totals and safe financial workflows before release. SQL isolation/financial suites were not run against production or an auth emulator.
2. Confirm whether Owner, Secretary and Treasurer require separate roles or use existing roles. If required for release, verify their intended assignments in that isolated environment.

Production data, schemas, RLS, authentication, permission grants, financial calculations and Vercel settings are unchanged. No merge or deployment.

[Member screenshots](review-screenshots/member-dashboard.md) · [Staff screenshots](review-screenshots/staff-dashboards.md)
