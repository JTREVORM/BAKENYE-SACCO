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
| **Members** | Register, edit, search, filter, activate/deactivate, group placement, full financial history and ledger |
| **Groups** | The collection unit. Each group has its own saving day, frequency, targets, leader, secretary and officer |
| **Collections** | Per-group collection sheets on the saving day; manual entry per member, with cash, mobile money, bank or cheque recorded against a reference |
| **Shares** | Share capital kept separate from savings; lots priced at purchase time; register and receipts |
| **Savings** | Group cycles and per-member schedules with targets, paid/partial/pending/missed/waived status, arrears reporting |
| **Loans** | Applied → Under Review → Approved → Disbursed → Active → Completed, plus Rejected; amortisation schedule; guarantors |
| **Repayments** | Interest-first allocation, automatic status transitions, guarantor release on completion |
| **Transactions** | One immutable ledger, `BND-TX-2026-004582` references, reversal workflow |
| **Receipts** | Printable / PDF / shareable, with the SACCO crest and full transaction detail |
| **Finance** | Income by category, expenses with a mandatory approval step, cashbook, profit & loss |
| **Reports** | Member register, savings performance, loan portfolio, statements, cashbook — all printable and CSV-exportable |
| **Users & roles** | Seven staff roles with a permission matrix generated from the rules the app actually enforces |
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
| `0007_groups.sql` | Groups, savings cycles, the schedule columns, `payment_intents` |
| `0008_group_views.sql` | Schedules, cycle summaries, group overview, group on `member_financials` |
| `0009_group_functions.sql` | Cycles, manual collection, waivers, group admin and read models |
| `0010_roles.sql` | The accountant, group officer and viewer roles |
| `0011_rbac_and_rls.sql` | Capability predicates, policies restated against them, RLS for the new tables |
| `0012_fix_loan_policy_recursion.sql` | Breaks a mutually recursive policy pair on `loans` and `loan_guarantors` |

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

## How group savings work

The SACCO does not collect from 500 individuals one at a time. It collects from groups, and every
group meets on its own day:

```
SACCO → GROUPS → MEMBERS → SAVINGS PLANS → CYCLES → SCHEDULES → LEDGER
```

**The saving day is data, not code.** `sacco_groups.saving_day` is an ISO weekday, so a group that
saves on Monday and one that saves on Saturday run the same code path with a different number.
Moving a group from Wednesday to Friday is one edit on its profile; nothing is deployed.
`groups_saving_on(date)` answers "who is collecting today" by comparing that column against the
date, and biweekly groups alternate on the parity of the ISO week rather than on a stored calendar.

**A cycle is an expectation, not an account.** `open_group_cycle()` creates one `savings_cycles`
row for the group and one schedule row per active member, each carrying what that member is
expected to bring — their own savings plan if they have one, otherwise the target of the group.
Opening the sheet *before* the meeting is what turns a member who pays nothing into a measurable
`missed` schedule rather than no row at all.

**A group has no balance.** Expected, collected and outstanding are all `SUM()`s over the member
schedules, in `group_cycle_summary` and `group_overview`. 25 members at UGX 20,000 is UGX 500,000
expected; 23 who pay make UGX 460,000 collected and UGX 40,000 outstanding — computed, never typed.
Because there is no second copy, a group total cannot drift away from what its members can see on
their own phones.

**Schedules are never deleted.** Paid, partial, missed and waived are all states of the same row,
so a week somebody missed in July is still visible in September with its shortfall attached. A
waiver needs a manager and a written reason, and is refused outright once any money has been paid
against the schedule.

**Collection is manual, and one door wide.** The collection screen calls exactly one function,
`record_scheduled_savings()`, which validates the amount, refuses a future date, refuses a
duplicate external reference, posts one immutable ledger row, recomputes the schedule from its
payment rows and writes the audit entry — all inside one database transaction.

---

## Payments: Phase One is manual

There is **no payment-provider integration**. Choosing "Mobile Money" on the collection screen
records that a transfer was already received; it does not call MTN, Airtel, Flutterwave or anything
else, and nothing in this application marks a payment confirmed that a person has not confirmed.
Mobile-money and bank entries require the reference from the confirmation message, and a partial
unique index means the same reference cannot be banked twice.

The seam for Phase Two is real and already in use. Every collected payment opens and settles a
`payment_intents` row with `provider = 'manual'`, because a cashier holding the cash *is* the
confirmation. A gateway added later moves the same row `pending → processing → successful` and
calls the same settlement function; the savings, ledger, audit and UI code does not change.

---

## Who can see what

Seven staff roles and the member, defined once in [`src/lib/rbac.ts`](src/lib/rbac.ts) and enforced
three times: navigation hides what you cannot use, `requirePermission()` guards the route, and RLS
guards the data. The database expresses the same rules as capability predicates —
`can_view_operations()`, `can_record_savings()`, `can_manage_groups()`, `can_view_finance()`,
`can_view_audit()` — so adding the next role is one edit rather than a search across the schema.

