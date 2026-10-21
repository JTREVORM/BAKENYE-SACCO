# Release readiness — dashboard redesign, design only

21 October 2026 · branch `release/dashboard-redesign` · base `main` `5a1c81a`

**Ready for review and a deliberate production deployment. Nothing has been
merged, deployed or changed in production.**

This branch carries the approved desktop and mobile dashboard redesign onto
production `main`, and nothing else from `claude/cool-mendel-3ey330`. That
development branch is untouched at `7b954ca` and keeps the security and
financial work for a later release.

## What production gets

The redesigned landing dashboard for every role — Super Admin and Admin,
Manager and Viewer, Loans Officer, Cashier, Accountant, Field Officer and
Member — in the approved navy and gold system, at desktop and phone widths, with
the redesigned sidebar, rails, drawer and top bar, and their keyboard and
screen-reader fixes. The financial chart's 6- and 12-month toggle works.

Nothing a member or a staff member can *do* changes: the same pages accept the
same submissions, through the same server actions, against the same database
functions and the same permissions.

## Included

| Source | What | Why |
| --- | --- | --- |
| `07b088e` … `cf2b4b2` | The redesign series: every role dashboard, the navigation shell, shared UI primitives, styling tokens, dashboard panels, previews and their review scripts | The approved design |
| `a0f697f` (part) | Navigation accessibility: the mobile navigation dialog, focus handling in the drawer, sidebar and top bar | Part of the approved shell |
| `ca83791` (part) | `FinancialActivity.tsx`, `FinancialRangePicker.tsx` only — the chart range fix, BKC-02 | Without it the approved 6/12-month toggle intermittently does nothing |
| New on this branch | `/work/` in `.gitignore` | The included review scripts write their screenshots under `work/` |
| New on this branch | `"release/dashboard-redesign": false` in `vercel.json` | Pushing this branch creates no deployment — the same convention `main` already uses. Confirmed: none was created. |

Only two files were touched by both the redesign and the later work: the two
chart files, taken deliberately for BKC-02. Every other redesign file is
byte-identical to its version at the end of the design series.

## Excluded

| Change | Source | Why it stays out |
| --- | --- | --- |
| Password-security migration `20261020144523_verified_password_changes.sql`, the verified-completion actions, the service client and RPC types — **BKC-01** | `ca83791` | A schema change and an authentication change; needs its own coordinated rollout |
| Notification "Mark all read" fix — **BKC-03** | `51ea9a7` | Not design |
| Change-password form fix — **BKC-04** | `28c9276` | Authentication form |
| Money-form outcome refactor across sixteen forms — **BKC-05** | `e62a7c8` | Financial posting flow |
| Cash near-duplicate safeguard | proposal only | Never implemented; needs authorization |
| Certification harness, evidence, reports | `c6a07aa` onward | Test tooling and records, not product |
| `"claude/cool-mendel-3ey330": false` in `vercel.json` | `1038e86` | Concerns the development branch only |

## Compatibility with production

- **No migration is required.** Nothing under `supabase/` changes. The branch
  carries `main`'s 48 migrations — the ones production runs.
- **No backend, authentication or permission change.** Nothing under
  `src/app/actions/`, `src/app/(auth)/`, `src/lib/supabase`, `src/lib/auth`,
  `src/lib/rbac`, `src/lib/queries`, `src/lib/treasury`, `src/lib/money`,
  `src/types/`, the middleware, `package.json` or `next.config` changes.
- **Every database object the redesign reads already exists in production's
  schema.** The two RPCs called directly — `search_members` (migration 0006) and
  `security_overview` (0032) — and the eight tables and views read directly —
  `audit_logs`, `loan_balances`, `loan_schedule`, `loans`, `members`,
  `payment_register`, `receipt_register`, `transfer_register` (0001, 0003,
  0027) — are all in `main`'s migrations. Every library function it imports is
  exported by `main`'s unchanged library code.
- **No new environment variable.** The only one the changed files read is
  `NODE_ENV`, for the preview guards; `main` already uses it.
- **Fixture previews cannot leak.** The four `/dev/preview/*` pages each return
  Not Found in production before fetching anything, checked against the
  production build.

## Verification

Run against a disposable local stack — real GoTrue, PostgREST and PostgreSQL 16
— built from **this branch's 48 migrations, i.e. production's schema**, with
synthetic accounts and money. Accounts were seeded through production's own
password path. The certification harness was run from outside the repository
and is not part of this release.

