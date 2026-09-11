# BUD-SACCO

**Bakenye Unity and Development SACCO** — savings, shares and loans management, built for a
membership of 500+ who reach it mainly on mid-range Android phones.

The interface is the Google Stitch design that was already in this repository, preserved and
wired to a real Postgres backend. The Stitch export is still here, untouched, in
[`stitch_bakenye_mobile_sacco_navigator/`](stitch_bakenye_mobile_sacco_navigator/) — it remains
the visual source of truth, and every screen below names the file it came from.

---

## What it does

| Area | Covered |
| --- | --- |
| **Members** | Five-step registration (member, categories, fees, payment, confirmation) in one database transaction; search by number, name or phone; Pending / Active / Suspended / Inactive / Archived; share and savings categories; fees; field-by-field change history; full financial history and ledger |
| **Sign-in** | One form for everyone: member number or phone number (or a staff email) + password. The account and its role are detected, and each role opens its own dashboard |
| **Fees** | Membership, registration and any other fee the SACCO defines under Settings → Fees. Amounts are rows, never code; a change never touches a past receipt |
| **Categories** | Diamond / Gold / Silver share tiers and Diamond / Gold / Silver Saver savings tiers — created, edited and retired by a manager, never hard-coded |
| **Collections** | One centralised screen: search a member by number, name or phone, see what their category expects, and record cash, mobile money, bank or cheque against a reference |
| **Shares** | Share capital kept separate from savings; lots priced at purchase time; per-member progress towards the share category and its qualification deadline |
| **Savings** | Per-member schedules driven by the savings category, with paid/partial/pending/missed/waived status, arrears and per-category analytics |
| **Loans** | Applied → Under Review → Approved → Disbursed → Active → Completed, plus Rejected; amortisation schedule; guarantors |
| **Repayments** | Interest-first allocation, automatic status transitions, guarantor release on completion |
| **Transactions** | One immutable ledger, `BND-TX-2026-004582` references, reversal workflow |
| **Receipts** | Printable / PDF / shareable, with the SACCO crest and full transaction detail |
| **Finance** | Income by category, expenses with a mandatory approval step, cashbook, profit & loss |
| **Reports** | Member register, category performance, savings performance, schedules, statements, ledgers, cashbook — every one downloadable as a letterheaded PDF and as CSV |
| **Users & roles** | Roles and permissions are data: eight built-in staff roles plus any a Super Admin creates, edited on Roles & Permissions and enforced by the database |
| **Audit log** | Append-only, with before/after values and a mandatory reason on sensitive actions |

---

## Stack, and why