| | Super Admin | Manager | Loan Officer | Cashier | Accountant | Group Officer | Viewer | Member |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Members | ● | ● | view | view | view | view | view | own |
| Groups | ● | ● | view | view | view | view | view | own |
| Collections | ● | ● | view | ● | view | ● | view | own |
| Savings & shares | ● | ● | view | ● | view | savings | view | own |
| Loan assessment | ● | ● | ● | view | view | — | view | apply |
| Loan approval & disbursement | ● | ● | — | — | — | — | — | — |
| Repayments | ● | ● | ● | ● | — | — | — | own |
| Deposits & withdrawals | ● | ● | — | ● | — | — | — | — |
| Finance | ● | ● | — | record | ● | — | — | — |
| Reversals | ● | ● | — | — | — | — | — | — |
| Users | ● | — | — | — | — | — | — | — |
| Audit log | ● | ● | — | — | ● | — | — | — |

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
- The back office is capped at **1440px** and centred (`max-w-content`). Stitch designed at that
  width; left to fill a 1920px monitor a stat card becomes 400px of empty space around one number.
  See [`docs/RESPONSIVE.md`](docs/RESPONSIVE.md).
- Wide tables become cards below `md`; the full Stitch table returns above it. Where a table must
  stay, it scrolls inside its own container — the page body never scrolls sideways.
- 44px minimum touch target, 56px for primary actions, enforced by the audit script.
- Numeric keypad on money and phone fields; single-column forms; sticky action bars in the thumb
  zone.
- Skeletons that match the real layout, so nothing jumps when data lands.
- Installable as a PWA — home-screen access without a Play Store download.

The authenticated screens are audited through a development-only harness at **`/dev/preview`**,
which renders the real components against [`src/lib/fixtures.ts`](src/lib/fixtures.ts) — including
the group register and the collection sheet. It returns a 404 in production. See
[Testing](#testing) below for how to run the audit.

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
│   ├── groups/         group register, form, status, placement, cycle opening
│   ├── collections/    the collection sheet and its record/waive dialogs
│   └── forms/          financial forms, all wrapped in FinancialForm
├── lib/
│   ├── rbac.ts         roles, permissions, navigation — one source of truth
│   ├── groups.ts       saving days, frequencies, group vocabulary
│   ├── money.ts        UGX formatting and input parsing
│   ├── auth.ts         session and permission guards
│   └── icons.ts        the icon subset
└── types/db.ts         schema and RPC signatures

supabase/migrations/    schema → functions → views → RLS → reference data → groups → roles
supabase/tests/         SQL suites, run in a transaction that is always rolled back
scripts/                responsive-check.mjs, db-exec.mjs, test-db.mjs
docs/                   setup, architecture, responsive results
```

---

## Scheduled work

These expect to be run on a schedule — with `pg_cron`, or any external scheduler:

```sql
select run_daily_maintenance();              -- nightly: mark missed schedules, flag loan
                                             -- defaults, and open today's group sheets
select open_cycles_for_day(current_date);    -- every morning, if run separately
select open_savings_periods('weekly');       -- members with no group
select open_savings_periods('monthly');      -- members with no group
```

`run_daily_maintenance()` already calls `open_cycles_for_day()`, so a single nightly job is enough.
Opening sheets in advance matters: a member who pays nothing then has a `missed` schedule rather
than no row at all, which is the difference between a measurable shortfall and a silent gap.

---

## Testing

```bash
npm run typecheck                      # strict TypeScript over the whole app
npm run build                          # production build
npm run test:db                        # the SQL suites in supabase/tests/
node scripts/responsive-check.mjs      # audits every page at every width
node scripts/desktop-shots.mjs         # screenshots the signed-in back office at 1280/1440/1920
```

`npm run test:db` runs each suite as a real signed-in super administrator, inside a transaction it
always rolls back, so it exercises the same `auth.uid()` and role checks the application hits and
leaves nothing behind. The group savings suite covers the scenarios that matter: 25 members on one
sheet, expected totalling correctly, a full payment, a partial payment, a missed schedule, a
duplicate submission, a duplicate external reference, a future-dated payment, a closed cycle, and
an ordinary member being refused every operational action. A second suite checks row-level
security end to end: staff read everything, a member reads only their own rows plus the loans they
guarantee, and the books, the audit log and the statement of anyone else stay closed to them.

`scripts/db-exec.mjs` applies a migration or runs a statement from `DATABASE_URL` directly, with
`--as <user_id>` to run it as a given user — useful when the Supabase CLI has no linked project.

---

## Known limits

- **No payment gateway — deliberately.** Phase One records payments that already happened.
  `payment_intents` is the seam a provider plugs into in Phase Two; nothing calls one today.
- **Biweekly groups alternate on ISO-week parity**, anchored to the week the group was created.
  A group that needs a different rhythm — first and third Tuesday, say — needs a rule of its own.
- **Group history stays with the group that collected it.** Moving a member carries only their
  unpaid, not-yet-due schedules across, so an old collection sheet never rewrites itself.
- **Excel export is CSV.** Opens natively in Excel, with a UTF-8 BOM so member names with accents
  survive. A true `.xlsx` writer was not worth ~200 KB for flat reports.
- **Loan interest is flat-rate by default.** `quote_loan()` also implements reducing-balance
  annuity; set `interest_method = 'reducing'` on a loan product to use it.
- **Document uploads are recorded, not stored.** The loan wizard notes attachments and the officer
  collects originals. Wiring Supabase Storage is a contained change to `loan_documents`.