| Check | Result |
| --- | --- |
| Lint | **PASS** — 0 errors, 1 warning (an unused import in `FinancialActivity.tsx`, left byte-identical to its certified version) |
| TypeScript | **PASS** |
| Production build | **PASS** — 77 pages |
| Design unit tests | **PASS** — dashboard fixtures 5/5, dashboard certification 5/5, phone validation 36/36 |
| SQL suites | **PASS** — 471/471, `main`'s own tests |
| Auth / REST / RLS | **56/57** — see below |
| Session expiry and SSR refresh | **PASS** |
| Financial workflows | **PASS** — 6/6: savings and receipts, shares, transfers, the full loan lifecycle, expense approval and reversal, reconciliation and reports against the ledger |
| Dashboard reconciliation | **PASS** — 11/11: every dashboard figure for all eight staff roles against the records it summarises |
| Role browser regression | **198/200** — see below |
| Chart navigation | **PASS** — 9/9, 36 transitions across three roles and three widths |
| Accessibility and responsive | **PASS** — 3/3 suites, 80 groups |
| Restrictions and lockout | **PASS** — 14/14 |
| Production preview exclusion | **PASS** — 26/26 |
| **Layouts against the approved screenshots** | **36/36 match** — identical dimensions, **0.0%** of horizontal bands changed on every one, 0–1.3% of pixels changed (the synthetic figures and timestamps) |

The browser regression covered sign-in for every role, every role's dashboard
at 320, 390 and 1440px, savings collection with its receipt, expense approval,
guarded routes, peer-URL refusal, sign-out, idle timeout and the
temporary-password flow — so login, dashboards, savings, shares, loans and
financial navigation all work, for members and staff, with permissions as they
are today.

### The three failures, and why they do not block this release

All three are defects **production has today**, in files this release does not
touch. They are what the excluded work fixes.

- **Auth/RLS — the legacy password RPC is still callable (BKC-01).** On the
  production schema `log_password_changed` lets a temporary-password holder
  clear their own flag. This is the known vulnerability; the fix is the
  excluded migration.
- **Browser — "Mark all read" stays busy (BKC-03).**
  `src/components/MarkAllRead.tsx` is byte-identical to `main`.
- **Browser — a wrong current password shows no error (BKC-04).**
  `src/components/auth/ChangePasswordForm.tsx` is byte-identical to `main`.

The savings-collection confirmation defect (BKC-05) did not show in this run —
it is intermittent — but it is equally present in production today and equally
untouched here. **Shipping this release leaves all four exactly as they are in
production now: no better and no worse.**

Full results: [release evidence](release-evidence/dashboard-redesign.json).

## Files

59 files: 27 added, 32 changed. No file is deleted.

**Dashboard pages and the staff layout** (9)

| | File |
| --- | --- |
| changed | `src/app/(member)/page.tsx` |
| changed | `src/app/(staff)/layout.tsx` |
| changed | `src/app/(staff)/staff/admin/page.tsx` |
| changed | `src/app/(staff)/staff/desk/page.tsx` |
| changed | `src/app/(staff)/staff/finance/page.tsx` |
| changed | `src/app/(staff)/staff/loans-desk/page.tsx` |
| changed | `src/app/(staff)/staff/page.tsx` |
| changed | `src/app/(staff)/staff/savings/collect/page.tsx` |
| changed | `src/app/globals.css` |

**Navigation shell — sidebar, rails, drawer, top bar, hero** (9)

| | File |
| --- | --- |
| added | `src/components/layout/Hero.tsx` |
| changed | `src/components/layout/MemberDesktopRail.tsx` |
| changed | `src/components/layout/MemberDrawer.tsx` |
| changed | `src/components/layout/MemberShell.tsx` |
| added | `src/components/layout/RailBackdrop.tsx` |
| changed | `src/components/layout/Sidebar.tsx` |
| changed | `src/components/layout/StaffShell.tsx` |
| changed | `src/components/layout/TopAppBar.tsx` |
| added | `src/components/ui/useMobileNavigationDialog.ts` |

**Dashboard panels and shared UI primitives** (15)

| | File |
| --- | --- |
| changed | `src/components/collections/MemberCollectionPanel.tsx` |
| changed | `src/components/finance/AccountCards.tsx` |
| changed | `src/components/finance/FundsStrip.tsx` |
| changed | `src/components/finance/LedgerTable.tsx` |
| added | `src/components/member/MemberDashboard.tsx` |
| changed | `src/components/member/TransactionRow.tsx` |
| added | `src/components/staff/AdministrationPanels.tsx` |
| added | `src/components/staff/CashierPanels.tsx` |
| changed | `src/components/staff/DashboardHeader.tsx` |
| added | `src/components/staff/LoanDeskPanels.tsx` |
| added | `src/components/staff/RecentTransactions.tsx` |
| changed | `src/components/staff/TrendChart.tsx` |
| changed | `src/components/ui/primitives.tsx` |
| changed | `src/components/ui/scroll.tsx` |
| changed | `src/components/ui/states.tsx` |

**Chart range navigation (BKC-02)** (2)

| | File |
| --- | --- |
| added | `src/components/staff/FinancialActivity.tsx` |
| added | `src/components/staff/FinancialRangePicker.tsx` |

**Styling — Tailwind tokens, global CSS, CSS modules** (5)