| Choice | Reason |
| --- | --- |
| **Next.js 15, App Router** | Server Components keep JavaScript off the phone. The member dashboard ships **116 KB** of JS; almost all rendering happens on the server. |
| **Supabase (Postgres + Auth + RLS)** | The brief asks for member data isolation. Row-level security enforces it in the database, so it holds even if application code forgets a filter. |
| **Tailwind, compiled** | Stitch shipped the `cdn.tailwindcss.com` runtime — a ~90 KB JIT compiler downloaded on every page load. [`tailwind.config.ts`](tailwind.config.ts) is a verbatim port of its inline config, so identical classes produce identical CSS, compiled ahead of time. |
| **No chart library** | The dashboard chart is hand-rolled server-rendered SVG. Recharts and friends cost 100–200 KB for what is twelve rectangles. |
| **No PDF library** | Every document — report, statement, receipt — prints through the browser's own engine using the print stylesheet in [`globals.css`](src/app/globals.css) and the letterhead in [`PrintLetterhead.tsx`](src/components/print/PrintLetterhead.tsx). "Save as PDF" is a print destination, not 300 KB–1 MB of JavaScript on a phone that is already slow. See [Documents and PDFs](#documents-and-pdfs). |
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
| `0007_groups.sql` | The original group layer, superseded by `0021`–`0024`. Kept so the history replays |
| `0008_group_views.sql` | Group views, superseded by `0022` |
| `0009_group_functions.sql` | Group cycles and collection, superseded by `0023` |
| `0010_roles.sql` | The accountant, field officer and viewer roles |
| `0011_rbac_and_rls.sql` | Capability predicates, policies restated against them, RLS for the new tables |
| `0012_fix_loan_policy_recursion.sql` | Breaks a mutually recursive policy pair on `loans` and `loan_guarantors` |
| `0021_categories_replace_groups.sql` | `share_categories`, `savings_categories`, the member columns, and the removal of every group table, column, function and setting |
| `0022_category_views.sql` | Share progress, `member_financials`, schedules, savings transactions, category summaries |
| `0023_category_functions.sql` | Schedule arithmetic, collection, waivers, category administration |
| `0024_category_reports.sql` | Savings dashboard, category analytics, member overview, the collection screen |
| `0025_one_share_price.sql` | Corrects the share price to UGX 20,000 and removes the per-category copy, so one stored price serves shares, categories and receipts |
| `0026_treasury_enums.sql` | The `transfer` and `payment` ledger types and the Cash & Bank enums. Kept apart because new enum values must commit before use |
| `0027_cash_and_bank.sql` | Cash at Merchant, Cash at Bank, Cash at Hand: accounts, the account ledger, receipts, transfers, payments, reconciliation, supporting documents, approval rules, reports and RLS |
| `0028_member_lifecycle_enums.sql` | The `pending` and `archived` member statuses. Kept apart because new enum values must commit before use |
| `0029_roles_and_permissions.sql` | `roles`, `permissions`, `role_permissions`; `has_permission()`; every role list in a function rewritten as a permission; the sign-up, self-edit and guarantor-search fixes |
| `0030_member_registration_and_fees.sql` | Fees, `register_member()`, audited profile edits, phone normalisation, member sign-in verification and lock-out, fee receipts, and the function-grant allowlist |
| `0031_collection_accounts.sql` | The receiving accounts (names, no balances) for the people who take money at the counter |
| `0032_unified_login.sql` | One sign-in for everyone: identifier resolution, failed-attempt pauses, a dashboard per role (its one-time setup codes were replaced by 0034), sign-in audit, and suspended members locked out at the database |
| `0033_existing_passwords.sql` | Marks staff accounts that were already signing in as having chosen their password |
| `0034_temporary_passwords.sql` | Replaces setup codes: every new or reset account gets a temporary password that must be changed at first sign-in, enforced in the database |
| `0035_provision_on_app_metadata.sql` | Provisions a login when Supabase writes its role or member link (a moment after creating the user), and repairs accounts created before the fix |

### 4. Create the first administrator

Supabase → Authentication → Users → **Add user** (email + password, "Auto Confirm" on). An account
made there was not provisioned by the application, so it arrives switched off. Then in the SQL editor:

```sql
update app_users set role = 'super_admin', is_active = true where email = 'you@example.com';
```

Sign in at `/login` with that email and password. From there, staff accounts are created in the app
under **Users**, and members get their login when they are registered - each ready at once, with a
temporary password that must be changed at first sign-in.

