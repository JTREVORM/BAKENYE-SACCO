# Dashboard and receipt UI review

Base: `19be8fa` (latest `main`, rechecked on 22 October 2026). Branch: `ui/dashboard-receipt-refinement`.

## Findings and corrections

- `PanelFigure` used Tailwind `truncate` on both its label and monetary value. Its four-column grid was selected by viewport width even inside a narrow dashboard panel. The shared `SavingsMonthFigures` presentation now uses content-sized tracks, full labels, existing `Money` formatting, and natural height. The database call and values are unchanged.
- Overview and Super Admin themes used negative top margins (-9, -12 and -18px), left offsets (66/72px), and an absolutely positioned chart with extra reserved text padding. Composed styles also reached other staff dashboards. `KpiCard` and `KpiCardFeature` now own their geometry through named CSS classes: header, full-width value/supporting text, then a measured mini chart in normal flow. Theme rules no longer reposition those internals. Grids select readable tracks by container space.
- Staff finance and member balance summaries forced `white-space: nowrap`. These now allow the currency prefix and value to wrap naturally. Existing compact overview summaries remain intentionally compact; full-precision savings, treasury and receipt values remain complete.
- The member, cashier, accountant, loan officer, field officer and administration previews were checked. Manager uses the same overview presentation as the shared staff dashboard. Navigation, charts, data tables and permission-dependent actions retain their existing components and destinations.

## Receipt architecture and design

Both staff `/staff/transactions/[id]` and member `/transactions/[id]` pages call the existing `receipt_for_transaction` RPC and render `src/components/Receipt.tsx`. The staff page retains its permission guard and reversal action; the member page retains its member guard and existing RPC authorization. No route, RPC call or issuing rule changed.

The shared receipt now has a navy institutional letterhead, official project logo, gold divider, status-sensitive summary, two-column desktop/print details, single-column phone details, distinct savings balance, description and approved footer. A staff-page width constraint was widened to allow the actual receipt design to use its available space.

All existing detail branches remain: fee lines, share quantities/unit price/total, loan number/current outstanding/next due date, external references, receiving/source accounts, transfer references/handler and payee. Status headings distinguish deposits, outgoing payments, expenses, withdrawals, disbursements, transfers and reversals. Only posted transactions get completed wording. The supported transaction status enum has no pending status; this change does not add one or issue receipts for unposted documents.

Supported existing categories: monthly savings, weekly savings, deposit, withdrawal, share purchase, loan repayment, loan disbursement, fee, income, expense, penalty, transfer and payment. Membership fees continue to use the existing receipt title and fee lines.

`balance_after` comes from the existing RPC's date-bounded ledger representation, not a new calculation or a current balance lookup in the component. It is omitted when unavailable, disabled or reversed. This is the existing backend representation, not a newly introduced immutable snapshot. Loan outstanding comes from the current loan balance view and is now explicitly labelled **Current outstanding balance**. A missing next-due date no longer asserts “fully repaid.” Backend calculations are unchanged.

There is no existing QR or thermal receipt implementation in this architecture. No public verification endpoint or new printer workflow was introduced. Existing copy-reference, protected-page sharing and authorization behavior are preserved. No contacts or regulatory claims were invented.

Print and Download PDF continue to use `printDocument` and the browser print dialog. A named A4 page, 14mm margins, controlled breaks, readable monochrome text, and receipt-scoped release of fixed-height shell containers keep the printed document independent of application chrome. Browser headers/footers must be disabled in the print dialog; the UI explains this limitation. Very long documents may span multiple pages, preserving content and keeping the description/sign-off together.

## Review evidence

All evidence uses synthetic fixtures. Original attached PDFs and production records are **not** included.

| View | Before | After |
|---|---|---|
| Overview KPIs | [Before](evidence/before-overview.png) | [After](evidence/after-overview.png) |
| Savings this month | [Before](evidence/before-savings.png) | [After](evidence/after-savings.png) |
| Super Admin | [Before](evidence/before-super-admin.png) | [After](evidence/after-super-admin.png) |
| Desktop receipt | [Before](evidence/before-receipt-desktop.png) | [After](evidence/after-receipt-1440.png) |
| Mobile receipt | [Before](evidence/before-receipt-mobile.png) | [After](evidence/after-receipt-mobile.png) |
| Printed receipt | [Before PDF](evidence/before-receipt.pdf) | [After](evidence/after-receipt-print.png) · [Monochrome](evidence/after-receipt-monochrome.png) · [PDF](evidence/receipt-staff.pdf) |

Baseline captures use the actual components at `19be8fa` in an isolated checkout, with the same synthetic receipt preview and extracted, unmodified savings figure markup. The savings panel is rendered at a representative two-thirds content width. Required after screenshots omit only the Next.js development-tools badge, which is absent in production. Dashboard screenshots show the real shell and real components; scrollable tables retain their existing horizontal navigation.

## Validation

See [test results](evidence/test-results.json), [execution results](checks.txt), [all sample PDFs](evidence/receipt-index.md), and [changed files](changed-files.txt).

Passed: 194 dashboard/receipt geometry checks, 320 additional financial-summary stress cases, 22 PDF scenarios, 13 category-detail checks, and four application-shell print cases. Standard receipts fit one A4 page; the long-content fixture spans two pages with description and sign-off together. Print text was checked for 4.5:1 contrast. Existing overview, Super Admin, staff and member browser suites and 10 dashboard unit tests also pass. Lint has zero errors and one pre-existing unused-import warning in `FinancialActivity.tsx`.

Reproduce with dummy local configuration (no production access):

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-test-key npm run dev
node scripts/ui-refinement-check.mjs
node scripts/receipt-print-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/overview-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/super-admin-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/staff-dashboards-check.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/member-dashboard-check.mjs
node --test scripts/dashboard-certification.test.mjs scripts/dashboard-fixtures.test.mjs
npm run lint
npm run typecheck
npm run build
```

The new suites require Chromium, `pdfinfo` and `pdftotext`. `CHROMIUM_PATH` can select a browser. They test all eight requested widths (320, 390, 768, 1024, 1280, 1440, 1600 and 1920), five monetary stress values, geometry rather than screenshot similarity, zoom, receipt source fields, all supported types, five payment methods, reversed/reversal statuses, long content, absent optional content, print actions and PDF output. Standard receipts are checked for one A4 page. Font files are fetched through the environment's configured proxy with TLS validation intact.

Initial failures are retained in evidence: stale chart-link assertions omitted the existing `#financial-activity` anchor; PDF dimensions needed a tolerance for Chromium rounding; column-preserving PDF extraction interleaved a wrapped name with its adjacent field, so value validation uses raw reading order; description comparison now checks source text content because rendered inner text trims trailing whitespace; concurrent browser/build runs exceeded the environment memory limit, so final validation runs sequentially. None of these was hidden with sleeps or changed transaction data.

## Safety and readiness

No production database records were queried or modified. The supplied PDFs were inspected only as design references. No schema, migrations, monetary formatting/calculation utilities, ledger logic, server actions, auth/session code, RBAC/RLS, receipt references/numbering, environment files, Vercel settings or deployment configuration were changed. The separate development branch was not checked out or modified. Preview routes remain development-only and return 404 in production.

This branch is for review and merge authorization only. No merge, deployment or promotion is part of this work. Browser validation uses actual components with synthetic payloads; it does not substitute for an authorized post-deployment smoke check with existing access.