| | File |
| --- | --- |
| added | `src/components/member/MemberDashboard.module.css` |
| added | `src/components/staff/OverviewDashboard.module.css` |
| added | `src/components/staff/StaffDashboard.module.css` |
| added | `src/components/staff/SuperAdminDashboard.module.css` |
| changed | `tailwind.config.ts` |

**Presentation helpers — formatting, icon registry, preview fixtures** (3)

| | File |
| --- | --- |
| changed | `src/lib/fixtures.ts` |
| changed | `src/lib/format.ts` |
| changed | `src/lib/icons.ts` |

**Design-review previews (404 in production)** (4)

| | File |
| --- | --- |
| added | `src/app/dev/preview/certification/page.tsx` |
| added | `src/app/dev/preview/dashboard/page.tsx` |
| added | `src/app/dev/preview/member/page.tsx` |
| added | `src/app/dev/preview/staff/[dashboard]/page.tsx` |

**Design review scripts (not shipped to the browser)** (9)

| | File |
| --- | --- |
| added | `scripts/dashboard-accessibility-check.mjs` |
| added | `scripts/dashboard-certification.test.mjs` |
| added | `scripts/dashboard-fixtures.test.mjs` |
| added | `scripts/dashboard-production-check.mjs` |
| added | `scripts/member-dashboard-check.mjs` |
| added | `scripts/overview-check.mjs` |
| added | `scripts/preview-shots.mjs` |
| added | `scripts/staff-dashboards-check.mjs` |
| added | `scripts/super-admin-check.mjs` |

**Repository configuration and docs** (3)

| | File |
| --- | --- |
| changed | `.gitignore` |
| changed | `docs/DESIGN-FIDELITY.md` |
| changed | `vercel.json` |

## Deployment

`vercel.json` on `main` sets `"main": false`, so **merging to `main` does not
deploy**. Production changes only when somebody deliberately deploys. Today
production is deployment `dpl_6NAXLXN8hKJsDL3ErD9YTck8q8jB`, built from `main`
`5a1c81a`, serving `bakenye-sacco.online` and `www.bakenye-sacco.online`.

**1. Review and merge.** Open a pull request from `release/dashboard-redesign`
into `main` and merge it with a merge commit. This creates no deployment. Record
the merge commit:

```bash
git fetch origin main
MERGE_SHA=$(git rev-parse origin/main)
git log -1 --format='%H %s' "$MERGE_SHA"
```

**2. Build it as production, without taking the domains.** From a clean checkout
of exactly that commit, with the Vercel CLI linked to the project:

```bash
git checkout --detach "$MERGE_SHA"
vercel link --yes --project bakenye-sacco --scope mwesigwatrevorjoseph-9675s-projects
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --skip-domain
```

`--skip-domain` creates a production deployment — production environment
variables, production database — **without** pointing the live domains at it.
The command prints its unique URL.

**3. Check it on its own URL before anyone else sees it.** It talks to the
production database, so look, do not record: sign in as one staff account and
one member account and confirm the dashboard renders, the sidebar and drawer
navigate, the chart switches between 6 and 12 months, and the savings, shares,
loans and finance pages open. Do not post a transaction.

**4. Promote it.**

```bash
vercel promote <deployment-url-from-step-2> --scope mwesigwatrevorjoseph-9675s-projects
```

The domains move to it at once. Repeat the step 3 checks on
`https://bakenye-sacco.online`.

## Rollback

No migration is involved, so rolling back is a frontend switch only; the
database needs nothing.

**Instant — point the domains back at today's deployment:**

```bash
vercel rollback dpl_6NAXLXN8hKJsDL3ErD9YTck8q8jB --scope mwesigwatrevorjoseph-9675s-projects
```

or, in the dashboard: Project `bakenye-sacco` → Deployments →
`dpl_6NAXLXN8hKJsDL3ErD9YTck8q8jB` → *Instant Rollback*. It takes effect
immediately, with no rebuild. After an instant rollback Vercel stops
automatically assigning the production domains to new deployments until one is
promoted again; since `main` does not deploy on merge, that changes nothing in
practice.

**Then make `main` match production again,** so a later deployment does not
bring the redesign back by accident:

```bash
git checkout main && git pull
git revert -m 1 "$MERGE_SHA"
git push origin main
```

## Before you deploy

- **The four defects above ship as they are today.** Most importantly, the
  BKC-01 password vulnerability remains in production until its migration and
  matching application are rolled out together, under separate authorization.
  This release neither helps nor hinders that.
- **Two old preview deployments of the development branch exist** —
  `dpl_T2bzJqV4qPAAUhSYhwDz9xTGKMC3` (`07b088e`) and
  `dpl_B3CzehHrjwQUzwcckbXbUSzCKSaQ` (`b402921`), from before that branch
  suppressed its own deployments. They are previews, not production, and were
  left alone. If the project's Preview environment points at the production
  database, they are reachable frontends to it, and deleting them is worth
  considering.
- Real-device Safari and Firefox, and assistive-technology audits, remain
  unverified, as they were for the development branch.
