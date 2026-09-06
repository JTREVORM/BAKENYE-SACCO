# BND-SACCO

**Bakenye National Development SACCO** — savings, shares and loans management, built for a
membership of 500+ who reach it mainly on mid-range Android phones.

The interface is the Google Stitch design that was already in this repository, preserved and
wired to a real Postgres backend. The Stitch export is still here, untouched, in
[`stitch_bakenye_mobile_sacco_navigator/`](stitch_bakenye_mobile_sacco_navigator/) — it remains
the visual source of truth, and every screen below names the file it came from.

---

## What it does

| Area | Covered |
| --- | --- |
| **Members** | Register, edit, search, filter, activate/deactivate, full financial history |
| **Shares** | Share capital kept separate from savings; lots priced at purchase time; register and receipts |
| **Savings** | Weekly and monthly periods with targets, paid/partial/pending/missed status, arrears reporting |
| **Loans** | Applied → Under Review → Approved → Disbursed → Active → Completed, plus Rejected; amortisation schedule; guarantors |
| **Repayments** | Interest-first allocation, automatic status transitions, guarantor release on completion |
| **Transactions** | One immutable ledger, `BND-TX-2026-004582` references, reversal workflow |
| **Receipts** | Printable / PDF / shareable, with the SACCO crest and full transaction detail |
| **Finance** | Income by category, expenses with a mandatory approval step, cashbook, profit & loss |
| **Reports** | Member register, savings performance, loan portfolio, statements, cashbook — all printable and CSV-exportable |
| **Users & roles** | Five roles with a permission matrix generated from the rules the app actually enforces |
| **Audit log** | Append-only, with before/after values and a mandatory reason on sensitive actions |

---

## Stack, and why

| Choice | Reason |
| --- | --- |
| **Next.js 15, App Router** | Server Components keep JavaScript off the phone. The member dashboard ships **116 KB** of JS; almost all rendering happens on the server. |
| **Supabase (Postgres + Auth + RLS)** | The brief asks for member data isolation. Row-level security enforces it in the database, so it holds even if application code forgets a filter. |
| **Tailwind, compiled** | Stitch shipped the `cdn.tailwindcss.com` runtime — a ~90 KB JIT compiler downloaded on every page load. [`tailwind.config.ts`](tailwind.config.ts) is a verbatim port of its inline config, so identical classes produce identical CSS, compiled ahead of time. |
| **No chart library** | The dashboard chart is hand-rolled server-rendered SVG. Recharts and friends cost 100–200 KB for what is twelve rectangles. |
| **No PDF library** | Receipts and statements print through the browser's own engine using the print stylesheet in [`globals.css`](src/app/globals.css). "Save as PDF" is a print destination, not 200 KB of JavaScript. |
| **Subsetted icon font** | [`src/lib/icons.ts`](src/lib/icons.ts) lists every glyph used and requests only those from Google Fonts: roughly 15 KB instead of ~350 KB. |

---

## Getting started

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

Then copy the environment template and fill it in:

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role`. **Server-only.** Never prefix it with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally; your real URL in production |

### 3. Apply the migrations

In order. Either paste each file into the Supabase SQL editor, or:

```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

| File | Contents |
| --- | --- |
| `0001_schema.sql` | Tables, enums, constraints, indexes |
| `0002_functions.sql` | Every money-moving operation, as atomic `SECURITY DEFINER` functions |
| `0003_views.sql` | Derived balances, dashboard metrics, statements, cashbook |
| `0004_rls.sql` | Row-level security and function grants |
| `0005_seed.sql` | Loan products, income/expense categories, share price |
| `0006_app_support.sql` | Search, pagination, receipts, reports |

### 4. Create the first administrator

Supabase → Authentication → Users → **Add user** (email + password, "Auto Confirm" on). Then in
the SQL editor:

```sql
update app_users set role = 'super_admin' where email = 'you@example.com';
```

Sign in at `/login`. From there, staff accounts are created in the app under **Users**.

### 5. Optional — demo data

Only on a development or demo project:

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

It creates twelve members, ten weeks of savings, share purchases, loans at every lifecycle stage,
income, expenses and one reversed transaction — by calling the same functions the UI calls, so the
data is indistinguishable from data entered by hand.

### 6. Run

```bash
npm run dev     # http://localhost:3000
npm run build   # production build
npm start
```

---

## How money is kept correct

This is the part worth reading before changing anything.

**One ledger, and it is immutable.** Every money movement writes exactly one row to
`transactions`. A trigger makes `UPDATE` and `DELETE` raise an exception; the only permitted
change is linking a row to its reversal. There is no code path anywhere that edits a posted
amount.

**Balances are never stored.** Savings, share value and loan outstanding are all views that
`SUM()` the ledger — see [`0003_views.sql`](supabase/migrations/0003_views.sql). Nothing can drift,
because there is no second copy to drift from.

**Writes go through one door.** The application has no `INSERT` permission on `transactions`,
`share_lots`, `loan_repayments` or `savings_payments`. RLS grants none. Money moves only through
the `SECURITY DEFINER` functions in [`0002_functions.sql`](supabase/migrations/0002_functions.sql),
each of which checks the caller's role, does its arithmetic and writes its audit entry inside a
single transaction.