**Turn off public sign-up.** Supabase → Authentication → Sign In / Providers → *Allow new users to
sign up* → off. Nobody should be able to create an account for themselves: staff accounts come from
**Users**, member sign-ins from registration. The database already switches self-made accounts off
and gives them no role (see [Security](#security)), but there is no reason to let them exist.

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

## The sign-in screen

`/login`, `/change-password`, `/forgot-password` and `/reset-password` share
[`AuthShell`](src/components/auth/AuthShell.tsx): the brand panel on the left, the task on the
right, one footer across the bottom.

The two widths are different arrangements of the same pieces, and the difference is about what the
screen is *for*:

| | Phone | `lg` and wider |
| --- | --- | --- |
| First thing on screen | **the form** | brand panel beside the form |
| Brand | a ~110px strip above the card: crest, name, motto line, photograph behind | the full left panel |
| Promise, assurances, motto | below the card, for whoever reads on | in the panel |

A member opening the app to check a balance should not scroll past a hero to reach the sign-in
field, so on a phone the card comes first and **the Sign In button sits above the fold at every
width down to 320 × 568** — measured, not assumed. The lockup and the brand copy are the same
components in both arrangements, so the wording lives in one place.

An earlier revision instead rendered the landscape composition at a fixed width and shrank the
whole thing on a phone. It was faithful to the design and unusable: a 56px button at 38% is 21px
and body text lands near 6px. Type too small to read is not a smaller version of a design, it is a
picture of one.

The hero photograph is `public/brand/fisherman-at-sunset-stockcake.jpg`. It is **square**, so it is
cropped by `object-cover` to whatever box it lands in — the lower half of the brand panel on a wide
screen, a shallow band behind the strip on a phone. Replacing it with a wider crop would give the panel more
of the lake; nothing in the code needs to change to do that.

The motto is set in Caveat, self-hosted by `next/font` exactly as Inter is — see
[`brand-font.ts`](src/lib/brand-font.ts) — and preloaded only on the routes that use it. The four
assurance badges carry literal hex values rather than design tokens: they are brand chrome for the
signed-out screen, and the palette has no purple.

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

## Where the money is: Cash at Merchant, Cash at Bank, Cash at Hand

Members mostly pay through the SACCO merchant code, so money sits in the merchant wallet first and
is moved to the bank later. Physical cash is a third place. The Finance module keeps the three
apart and can always say how much is in each - see
[`0027_cash_and_bank.sql`](supabase/migrations/0027_cash_and_bank.sql).

**Still one ledger.** `transactions` remains the only financial ledger. Every row that moves money
now names the account it came out of (`source_account_id`), went into (`destination_account_id`),
or both, and `account_ledger_entries` holds one immutable debit or credit per account touched. A
balance is the opening balance plus those entries; there is no editable balance field.

**Existing screens needed no rewrite.** Triggers on `transactions` resolve the account from the
payment method - mobile money → the merchant account, cash → Cash at Hand, bank transfer or cheque
→ the bank account - unless a person chose one on the Record Collection form. Collections, share
sales, repayments, disbursements, expenses and reversals all post to the right account.

**A transfer is one row, not income.** Merchant → Bank, Cash → Bank, Bank → Cash and Bank → Bank
each post a single `transfer` row that credits one account and debits the other in the same
statement. Total funds, income, expenses and savings are unchanged, and the cashbook and the
Receipts & Payments report leave transfers out.

**Controls live in Postgres.**

- No account may go below zero unless Settings → Cash & Bank allows it.
- References are unique per account, and idempotency keys make a double tap post once.
- Reversals mirror the original entries and link both rows.
- Recording a reconciliation variance requires a reason, and never adjusts the balance.
- Transfers and payments recorded by someone who cannot approve them wait for a manager.
- The approval threshold and a four-eyes rule are settings.

**Numbering.** `BND-RCT-` receipts, `BND-TRF-` transfers, `BND-DEP-` cash deposits, `BND-WD-` bank
withdrawals, `BND-PAY-` payments and expenses, `BND-REC-` reconciliations. Payment intents moved
to `BND-PI-` so the payment register owns `PAY`.

**Nothing is invented.** Only a zero-balance *Cash at Hand* account is seeded. The merchant
account (provider, merchant code) and bank accounts (bank, account number) are created by a
manager under Finance → Accounts & Setup; until then the dashboard says so. Supporting documents
go to the private `finance-documents` bucket and open through two-minute signed links.

---

## How savings work

The SACCO does not run group meetings. Each member saves on the cadence of the savings category
they chose, and the office collects from whoever comes to the counter:

```
SACCO → MEMBERS → SHARE CATEGORY
                → SAVINGS CATEGORY → SAVINGS PLAN → SCHEDULE → MANUAL TRANSACTION → LEDGER
```

**The categories are rows, not constants.** `savings_categories` holds Diamond Saver at UGX 100,000
monthly, Gold Saver at UGX 50,000 monthly and Silver Saver at UGX 5,000 weekly; `share_categories`
holds Diamond at 50 shares, Gold at 25 and Silver at 1. Every screen reads
them back, so a manager who introduces a fourth tier, or moves Gold Saver to UGX 60,000, does it on
the Categories screen. Nothing is deployed. **There is one share price.** It lives in `share_settings.unit_price` — UGX 20,000 — and
nowhere else. `buy_shares()` charges it, every share lot records it at the moment of sale, Settings
edits it, and the Categories screen shows it. A category stores only how many shares and by when;
its total is derived in `share_categories_priced`, so 50 shares is UGX 1,000,000 because a share
costs UGX 20,000, not because a second field says so. Changing the price changes every category
total at once and no purchase already made.

**Share category and savings category are independent.** A member may hold Gold shares and save at
the Diamond rate; the brief's own worked example says so, and both are separate columns on `members`.
A SACCO that later decides the two must always agree turns on
`categories.share_matches_savings`, and `set_member_categories()` starts refusing the mismatch.

**Due dates are computed, never stored.** A weekly saver falls due at the end of their
Monday-to-Sunday week; a monthly saver on the last day of the month. `next_savings_due_date()`
answers "when next?" from the member's own open schedules and their category's frequency, so it is
right the morning after a cycle closes without anything having run overnight. Moving a member
between categories changes when they are next due with no code change.

**A schedule is an expectation, not an account.** `open_savings_schedules()` raises one row per
active categorised member for the current period, carrying what that member is expected to bring —
their own savings plan if they have one, otherwise their category's amount. A member with neither
gets an expectation of zero rather than an invented target. Raising the schedule *before* the money
is due is what turns a member who pays nothing into a measurable `missed` schedule rather than no
row at all.

**A category has no balance.** Members, expected, collected, outstanding and the collection rate are
all `SUM()`s over the member schedules, in `savings_category_summary` and
`savings_category_analytics()`. Forty-two Diamond Savers at UGX 100,000 is UGX 4,200,000 expected;
what they actually paid is what the ledger says. Because there is no second copy, a category total
cannot drift away from what its members see on their own phones.

**Progress towards a share category is arithmetic on real lots.** `member_share_progress` reads the
shares a member actually bought and the joining date on their own record: 32 of 50 Diamond shares is
64%, 18 remaining, UGX 360,000 to go, and the deadline is their `joined_on` plus their category's
qualification window. A category with no window — Silver — simply has no deadline to show.

**Schedules are never deleted.** Paid, partial, missed and waived are all states of the same row,
so a week somebody missed in July is still visible in September with its shortfall attached. A
waiver needs a manager and a written reason, and is refused outright once any money has been paid
against the schedule.

**Collection is manual, and one door wide.** The collection screen calls exactly one function,
`record_scheduled_savings()`, which validates the amount, refuses a future date, refuses a
duplicate external reference, posts one immutable ledger row, recomputes the schedule from its
payment rows and writes the audit entry — all inside one database transaction.

---

## Documents and PDFs

Reports, member statements, ledgers and receipts are documents that leave the building — a member
takes a statement to a bank, an auditor keeps a register, a manager files a collection report. So
each one carries a letterhead of its own, rendered by
[`PrintLetterhead.tsx`](src/components/print/PrintLetterhead.tsx):

- the SACCO crest and full registered name;
- what the document **is** — *Savings by Category*, *Member Register*, *Member Financial Ledger*;
- what it is **about** — the category, the member, the filter applied;
- the **period** it covers, its headline totals, when it was generated and **by whom**.

It is `hidden` on screen, because the page already has a heading, and `print:block` in the output,
where that heading is gone. The application chrome is marked `[data-app-header]` and dropped, table
headings repeat on every page (`thead { display: table-header-group }`), and mobile card layouts are
suppressed so a printed ledger is always the ledger table.

**Download PDF** goes through the browser's own print engine with "Save as PDF" as the destination.
Browsers name that file from `document.title`, so [`lib/print.ts`](src/lib/print.ts) swaps in a real
document name for the duration of the print and restores it afterwards — the file lands as
`BUD-SACCO Member Register 2026-09-07.pdf` rather than `Savings.pdf`, four times over, in the
same Downloads folder.

Checking the output is a command, not an eyeball:

```bash
node scripts/report-pdfs.mjs    # real PDFs, plus a PNG of the same print rendering
```

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

## Members, registration and fees

**Registration is one transaction.** The five-step wizard at **Members → Register Member** collects
everything and changes nothing until the last step. Then `register_member()`
([`0030`](supabase/migrations/0030_member_registration_and_fees.sql)) validates the member, issues the
next `BND-M-0000123` number, sets both categories, charges every applicable fee at its current
amount, posts the payment as one `fee` ledger row into Cash at Merchant, Cash at Bank or Cash at
Hand, issues the `BND-RCT-` receipt, books each fee as income in the cashbook, and writes the audit
trail. If any part fails - a duplicate phone, a missing mobile-money reference, a fee that changed
while the form was open - none of it happened. A double-tapped submit returns the member already
registered.

**Fees are rows.** Settings → Fees lists every fee: amount, mandatory or optional, when it applies
(at registration, annually, when requested), who it applies to, and from when. Registration totals
the active ones. A fee is never deleted, only made inactive. Each member's charge copies the fee's
name and amount when it is made, so raising the Membership Fee from UGX 10,000 to UGX 20,000 changes
what the next member pays and leaves every earlier receipt exactly as it was. Nothing in the code
holds a fee amount; a SACCO with no fees set up charges nothing, and the screens say so.

**Pending until the mandatory fees are paid.** With *Mandatory fees must be paid before a member is
active* on (Settings → Members), a member registered without paying is **Pending**, and becomes
**Active** automatically the moment the fees are paid or waived. A reversed registration payment puts
them back to Pending. Status can also be set to Suspended, Inactive or Archived, with a reason; a
member is never deleted.

**One phone, one member.** Phone numbers are stored in one form, `+2567XXXXXXXX`, whatever was typed
(`0772 123 456`, `+256 772 123456`), so the same person cannot be registered twice under two
spellings of their number. Two live members may share a number only through an explicit override by
someone holding *Allow a shared phone number*, with a reason that is recorded.

**Members cannot change their official record.** Name, phone, member number, membership date,
categories, status and fees are shown to the member read-only. There is no edit control in the
member portal, and more importantly no write path: members have no `UPDATE` privilege on
`members`, no policy allows one, and `update_member_profile()` refuses anyone without *Edit member
records*. Staff who hold it must give a reason, and every changed field is kept in
`member_profile_changes` - field, old value, new value, who, when, why - and shown under **History**
on the member's page. The member number cannot change at all: a trigger refuses it, even from SQL.

### Signing in

There is **one sign-in form for everyone**. Nobody chooses "member" or "staff".

```
identifier (member number, phone number, or a staff email) + password
      │  login_resolve()      which account(s) could this be? is it paused?
      │  Supabase Auth        does the password match? (bcrypt - never stored anywhere else)
      │  my_session()         the role, from the database - never from the form
      │  account standing     suspended, inactive, archived or switched off?
      ▼  landingPath()        that role's own dashboard
```

- **Identifiers.** `BND-M-0000123`, `123`, `0772 123 456` and `+256772123456` are all understood; a
  phone is held in one form, `+2567XXXXXXXX`. Staff may sign in with their phone or, if they use one,
  an email - email is never required. People with no email get an internal sign-in address ending in
  `.invalid` (a domain that can never receive mail); nobody sees or types it.
- **Errors say nothing useful to an attacker.** A wrong password and an unknown identifier get the same
  sentence. After too many failures (Settings → Security) the *identifier* is paused for a while -
  whether or not it exists - and so is a client that fails too often. Nothing is locked permanently.
- **Standing is checked after the password.** A suspended member is told so; an inactive, archived or
  switched-off account is told it is unavailable. The database agrees: `current_member_id()` returns
  nothing for them, so even a session token issued earlier reads no records.
- **Dashboards.** Super Admin and Admin open *Administration*, the Manager the *SACCO overview*, a
  Cashier the *Cashier desk*, a Loan Officer the *Loans desk*, an Accountant *Finance*, a Field
  Officer *Collections*, a member their own dashboard. Which one a role opens is a setting on the role
  (Roles & Permissions), so custom roles choose too. `/admin` sends everyone to their own.

**Accounts are ready the moment they are created.** Registering a member, or creating a staff
account, makes the login at once with a generated **temporary password** (e.g. `KQPM-4827` - no
0/O or 1/I to misread) that the officer is shown once and hands over. It is never stored in readable
form. The first time the person signs in they land on **Choose your password** and must replace it.
Until they do, the account can do nothing else - every page sends them back there, and the database
agrees: `has_permission()`, `is_staff_user()` and `current_member_id()` give an account with
`must_change_password` nothing, so the temporary password opens no data through the REST API either.

**Forgot password** sends a reset link where the account has an email. Everyone else visits the office,
where staff press **Reset password** (member page, or Users), after checking who they are: the old
password stops working, a new temporary one is shown once, and the change is forced again. Nobody at the
SACCO ends up knowing a password that is actually in use.

A member can change their **password** from their profile; they cannot change their name, phone,
member number or categories, which are the SACCO's record. Sign-in, failures, sign-out, resets and
password changes all go to the audit log (module *Security*); no password ever does.

---

## Who can see what

Roles are data. The `roles`, `permissions` and `role_permissions` tables
([`0029`](supabase/migrations/0029_roles_and_permissions.sql)) say who may do what, and **Users →
Roles & Permissions** edits them. Every function and policy asks `has_permission('loans.approve')`,
never "is this caller one of these roles", so switching a permission off on that screen switches it
off for the REST API as well as the app. The permission *catalogue* stays in code (a permission is
only real if something enforces it); roles are created, renamed and retired without a deployment.

Rules that cannot be configured away: the **Super Admin** role always holds every permission, so the
SACCO cannot lock itself out; the **Member** role can only ever hold member-portal permissions; only a
Super Admin can grant *Manage staff accounts* or *Manage roles & permissions*; nobody can edit the
role they hold; and every grant or withdrawal is audited with exactly what changed.

The session carries the permission list (`my_session()`), and the app checks it three times:
navigation hides what you cannot use, `requirePermission()` guards the route, and the database guards
the data. The built-in roles start like this - the live matrix is on the Roles & Permissions screen:

| | Super Admin | Admin | Manager | Loan Officer | Cashier | Accountant | Field Officer | Viewer | Member |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| View members, categories, savings, transactions | ● | ● | ● | ● | ● | ● | ● | ● | own |
| Register members & take registration fees | ● | ● | ● | — | — | — | — | — | — |
| Edit official member records | ● | ● | ● | — | — | — | — | — | — |
| Change member status | ● | ● | ● | — | — | — | — | — | — |
| Allow a shared phone number | ● | ● | — | — | — | — | — | — | — |
| Manage categories | ● | ● | ● | — | — | — | — | — | — |
| Collect fees / manage fees | ● | ● / ● | ● / ● | — | ● / — | — | — | — | — |
| Record savings | ● | ● | ● | — | ● | — | ● | — | — |
| Sell shares | ● | ● | ● | — | ● | — | — | — | — |
| Loan assessment | ● | ● | ● | ● | — | — | — | — | apply |
| Loan approval & disbursement | ● | ● | ● | — | — | — | — | — | — |
| Repayments | ● | ● | ● | ● | ● | — | — | — | — |
| Deposits & withdrawals | ● | ● | ● | — | ● | — | — | — | — |
| Finance (view, record) | ● | ● | ● | — | ● | ● | — | — | — |
| Approve transfers & payments | ● | ● | ● | — | — | — | — | — | — |
| Reconcile accounts | ● | ● | ● | — | — | ● | — | — | — |
| Reversals | ● | ● | ● | — | — | — | — | — | — |
| Settings | ● | ● | ● | — | — | — | — | — | — |
| Staff accounts | ● | ● | — | — | — | — | — | — | — |
| Roles & permissions | ● | — | — | — | — | — | — | — | — |
| Audit log | ● | ● | ● | — | — | ● | — | — | — |

A member can read exactly their own rows — plus the loans they have agreed to guarantee, because
that is a real obligation of theirs. Everything else returns nothing, at the database.

### Security

- **Nothing internal is callable from outside.** Supabase grants `EXECUTE` on every new function to
  `anon` and `authenticated` by default, and `revoke ... from public` does not undo that. Until
  0030, any signed-in member - or anyone with the public anon key - could call
  `post_transaction()`, `post_account_entry()` or `write_audit()` directly. Now every function is
  revoked from both, and only an explicit list of API functions, each of which checks its caller, is
  granted back (0030 §14). New functions are not exposed by default either: grant them there.
- **A sign-up cannot choose its role.** New accounts take their role only from app metadata, which
  only the service role can write. An account nobody provisioned is created switched off.
- **No direct writes to people or money.** `authenticated` has `SELECT` on tables and nothing else,
  except the three writes a policy was written for (savings targets, marking notifications read,
  loan documents). Members, users, roles, fees and the ledger change only through audited functions.
- **Members see only themselves.** The guarantor search gives a member a name and member number,
  never another member's phone, savings or shares.

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
the member register and the savings collection panel. It returns a 404 in production. See
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
│   ├── categories/     category register dialogs, status, member placement
│   ├── collections/    the member collection panel and its record/waive dialogs
│   └── forms/          financial forms, all wrapped in FinancialForm
├── lib/
│   ├── rbac.ts         roles, permissions, navigation — one source of truth
│   ├── categories.ts   tiers, frequencies, category vocabulary
│   ├── money.ts        UGX formatting and input parsing
│   ├── auth.ts         session and permission guards
│   └── icons.ts        the icon subset
└── types/db.ts         schema and RPC signatures

supabase/migrations/    schema → functions → views → RLS → reference data → roles → categories
supabase/tests/         SQL suites, run in a transaction that is always rolled back
scripts/                responsive-check.mjs, db-exec.mjs, test-db.mjs
docs/                   setup, architecture, responsive results
```

---

## Scheduled work

These expect to be run on a schedule — with `pg_cron`, or any external scheduler:

```sql
select run_daily_maintenance();              -- nightly: mark missed schedules, flag loan
                                             -- defaults, and raise today's schedules
select open_savings_schedules(current_date); -- every morning, if run separately
select open_savings_periods('weekly');       -- one cadence only, if wanted
select open_savings_periods('monthly');
```

`run_daily_maintenance()` already calls `open_savings_schedules()`, so a single nightly job is
enough. Raising schedules in advance matters: a member who pays nothing then has a `missed` schedule
rather than no row at all, which is the difference between a measurable shortfall and a silent gap.
Members with no savings category are skipped and counted, not given a default — the count is on the
savings dashboard, because it is a problem for a person to fix rather than for the database to paper
over.

---

## Testing

```bash
npm run typecheck                      # strict TypeScript over the whole app
npm run build                          # production build
npm run test:db                        # the SQL suites in supabase/tests/
node scripts/access-check.mjs [url] [memberNo] [phone]  # sign-in, roles, registration, fees and the member portal at 390px and 1440px
node scripts/responsive-check.mjs      # audits every page at every width
node scripts/desktop-shots.mjs         # screenshots the signed-in back office at 1280/1440/1920
node scripts/report-pdfs.mjs           # renders every report to a real PDF, plus a PNG of the same print output
node scripts/finance-check.mjs [url]   # signs in and loads every Finance screen at 390px and 1440px
```

`supabase/tests/members_access_test.sql` walks the registration scenario from the brief: John
Bakenye, 0700000000, Gold saver, Silver shares, a UGX 20,000 Membership Fee and a UGX 5,000
Registration Fee paid by mobile money. It checks the member number, the stored phone, both categories,
Cash at Merchant +25,000, one fee transaction with its MoMo reference, the receipt and its two lines,
the two income entries and the audit trail; that a retry registers nobody twice; the duplicate-phone,
invalid-phone, missing-category, changed-total and missing-reference refusals, with nothing left
half-made; pending until paid; a fee increase that leaves John's receipt at UGX 20,000; a merchant →
bank transfer that leaves total funds unchanged; an admin phone change recorded field by field; roles
and permissions; member sign-in, the old number failing and the lock-out; a self sign-up claiming
`super_admin` getting nothing; John unable to change his record, post to the ledger or write the
audit log by any route; and that nothing internal is executable from the REST API.

`supabase/tests/treasury_test.sql` walks the Cash & Bank scenario end to end. It covers two member
merchant payments, a merchant → bank transfer, a bank → cash withdrawal and a stationery expense.
It then checks each control:

- duplicate references and idempotent replays;
- the zero-balance rule, reversals and immutability;
- a cashier's transfer waiting for a manager, and four eyes;
- reconciliation variances;
- the reports against the ledger;
- that a member can read none of it.

`npm run test:db` runs each suite as a real signed-in super administrator, inside a transaction it
always rolls back, so it exercises the same `auth.uid()` and role checks the application hits and
leaves nothing behind. The row-level security suite checks isolation end to end: staff read
everything, a member reads only their own rows plus the loans they guarantee, sharing a savings
category with somebody does not make either of them visible to the other, and the books, the audit
log and the statement of anyone else stay closed to them.

`scripts/db-exec.mjs` applies a migration or runs a statement from `DATABASE_URL` directly, with
`--as <user_id>` to run it as a given user — useful when the Supabase CLI has no linked project.

---

## Known limits

- **No payment gateway — deliberately.** Phase One records payments that already happened.
  `payment_intents` is the seam a provider plugs into in Phase Two; nothing calls one today.
- **A savings category collects weekly or monthly, and nothing else.** A tier that needs a different
  rhythm — fortnightly, or quarterly — needs a new value on `savings_kind` and the period arithmetic
  to match.
- **Editing a category is forward-looking.** Changing an amount re-prices only schedules that are
  still pending, unpaid and not yet due. A cycle already collected keeps the figure it was actually
  judged against, so last month's receipts and last month's report never disagree.
- **Excel export is CSV.** Opens natively in Excel, with a UTF-8 BOM so member names with accents
  survive. A true `.xlsx` writer was not worth ~200 KB for flat reports.
- **Loan interest is flat-rate by default.** `quote_loan()` also implements reducing-balance
  annuity; set `interest_method = 'reducing'` on a loan product to use it.
- **Document uploads are recorded, not stored.** The loan wizard notes attachments and the officer
  collects originals. Wiring Supabase Storage is a contained change to `loan_documents`.