**Double submission is handled twice.** The submit button disables while the action is in flight,
and every financial form carries an idempotency key that survives a retry. `post_transaction()`
returns the original row when it sees a key it has already used — so a double tap, a resent POST,
or a dropped response on 3G all resolve to one ledger row.

**Corrections are reversals.** `reverse_transaction()` writes a compensating entry, marks the
original reversed, links the two, rolls back the derived aggregates and records a mandatory
reason. Both rows stay visible to the member forever.

**Money is `NUMERIC(16,2)`.** Never float, never a JavaScript number doing arithmetic. The browser
formats; Postgres calculates.

---

## Who can see what

Five roles, defined once in [`src/lib/rbac.ts`](src/lib/rbac.ts) and enforced three times:
navigation hides what you cannot use, `requirePermission()` guards the route, and RLS guards the
data.

| | Super Admin | Manager | Loan Officer | Cashier | Member |
| --- | :-: | :-: | :-: | :-: | :-: |
| Members | ● | ● | view | view | own |
| Savings & shares | ● | ● | view | ● | own |
| Loan assessment | ● | ● | ● | view | apply |
| Loan approval & disbursement | ● | ● | — | — | — |
| Repayments | ● | ● | ● | ● | own |
| Deposits & withdrawals | ● | ● | — | ● | — |
| Finance | ● | ● | — | record | — |
| Reversals | ● | ● | — | — | — |
| Users & audit | ● | audit | — | — | — |

A member can read exactly their own rows — plus the loans they have agreed to guarantee, because
that is a real obligation of theirs. Everything else returns nothing, at the database.

**Members do not write to the ledger.** Only a cashier, manager or super admin can post a
transaction. A self-service "I paid UGX 50,000" button, with no payment gateway to verify it,
would let anyone inflate their own balance. The member-side *Save Money*, *Buy Shares* and *Repay
Loan* screens therefore show payment instructions and a reference to quote — see
[`PaymentGuide.tsx`](src/components/member/PaymentGuide.tsx). That is where a mobile-money
integration would slot in.

---

## Mobile

Mobile is the primary platform, not a breakpoint.

- Verified at **320 / 360 / 375 / 390 / 430 / 768 / 1024 / 1440 / 1920** — `45/45` checks clean.
  See [`docs/RESPONSIVE.md`](docs/RESPONSIVE.md).
- Wide tables become cards below `md`; the full Stitch table returns above it. Where a table must
  stay, it scrolls inside its own container — the page body never scrolls sideways.
- 44px minimum touch target, 56px for primary actions, enforced by the audit script.
- Numeric keypad on money and phone fields; single-column forms; sticky action bars in the thumb
  zone.
- Skeletons that match the real layout, so nothing jumps when data lands.
- Installable as a PWA — home-screen access without a Play Store download.

```bash
npm run dev
node scripts/responsive-check.mjs      # audits every page at every width
```

The authenticated screens are audited through a development-only harness at **`/dev/preview`**,
which renders the real components against [`src/lib/fixtures.ts`](src/lib/fixtures.ts). It returns
a 404 in production.

---

## Layout

```
src/
├── app/
│   ├── (auth)/         login, password reset — no app shell
│   ├── (member)/       the member's own money
│   ├── (staff)/staff/  the back office
│   ├── actions/        server actions: validate, then call the RPC
│   └── dev/preview/    design QA harness (development only)
├── components/
│   ├── ui/             primitives carrying the Stitch design tokens
│   ├── layout/         TopAppBar, BottomNav, Sidebar, shells
│   └── forms/          financial forms, all wrapped in FinancialForm
├── lib/
│   ├── rbac.ts         roles, permissions, navigation — one source of truth
│   ├── money.ts        UGX formatting and input parsing
│   ├── auth.ts         session and permission guards
│   └── icons.ts        the icon subset
└── types/db.ts         schema and RPC signatures

supabase/migrations/    schema → functions → views → RLS → reference data → support
scripts/                responsive-check.mjs
docs/                   setup, architecture, responsive results
```

---

## Scheduled work

Two functions expect to be run on a schedule — with `pg_cron`, or any external scheduler:

```sql
select run_daily_maintenance();              -- nightly: mark missed periods, flag defaults
select open_savings_periods('weekly');       -- start of each week
select open_savings_periods('monthly');      -- start of each month
```

Opening periods in advance matters: a member who pays nothing then has a `missed` period rather
than no row at all, which is the difference between a measurable shortfall and a silent gap.

---

## Known limits

- **No payment gateway.** Mobile money and bank transfers are reconciled by a cashier. The member
  screens are built so a gateway can be added without redesigning them.
- **Excel export is CSV.** Opens natively in Excel, with a UTF-8 BOM so member names with accents
  survive. A true `.xlsx` writer was not worth ~200 KB for flat reports.
- **Loan interest is flat-rate by default.** `quote_loan()` also implements reducing-balance
  annuity; set `interest_method = 'reducing'` on a loan product to use it.
- **Document uploads are recorded, not stored.** The loan wizard notes attachments and the officer
  collects originals. Wiring Supabase Storage is a contained change to `loan_documents`.
