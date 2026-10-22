# Bakenye Unity and Development SACCO — Full System Diagnostic

**Independent technical audit — security, financial integrity, reliability and production readiness**

| | |
| --- | --- |
| Repository | `JTREVORM/BAKENYE-SACCO` |
| Repository HEAD at audit | `0cf56aba7d22bc946128fb9bd20ebe7b80ff39c4` |
| Production deployment SHA | `0cf56aba7d22bc946128fb9bd20ebe7b80ff39c4` — **verified identical** |
| Vercel deployment | `dpl_FTs6BNRW1cG69e9sm6n94aaonw1o`, target `production`, state `READY` |
| Production site | https://www.bakenye-sacco.online |
| Audit date | 22 October 2026 |
| Audit branch | `claude/cool-sagan-afkvit` |
| Schema version | 48 migrations, `0001_schema.sql` … `0048_international_member_phones.sql` |
| Nature of this audit | Diagnosis only. No production data, deployment, migration, configuration or application code was changed. |

**Final verdict: HIGH RISK.**

The system is far better engineered than most software of its kind. Its financial
core is genuinely sound: every accounting invariant tested held exactly, and
every concurrency and idempotency test passed. The risk is not in the money
mathematics. It is that **one confirmed authentication defect lets anybody
holding a staff-issued temporary password take permanent, full control of the
account it belongs to**, and that **production and preview deployments share the
same RLS-bypassing database credentials**. Both are remediable in hours. Neither
is a design flaw requiring rework.

---

## A. Executive summary

### What is genuinely healthy

These are not assumptions. Each was exercised against a disposable copy of the
real schema, with the real migrations and the real application code.

- **Financial integrity.** Thirteen accounting-invariant and reconciliation
  queries were run across the full schema. Every one held exactly: no orphaned
  records, no duplicate references, no duplicate ledger postings, no missing
  journal entries, no negative balances, no reversal left with a net ledger
  effect, share capital reconciling to the shilling, loan schedules summing
  exactly to principal, interest and total payable. See
  `evidence/03-accounting-invariants.out`.
- **Concurrency and duplicate-payment safety.** Six adversarial tests with real
  concurrent database sessions: same idempotency key from two simultaneous
  cashiers posts once; a retried submission returns the original reference
  rather than posting twice; twelve concurrent postings to one cash account keep
  the stored running balance exact; a concurrent double reversal creates exactly
  one reversal; two concurrent repayments of 80% each cannot overpay a loan. All
  passed. See `evidence/04-concurrency-tests.out`.
- **Authorization.** A nine-role matrix over sensitive RPCs and RLS-protected
  tables behaved correctly in every cell. A member sees exactly one member
  record — their own. No role can grant itself a permission or change its own
  role. Record-level access was probed directly: an unrelated member asking for
  another member's loan or transaction by UUID gets the not-found page with no
  figures. See `evidence/05-authorization-matrix.out`,
  `evidence/06-loan-rls-verification.out`.
- **The shipped SQL suites.** All **471 assertions across 11 suites pass**
  against a clean installation. See `evidence/07-sql-suites.out`.
- **Receipts and printing.** The navy-and-gold receipt was exercised across 13
  transaction categories, reversed and reversal states, long names, large
  amounts, missing optional values, all six payment methods, four viewports and
  22 A4 PDF cases — 194 layout checks plus 320 financial-summary field checks.
  All passed, print chrome hidden, one page. See
  `evidence/09-receipt-and-print.out`.
- **Static quality.** TypeScript `--noEmit`: clean. ESLint: one unused-import
  warning. Production build: succeeds, 103 kB shared JS. All 48 migrations apply
  to an empty database in order with no errors.
- **Schema hygiene.** Every foreign key has a supporting index; every table has
  at least one index; every table has RLS enabled.

### Verified vulnerabilities

- **F-01 (CRITICAL)** — `log_password_changed()` lets an account on a
  staff-issued temporary password clear its own forced-change lock and obtain
  full role access, while the temporary password the issuing officer was shown
  remains the live credential. **Reproduced end to end over the real REST API.**
  This is the previously reported BKC-01, and it is still present on production
  `main`.
- **F-02 (HIGH)** — `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` are scoped to
  both `production` and `preview` on Vercel. Every preview deployment therefore
  carries RLS-bypassing credentials for the live financial database.
- **F-03 (HIGH, unconfirmed exploitability)** — `NEXT_PUBLIC_SITE_URL` is not
  set in production, so the password-reset redirect is built from the
  attacker-controllable `Origin` request header.

### Confirmed functional defects

F-04 (non-atomic password reset), F-05 (member register totals and CSV truncate
silently past 1,000 members), F-07 (notification action failures are silent),
F-08 (idle timeout falls back to a hardcoded 60 minutes for reset-link
sessions), F-10 (maintenance mode has no bypass token configured, so enabling it
would lock everyone out), F-16 (18 sub-44px tap targets and 9px text, measured),
F-17 (`balance_after` is wrong for backdated entries — latent).

### Testing gaps

There is **no CI/CD workflow of any kind** — no `.github/workflows`. The
extensive suites that exist are run by hand. They are also order-dependent and
mutate shared state. Most importantly, a dedicated temporary-password security
suite exists and **passes**, while F-01 remains wide open, because that suite
never calls the vulnerable function.

### What was not independently verified

The SACCO's hosted Supabase project is **not reachable from this session** — the
connected Supabase organisation contains two unrelated projects. Nothing in this
report rests on reading the live database. F-01's presence on the hosted schema
is inferred from the migration chain, which is deterministic; see
§C for exactly what that means.

---

## B. System architecture

```
Browser (React 18 / Next.js 15.5.24 App Router, PWA)
   │
   │  form POST → Server Action  ·  or client Supabase query (anon key)
   ▼
src/middleware.ts ───────────────── maintenance gate → session refresh →
   │                                signed-out redirect → idle-timeout sign-out
   ▼
Server Actions  src/app/actions/{treasury,members,financial,fees,settings,
   │            roles,loan-products}.ts  +  src/app/(auth)/actions.ts
   │              ├─ zod schema validation
   │              ├─ requirePermission() / can()   ← says "no" politely
   │              └─ supabase.rpc(...)             ← the check that actually holds
   ▼
Supabase PostgREST  (JWT → `authenticated` role)
   │
   ▼
PostgreSQL 326 functions / 41 tables / 17 views
   ├─ assert_permission() → has_permission() ─┐
   ├─ assert_capability() → can_view_finance() etc.  all three honour
   ├─ current_member_id()                     ┘  must_change_password
   ├─ Row Level Security on every table
   ▼
post_transaction()  ─ idempotency key, unique index, document numbering
   │
   ├─ trigger transactions_accounts_resolve  → picks the account
   ├─ trigger transactions_accounts_post     → post_account_entry()
   │      └─ SELECT … FOR UPDATE on financial_accounts  ← serialises postings
   ▼
transactions ──┬── account_ledger_entries (debit/credit/balance_after)
               ├── savings_payments → savings_periods
               ├── share_lots
               ├── loan_repayments → loan_schedule → loans
               ├── income_entries / expense_entries / payments
               ├── fee_payment_lines → member_fees
               └── receipts (receipt_no issued on money received)
```

### Authoritative source of truth for each balance

| Balance | Authority | Derivation |
| --- | --- | --- |
| Member savings | `transactions` | `member_savings` view, posted rows only, deposits + savings − withdrawals |
| Member shares | `share_lots` joined to posted `transactions` | `member_shares` view |
| Loan outstanding | `loans.total_payable` − posted `loan_repayments` | `loan_balances` view |
| Cash/bank/merchant account | `financial_accounts.opening_balance` + Σ(`account_ledger_entries.debit − credit`) | `financial_account_balances` view |
| Ledger running balance **on screen** | recomputed window function ordered by `entry_date, id` | `account_movements.running_balance` |
| Savings period paid | `savings_periods.paid_amount`, maintained by trigger and recomputed on reversal | reconciles exactly (invariant I8) |

### Where money can be created, approved, reversed or deleted

Creation: `record_member_collection`, `record_savings_payment`,
`record_scheduled_savings`, `buy_shares`, `record_loan_repayment`,
`disburse_loan`, `record_cash_movement`, `record_expense`, `record_income`,
`record_other_receipt`, `collect_membership_fee`, `pay_member_fees`,
`create_payment`, `create_internal_transfer`, `register_member`.
Approval: `approve_expense`, `decide_payment`, `decide_internal_transfer`
— each gated by `assert_can_approve(creator)`, which enforces segregation of
duties.
Reversal: `reverse_transaction` only, gated on `transactions.reverse`.
Deletion: **none.** `transactions` and `account_ledger_entries` both carry
immutability triggers (`guard_transaction_immutability`,
`guard_account_ledger_immutability`); `fees`, `member_fees`,
`fee_payment_lines` and `member_profile_changes` are append-only or
never-deleted. This is the right design and it is correctly enforced.

### Roles and permissions, as actually configured

9 roles (1 member-scoped, 8 staff-scoped) and 39 permissions. Roles:
`member`, `viewer`, `cashier`, `field_officer`, `loan_officer`, `accountant`,
`admin`, `manager`, `super_admin`. No roles or permissions were invented for
this report; all were read from the seeded catalogue.

---

## C. Audit coverage

### Environment used

A **disposable, offline stack** was built for this audit and nothing in it ever
touched the SACCO's hosted project:

- PostgreSQL 16.15, a fresh local cluster, all 48 migrations applied in order,
  the repository's own `supabase/seed.sql` synthetic data, and the
  Supabase-compatible bootstrap the repository ships at
  `documentation/source/test-stack/`.
- PostgREST 12.2.3 and the repository's `gateway.mjs`, giving a real
  Supabase-shaped HTTP API (GoTrue auth + REST) on `127.0.0.1:54321`.
- The real Next.js application, both `next dev` and a real production build
  (`next build` + `next start`), pointed at that gateway.
- Chromium via Playwright for all browser work.
- Synthetic accounts only: one super admin, one cashier, three member logins,
  one deliberately left on a temporary password.

### What was inspected, tested, or not verified

| Area | Method | Result |
| --- | --- | --- |
| 48 migrations, clean install | applied to empty DB | all apply, no errors |
| 11 SQL suites, 471 assertions | `scripts/test-db.mjs` | 471 pass, 0 fail |
| Accounting invariants (13) | custom reconciliation SQL | all hold |
| Concurrency / idempotency (6) | real concurrent sessions | all pass |
| Authorization matrix (9 roles × 20 probes) | real role identities | correct in every cell |
| Record-level access (IDOR) | browser, 3 member identities | no leakage |
| BKC-01 / F-01 | SQL **and** end-to-end REST | **reproduced** |
| Receipts, print, A4 PDF | 2 browser suites | 194 + 320 checks pass |
| Responsive / accessibility | real DOM geometry, 9 widths | 33/45 clean; 18 tap targets, 5 tiny text |
| Staff & member workflows | 8 browser suites, signed in | all routes 200, workflows pass |
| Expense lifecycle incl. approval posting | browser + DB assertion | 19 checks pass |
| Document numbering under concurrency | 24 connections, 480 numbers | contiguous, no collisions |
| Money formatting | unit tests | 22 pass |
| Phone validation | 36 unit + 723 parity checks | all pass |
| TypeScript / ESLint / build | repository scripts | clean / 1 warning / succeeds |
| Dependencies | `npm audit` | 14 advisories (11 high, 3 moderate) |
| Query plans and indexing | `EXPLAIN ANALYZE` | no missing FK index; one scalability concern |
| Production deployment SHA | Vercel API | matches repository HEAD exactly |
| Production headers & route guards | read-only HTTPS | correct; no CSP |
| Vercel environment variables | metadata only, **no values decrypted** | **production/preview not isolated** |

### Explicitly **not** verified, and why

1. **The hosted Supabase schema.** The SACCO's project is not in this session's
   Supabase scope (the connected organisation holds two unrelated projects). I
   did not query, and could not query, the live database. **Consequence for
   F-01:** I verified that `log_password_changed()` is last defined in migration
   `0034` with the defect present, that no later migration (`0035`–`0048`)
   redefines it, revokes it, or alters its grant, and that applying the full
   chain to an empty database produces the vulnerable function. If production
   has been migrated through `0048` — which the application's dependence on
   `0048` features implies — the hosted schema has the vulnerable function.
   That is a strong inference from deterministic inputs, not a live read. One
   read-only query settles it; see §J.
2. **Production runtime behaviour under load.** No load testing was run against
   production, by instruction. Scalability statements in §I are extrapolated
   from measured query plans on a 12-member dataset and are labelled as such.
3. **The Supabase Auth redirect allow-list**, which decides whether F-03 is
   exploitable. Not readable from here.
4. **Supabase project limits, auth settings, storage configuration, backups.**
   Not readable from here. The Free-tier backup position in §I is general
   product knowledge, not an observation of this project.
5. **Local PostgreSQL is 16.15; Supabase projects run PostgreSQL 17.** No
   finding depends on version-specific behaviour, but the difference is
   disclosed.
6. **Two shipped suites could not complete** for environmental reasons, not
   product ones: `dashboard-production-check.mjs` requires Next's compiled
   server chunks out of context and failed with `MODULE_NOT_FOUND` (its intent —
   that `/dev/preview*` refuses to render in production — I verified directly by
   HTTP instead); `receiving-accounts-check.mjs` reported 26 failures, all of
   which expect fixture accounts (an Airtel merchant account, a deactivated bank
   account) that `seed.sql` does not create. Its behavioural assertions — a
   newly configured account appearing with no code change, and a deactivated one
   disappearing at once — passed.

### Honest note on three apparent failures I traced to my own harness

Recorded because an audit that hides its false starts is not trustworthy:
`install-prompt-check` and `pwa-installability-check` failed to sign a member in
because `temp-password-check`, run earlier, deliberately leaves its member on a
temporary password — the suites share state and are order-dependent (F-13).
`maintenance-check` reported two 500s because I ran `next build` while the dev
server was live; against the production build it passes 9/9. The service worker
registering zero times is a dev-mode artifact: `ServiceWorker.tsx` returns early
unless `NODE_ENV === 'production'`.

I also initially suspected two defects that proved not to be defects, and
dropped both: a member appearing to read all 8 loans in the table (they are an
accepted guarantor on 7 of them, which migration `0042` deliberately permits —
verified against `loan_guarantors`), and `disburse_loan` appearing to be gated on
a hardcoded role (migration `0018` does that, but the **live** definition from
`0041` gates on `assert_permission('loans.disburse')`).

---

## D. Findings register

20 findings: **1 critical, 2 high, 10 medium, 7 low.**

---

### F-01 — CRITICAL — Temporary-password lock can be cleared by the account holder, without changing the password

*(the previously reported BKC-01)*

| | |
| --- | --- |
| Module | Authentication / account provisioning |
| Files | `supabase/migrations/0034_temporary_passwords.sql:40-50` (function), `:302` (grant); `src/app/(auth)/actions.ts:341,389` (legitimate callers) |
| On production `main` | **Yes** — `0034` is the last definition; nothing in `0035`–`0048` changes it |
| Pre-existing or new | Pre-existing since migration `0034`. Not introduced by any recent change, and not by Codex or Claude — `0032` had the same shape, and `0034` restated it while adding the lock the function undermines |
| Complexity to fix | Low — one function, one migration |

**Root cause (confirmed).** `log_password_changed()` is `SECURITY DEFINER`,
granted to `authenticated`, takes no arguments, and unconditionally executes:

```sql
update app_users
   set password_set_at = now(), must_change_password = false
 where id = auth.uid();
```

It is the *bookkeeping* half of a password change. The *actual* change happens
separately, in `supabase.auth.updateUser({ password })` in the application. The
database never verifies that the credential changed, so the bookkeeping can be
performed on its own, directly, by the account holder.

Migration `0034`'s own header states the intended guarantee: *"Until the
temporary password is changed the account can do exactly one thing: change
it… so a temporary password is no way into the data through the REST API
either, only into the change-password screen."* That guarantee is enforced in
`is_staff_user()`, `has_permission()` and `current_member_id()`, which all test
`not u.must_change_password` — and it is defeated by the one function that can
clear the flag.

**Reproduction (synthetic accounts, isolated stack, never production).**
Full transcript: `evidence/02-bkc01-end-to-end-rest.out`.

```
[1] sign in as a member still on the staff-issued temporary password  → access token
[2] my_session()            → must_change_password = true
[3] GET /rest/v1/transactions → []                        (lock holds)
[4] POST /rest/v1/rpc/log_password_changed   {}           → HTTP 204
[5] my_session()            → must_change_password = false
    GET /rest/v1/transactions → [FEE261022002 20,000 · SHR261022002 200,000
                                 · SAV261022012 100,000 · …]
[6] sign in again with the SAME temporary password        → SUCCEEDED
```

Expected: step 4 is refused, or is a no-op unless the credential actually
changed; the account stays confined to the change-password screen.
Actual: one unauthenticated-parameter RPC converts a confined session into a
fully privileged one, permanently, and the temporary password remains live.

A SQL-level proof showing data visibility going from 0 to 15 rows, and the
`auth.users.encrypted_password` column provably untouched, is at
`evidence/01-bkc01-proof.out`.

**Financial and security impact.**
A temporary password is generated by staff and **displayed to the issuing
officer** (`src/app/actions/members.ts:303-304`, `src/lib/accounts.ts:60-69`).
Every member registration and every password reset therefore creates a window in
which a second person knows the credential. The intended design closes that
window at the member's first sign-in. With F-01 the window never closes:

- Any officer who registers a member or resets their password can later sign in
  **as that member**, indefinitely, and read their savings, shares, loans,
  statements and personal details. For a member-scoped account the blast radius
  is that member's records; for a staff account whose password was reset it is
  that role's full permission set — including, for a `manager` or `admin`,
  reversing transactions, disbursing loans and changing SACCO settings.
- The audit trail actively misleads: `write_account_audit(…, 'auth.password_changed',
  'Changed their password')` records that the member chose their own password.
  An investigation would conclude the account was secured when it was not.
- `must_change_password` is also what `security_overview()` counts, so the
  security dashboard will report the account as settled.

**Compounding factor.** The temporary password is 4 letters from a 23-character
alphabet plus 4 digits from an 8-digit alphabet ≈ 2^30 of entropy. That is
adequate for a credential that must survive one sign-in against rate-limited
login. It is not adequate for one that may remain live forever, which is what
F-01 makes it. (The `bytes[i] % alphabet.length` construction is also very
slightly biased; immaterial next to the above.)

**Proposed correction** (for your approval — **not applied**):

1. Make the flag-clearing conditional on evidence that the credential changed.
   The cleanest version keeps the database as the authority: have
   `log_password_changed()` clear `must_change_password` only when
   `auth.users.encrypted_password` differs from the value recorded when the
   temporary password was issued. Store that fingerprint in
   `issue_temporary_password()` (for example a `temp_password_hash` column on
   `app_users`, or a digest in an existing audit row) and compare inside the
   function.
2. Alternative, if touching `auth.users` from application code is unwanted:
   remove the flag-clearing from `log_password_changed()` entirely, leaving it
   purely an audit writer, and clear `must_change_password` from a new
   `SECURITY DEFINER` function callable **only by the service role**, invoked by
   `replacePassword()` *after* `updateUser()` returns success. The service-role
   key is server-only, so a member's bearer token cannot reach it. This is the
   smaller change and I would recommend it.
3. Either way: `revoke execute on function log_password_changed() from
   authenticated;` if it no longer needs to be called by the account holder.
4. Audit the hosted `app_users` for accounts whose `password_set_at` is set but
   which have never had a successful sign-in recorded after it — a possible
   signature of the bypass having been used. Treat this as detection, not proof.

**Required regression tests.**
- SQL: an account with `must_change_password = true` calls
  `log_password_changed()`; assert the flag is still `true` and that
  `current_member_id()`, `has_permission()` and `is_staff_user()` all still
  answer no.
- End-to-end: extend `scripts/temp-password-check.mjs` with a step that POSTs
  `log_password_changed` with the temporary-password bearer token and asserts
  that the REST API still returns zero rows afterwards. **This is the test whose
  absence let the defect survive certification** — the suite currently checks
  that the temporary password reads no records, but never tries to lift the lock
  first.

---

### F-02 — HIGH — Production and preview deployments share the same RLS-bypassing database credentials

| | |
| --- | --- |
| Module | Infrastructure / Vercel environment configuration |
| Evidence | Vercel project `prj_R9Nkxq7QptYeuTXtKn2yvc5gmv84`, environment-variable metadata. **No values were decrypted or read.** |
| On production `main` | Yes — it is configuration, not code |
| Complexity to fix | Low, but requires a key rotation and a redeploy |

All five environment variables — `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `MAINTENANCE_MODE`
— are scoped to `["production", "preview"]`. There is no separate Supabase
project, and no preview-specific override.

**Impact.** Every preview deployment — one per push to any branch with Git
deployments enabled, and every pull request — runs with the service-role key for
the **live** financial database. That key bypasses RLS completely; the
repository says so itself (`src/lib/supabase/admin.ts`). Consequently:
a preview URL is a full-privilege foothold on real member data; anyone who can
reach a preview deployment reaches production data; and a mistake on a feature
branch (a seed script, a destructive migration, a debug route) operates on live
records. Preview deployments also have weaker access control than production by
nature.

`vercel.json` currently disables Git deployments for three named branches
(`main`, `feat/login-page-redesign`, `release/dashboard-redesign`), which
narrows the exposure today but does not remove it: any other branch still
produces a preview with production credentials.

**Proposed correction.** Create a second Supabase project for preview/staging.
Re-scope `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` to `production` only and
add preview-only values pointing at the staging project. Then **rotate the
production service-role key**, since it has been resident in preview builds.
Enable Vercel Deployment Protection on preview URLs as defence in depth.

---

### F-03 — HIGH (exploitability unconfirmed) — Password-reset redirect is built from an attacker-controllable header

| | |
| --- | --- |
| Module | Authentication — forgot password |
| File | `src/app/(auth)/actions.ts:275-283` |
| On production `main` | Yes, code-wise; impact depends on a setting I could not read |
| Complexity to fix | Trivial (set one environment variable) |

```ts
const origin =
  process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get('origin') ?? 'http://localhost:3000';
await supabase.auth.resetPasswordForEmail(c.auth_email, {
  redirectTo: `${origin}/auth/callback?next=/reset-password`,
});
```

`NEXT_PUBLIC_SITE_URL` is **not present** in the Vercel project's environment
variables (five are configured; this is not one of them, and
`hiddenProductionEnvCount` is 0). The expression therefore falls through to the
request's `Origin` header, which any client can set to any value.

**Attack path.** An attacker POSTs the public `/forgot-password` action with a
victim's member number and `Origin: https://attacker.example`. Supabase emails
the victim a reset link whose `redirectTo` is the attacker's host. If the victim
clicks it, the one-time `code` is delivered to the attacker, who exchanges it
for a session — full account takeover, with no interaction from the victim
beyond clicking a link that genuinely came from the SACCO's email sender.

**Why I am not calling this confirmed.** Supabase Auth validates `redirectTo`
against the project's **Redirect URLs** allow-list and falls back to the Site
URL when it does not match. If that allow-list contains only
`https://www.bakenye-sacco.online/**`, the attack fails and this is a latent
bug. If it contains a wildcard such as `**` or `http://localhost:3000/**` —
common during development, and this project's `.env.example` defaults
`NEXT_PUBLIC_SITE_URL` to `http://localhost:3000` — it succeeds. **I could not
read that allow-list from this session.** It should be checked first.

**Proposed correction.** Set `NEXT_PUBLIC_SITE_URL=https://www.bakenye-sacco.online`
for the production target (it is a build-time inlined variable, so a rebuild is
required), tighten the Supabase redirect allow-list to that host only, and
replace the `'http://localhost:3000'` fallback with a thrown error in
production rather than a silent default.

---

### F-04 — MEDIUM — Staff password reset is not atomic and fails open

| | |
| --- | --- |
| Module | Account management |
| File | `src/app/actions/members.ts:299-307` |
| On production `main` | Yes |
| Complexity | Low |

`issue_temporary_password()` commits the `must_change_password = true` flag and
writes an `account.password_reset` audit entry **before** the password is
actually changed by `admin.auth.admin.updateUserById()`. If that second call
fails — outage, rate limit, network — the action returns *"The password could
not be reset just now"*, but the first step has already committed.

**Resulting state.** The account is flagged as needing a forced change while its
**old** password is still live. The holder can still sign in (their old password
works) but is forced through "choose your password", where the old password is
accepted as "current password" — so it is recoverable. The real damage is to the
record: the audit log says a temporary password was issued when none was, and
the officer has no way to tell which of the two states the account is in.
Combined with F-01, the holder can also simply clear the flag themselves.

**Proposed correction.** Change the password first, then set the flag; or make
the flag-setting compensating (clear it again if `updateUserById` fails) and
write the audit entry only after both steps succeed.

---

### F-05 — MEDIUM — Member register totals and CSV silently exclude members past 1,000

| | |
| --- | --- |
| Module | Reports |
| File | `src/app/(staff)/staff/reports/members/page.tsx:34-38, 49-60, 80` |
| On production `main` | Yes. Dormant until membership exceeds 1,000 |
| Complexity | Low |

The query is capped at `.limit(1000)`. The page does disclose truncation in its
heading (`rows.length === 1000 ? ' (showing the first 1,000)' : ''`) — but the
**totals row** (savings, shares, loan balance) and the **CSV export** are both
reduced from the same truncated `rows` array. Once the SACCO passes 1,000
members, the member register will present a SACCO-wide-looking total that
understates savings, share capital and the loan book, and the exported CSV will
omit members, with no warning attached to either the totals or the download.

**Proposed correction.** Compute the totals in the database over the full
filtered set rather than from the returned page, paginate the table, and stream
the CSV unbounded (or label both explicitly as covering the first 1,000).

---

### F-06 — MEDIUM — `member_financials` rescans `transactions` five times per query and is used unbounded

| | |
| --- | --- |
| Module | Database / reporting performance |
| Objects | view `member_financials`; callers `staff/reports/members`, `staff/shares` |
| Evidence | `evidence/16-query-plans.out` |
| On production `main` | Yes |
| Complexity | Medium |

`EXPLAIN ANALYZE` on `select * from member_financials` shows **five separate
sequential scans of `transactions`**, plus `share_lots` scanned twice because
`member_shares` and `member_share_progress` each recompute it, and two
correlated `LATERAL` subqueries evaluated per member. At the audited scale (12
members, 158 transactions) the whole view returns in **5.9 ms**, so there is no
problem today.

The concern is shape, not current speed: the work grows with
members × transactions and has no date bound. With a few thousand members and a
few hundred thousand transactions — a realistic three-to-five-year position for
a growing SACCO — the member register and the shares page become the slowest
pages in the system and the likeliest to hit Vercel's serverless execution
limit. **This is extrapolation from a measured plan, not a measured slowdown.**

**Proposed correction.** Give `transactions` a covering index on
`(member_id, status, type)` including `amount`; collapse the duplicated share
aggregation into one subquery; and if the register stays slow, materialise
per-member aggregates (a summary table maintained by the existing posting
triggers, or a materialised view refreshed on a schedule).

---

### F-07 — MEDIUM — "Mark all read" discards the action result, so failures are silent

| | |
| --- | --- |
| Module | Notifications |
| File | `src/components/MarkAllRead.tsx:18-24` |
| On production `main` | Yes |
| Complexity | Trivial |

```tsx
onClick={() => start(async () => {
  await markNotificationsRead();   // ActionResult discarded
  router.refresh();
})}
```

`markNotificationsRead()` returns `ActionResult` and returns `{ ok: false, error }`
on any RPC failure (`src/app/actions/members.ts:606-619`). Nothing reads it. On
failure the spinner stops, `router.refresh()` re-renders the same unread list,
and the user is told nothing — they see a button that appears to do nothing.

This is the one place in the codebase where a server-action result is thrown
away. I searched every client component: every other mutation goes through
`useActionState` and renders both outcomes. That matters for the brief's
Phase 6 question — **the "server action completed but the browser showed no
state" symptom has exactly one structural cause in the current `main`, and this
is it.** The change-password and collection-confirmation paths named in the
brief both render their results correctly (`ChangePasswordForm.tsx:36-37`,
`FinancialForm.tsx:90-100, 160-171`), and `FinancialForm` additionally keeps a
stable idempotency key per form instance, regenerated only after success — so a
double tap, a dropped response or a browser resend all carry the key the server
has already seen. That is the correct design and it is correctly implemented;
test T2 in `evidence/04-concurrency-tests.out` confirms a retry returns the
original reference rather than posting twice.

**Proposed correction.** Convert to `useActionState`, or capture the result and
render an error alert on `!ok`.

---

### F-08 — MEDIUM — Idle session timeout falls back to a hardcoded 60 minutes for reset-link sessions

| | |
| --- | --- |
| Module | Session management |
| Files | `src/app/auth/callback/route.ts:22-34`; `src/middleware.ts:89-108`; `src/lib/session-timeout.ts:17,21-25` |
| On production `main` | Yes |
| Complexity | Low |

The SACCO's configured session timeout is written to the `bnd_idle_min` cookie
**only** in `admitOrRefuse()`, on the normal sign-in path
(`src/app/(auth)/actions.ts:118-121`). `/auth/callback`, which exchanges an
emailed link for a full session, sets neither `bnd_idle_min` nor `bnd_last_seen`.
The middleware's `idleMinutes(undefined)` then returns `DEFAULT_IDLE_MINUTES = 60`.

So a session created from a password-reset email is governed by a hardcoded 60
minutes regardless of the SACCO's setting. If the SACCO has tightened the
timeout to, say, 15 minutes for shared-counter devices, that hardening does not
apply to these sessions. Separately, the first request after the callback skips
the idle check entirely because `bnd_last_seen` is absent.

A related smaller gap: the `signOut()` **server action**
(`src/app/(auth)/actions.ts:199-206`) deletes only the install-prompt cookie,
while the `/auth/signout` **route** correctly deletes `bnd_last_seen` and
`bnd_idle_min`. The forms use the route, so this is latent.

**Proposed correction.** Set both cookies in `/auth/callback` using `getRules()`,
and delete them in the `signOut()` action as the route does.

---

### F-09 — MEDIUM — No Content-Security-Policy

| | |
| --- | --- |
| Module | HTTP security headers |
| File | `next.config.ts:30-44` |
| Evidence | `evidence/18-production-readonly.out` |

Production correctly sends `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy`, `Cache-Control: private, no-store` and —
added by Vercel — `Strict-Transport-Security: max-age=63072000`. There is **no
`Content-Security-Policy`**.

The current XSS surface is genuinely small: the only
`dangerouslySetInnerHTML` in the codebase injects a static constant
(`src/components/pwa/InstallEventCapture.tsx:41`), there is no `eval` or
`new Function`, and every `href` is an internal path or a sanitised `tel:`. So
this is defence in depth rather than a live hole — but for software holding
members' financial records, a CSP is the control that limits the damage of any
future injection, including one introduced by a compromised dependency.

**Proposed correction.** Add a nonce-based CSP (`script-src 'self' 'nonce-…'`,
`connect-src 'self' https://<project>.supabase.co`, `img-src 'self' data:
https://<project>.supabase.co`, `frame-ancestors 'none'`,
`base-uri 'self'`, `form-action 'self'`). Roll it out via
`Content-Security-Policy-Report-Only` first.

---

### F-10 — MEDIUM — Maintenance mode has no bypass token, so enabling it would lock everyone out

| | |
| --- | --- |
| Module | Infrastructure / maintenance mode |
| Files | `src/lib/maintenance.ts:45-59`; `src/middleware.ts:41-53` |
| Evidence | Vercel environment metadata — `MAINTENANCE_BYPASS_TOKEN` is not configured |

`MAINTENANCE_MODE` is configured (currently off — the site serves normally).
`MAINTENANCE_BYPASS_TOKEN` is **not configured at all**, and
`maintenanceBypassToken()` returns `null` for anything under 16 characters.
With no token there is no `maintainer` path through the gate, so switching
maintenance mode on would return a 503 to **everyone**, including SACCO staff
and whoever is performing the maintenance. Recovery would require editing
environment variables and redeploying — exactly what you least want mid-incident.

The code is honest that this is a valid choice ("there is then no way past the
page at all"), but the tool exists to be used during database work, and in its
current configuration using it is a self-inflicted outage.

**Proposed correction.** Set a ≥16-character random `MAINTENANCE_BYPASS_TOKEN`
for production **before** maintenance mode is ever switched on, and record the
bypass URL in the runbook. Test it on a preview deployment first.

---

### F-11 — MEDIUM — 14 dependency advisories, two reaching production runtime

| | |
| --- | --- |
| Module | Dependencies |
| Evidence | `evidence/17-npm-audit.json` |
| Totals | 11 high, 3 moderate, 0 critical, across 448 installed packages |

Recorded without upgrading anything, as instructed. The ones that matter:

| Package | Installed | Severity | Issue | Reaches |
| --- | --- | --- | --- | --- |
| `next` | 15.5.24 | moderate ×2 | Cache poisoning of SSG/ISR pages; SSG/ISR cross-user content substitution (GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p; affects `>=15.0.0 <15.5.27`) | production runtime |
| `sharp` | `<0.35.5` | **high** | librsvg vulnerability CVE-2026-96889 (GHSA-wq5f-xc86-pv6w) | production runtime (image optimisation) |
| `postcss` | `<=8.5.22` | high ×2 | Arbitrary `.map` file read via attacker-controlled `sourceMappingURL` | build time only |
| `braces`, `micromatch`, `brace-expansion`, `source-map-js`, `fast-glob`, `chokidar`, `postcss-selector-parser` | various | high/moderate | ReDoS / stack-exhaustion DoS | build time only (via `tailwindcss`, `eslint-config-next`) |

**Assessment.** The Next.js cache-poisoning advisories are rated against SSG/ISR
rendering; this application's build output is almost entirely `ƒ (Dynamic)
server-rendered on demand`, so real exposure is low — but the fix is a patch
bump and there is no reason to carry it. `sharp` is the one I would prioritise
after the P0 items: it processes member profile photos at runtime.

**Proposed correction.** `npm audit fix` resolves `next`, `sharp`, `postcss`,
`brace-expansion` and `source-map-js` without a breaking change. The remainder
are reachable only through `tailwindcss@3` and `eslint-config-next`, where the
offered fix is a major upgrade (`tailwindcss@4`); they are build-time DoS issues
and do not warrant that risk now. Re-run `npm audit` after each change and
re-run the full suite set.

---

### F-12 — MEDIUM — Git auto-deploy is disabled for `main`, so a merged security fix does not reach production by itself

| | |
| --- | --- |
| Module | Release process |
| File | `vercel.json:3-9` |
| Evidence | `vercel.json`; Vercel deployment list |

```json
"git": { "deploymentEnabled": { "feat/login-page-redesign": false, "main": false, "release/dashboard-redesign": false } }
```

Production deployments do happen — the current one is
`dpl_FTs6BNRW1cG69e9sm6n94aaonw1o` at `0cf56ab`, created manually, and I
verified it matches repository HEAD exactly. This is a deliberate controlled
release process and, as a practice, a reasonable one for a financial system.

It is recorded here because of its interaction with the rest of this report:
**merging the F-01 fix to `main` will not deploy it.** Someone must promote it,
and until they do, production stays vulnerable while the repository looks fixed.
Any remediation plan must carry an explicit deploy-and-verify step. Note also
that F-01's fix is a **migration**, which Vercel does not apply at all — it has
to be applied to the Supabase project separately.

**Proposed correction.** Keep the gate, but add the promotion step and a
post-deploy verification to the release runbook, and have the runbook name who
applies migrations and in what order relative to the deploy.

---

### F-13 — MEDIUM — No CI pipeline; the suites that exist are order-dependent and mutate shared state

| | |
| --- | --- |
| Module | Testing / CI-CD |
| Evidence | absence of `.github/workflows`; `evidence/13-numbering-accounts-pwa.out` |

There is **no `.github/workflows` directory and no CI configuration of any
kind.** For a repository with 471 SQL assertions, 11 SQL suites and ~20 browser
suites, nothing runs them automatically — not on push, not on pull request, not
before the manual production promotion. Every green result in this report
required a human (here, me) to run it.

The suites are also not isolated:

- `scripts/temp-password-check.mjs` ends by resetting its member to a temporary
  password ("the member is left on a temporary password nobody has seen"). Any
  later suite that signs that member in then fails. This is precisely what made
  `install-prompt-check` and `pwa-installability-check` fail in my run.
- `scripts/receiving-accounts-check.mjs` leaves behind the account it created
  (`ZZCHECK MTN Collections 703067`, deactivated rather than removed).
- `scripts/dashboard-production-check.mjs` cannot run outside a specific Next
  build layout.
- Several suites silently no-op when credentials are absent (printing "Set
  STAFF_EMAIL and STAFF_PASSWORD…" and exiting 0), so a CI run that forgot the
  secrets would look like a pass. **This is the dangerous one.**

**Proposed correction.** Add a GitHub Actions workflow that, on every pull
request, spins up PostgreSQL, applies all migrations, runs `typecheck`, `lint`,
`build`, `test:db`, `test:phone`, and the browser suites against a built app —
using the `documentation/source/test-stack/` harness that already exists and
works. Make a skipped suite a **failure**, not a pass. Make each suite restore
the state it changes, or give each its own database.

---

### F-14 — MEDIUM — No regression test covers F-01, despite a dedicated temporary-password security suite

| | |
| --- | --- |
| Module | Testing |
| Files | `scripts/temp-password-check.mjs`; `supabase/tests/members_access_test.sql:408,424` |
| Evidence | `evidence/11-access-and-temp-password.out` |

`scripts/temp-password-check.mjs` passes **16/16**, including the assertion
*"through the REST API the temporary password reads no records (0 rows)"*. That
is the right assertion. It is defeated by one RPC call that the suite never
makes. `supabase/tests/members_access_test.sql` does call
`log_password_changed()` — but to set up a *legitimate* password change, not to
test that it cannot be abused.

This is why F-01 survived a prior certification, and it is a finding in its own
right: a security control is covered by a test that cannot fail when the control
is broken.

**Proposed correction.** As described under F-01's regression tests. More
generally: for each security control, add at least one test that asserts the
control holds *under attempted bypass*, not merely that it holds when nobody
tries.

---

### F-15 — LOW — `account_ledger_entries.balance_after` is wrong for any backdated entry

| | |
| --- | --- |
| Module | Financial ledger |
| Files | `supabase/migrations/0027_cash_and_bank.sql:450-501` (`post_account_entry`), `:253` (column) |
| Evidence | `evidence/21-ledger-balance-after-ordering.out` |
| Status | **Latent — not currently displayed anywhere** |

`post_account_entry()` computes the stored running balance from the most recent
entry **by `id`** (insertion order):

```sql
select balance_after into v_prev from account_ledger_entries
 where account_id = p_account_id order by id desc limit 1;
```

Backdated entries are permitted (only future dates are blocked, by
`assert_not_future`), so insertion order routinely diverges from value-date
order. In the seeded data, **140 of 164 ledger entries are out of date order**,
and the stored column is visibly nonsensical when read chronologically:

```
 entry_date | money_in  | money_out | balance_after | running_balance
 2025-05-24 |  12000.00 |      0.00 |   50197000.00 |     50012000.00
 2025-07-10 |   5000.00 |      0.00 |   50185000.00 |     50017000.00   ← falls
 2025-08-26 |  20000.00 |      0.00 |   50180000.00 |     50037000.00   ← falls again
```

`balance_after` decreases across three successive money-**in** entries.

**Why this is LOW and not HIGH.** The `account_movements` view exposes both this
column and a correctly recomputed `running_balance` (a window function ordered
by `entry_date, id`), and **every screen reads `running_balance`** — the ledger
table, the account statement, the member ledger, the finance reports and the CSV
exports (`LedgerTable.tsx:81,162`, `Statement.tsx:34,128,183`,
`staff/finance/ledger/page.tsx:76`, `staff/members/[id]/ledger/page.tsx`,
`staff/finance/reports/page.tsx:266`). The account balances themselves are
derived by summation, not from this column, and reconcile exactly (invariants I2
and I3). The receipt's "savings balance after" is a different and correct
computation, ordered on `(occurred_on, created_at)`
(`0038_reference_numbering.sql:1255-1263`).

So nothing is wrong on screen today. What is wrong is that a stored,
immutable, authoritative-looking column named `balance_after` holds a value that
is not the balance after that entry — waiting for the next developer who
reasonably trusts its name.

**Proposed correction.** Either drop `balance_after` from the view and document
it as a posting-order artefact; or rename it (`balance_after_posting`); or stop
storing it and let `running_balance` be the only answer. Do **not** "fix" it by
recomputing stored history — the column is covered by an immutability trigger
for good reason.

---

### F-16 — LOW — 18 tap targets below 44px and 5 text runs at 9px, measured

| | |
| --- | --- |
| Module | Frontend accessibility |
| Evidence | `evidence/08-responsive-dom-audit.out` |
| Method | Real rendered DOM geometry at 320/360/375/390/430/768/1024/1440/1920px |

**33 of 45 viewport checks were completely clean, and there was no horizontal
page overflow at any width** — that is a good result for a system this dense
with financial tables. The defects found, by measurement rather than screenshot:

| Element | Measured | Widths |
| --- | --- | --- |
| Receipt document title "Official transaction receipt" | **9px** font | 320–430 |
| Member name heading-link | 28px high (168–312px wide) | all |
| Password visibility toggle (login) | 37×36 / 41×40 | 1024, 1440 |
| "Forgot Password?" link | 30px high | 1024–1920 |
| Carousel chevrons | 32×32 | 768, 1024 |

9px is below the floor for legibility, and on a printed receipt it is the line
that identifies what the document *is*. The 28–32px touch targets fall short of
the 44px minimum the project's own Tailwind config encodes as
`h-touch-target-min`.

Separately, `dashboard-accessibility-check` passed all 22 checks (keyboard
navigation across four staff dashboards, account-menu keyboard operation,
mobile branding, loading/error/empty presentation), and the responsive suites for
member, staff, overview and super-admin dashboards passed at every width from
320px to 1855px.

**Proposed correction.** Raise the receipt title to ≥11px (print and screen),
and give the five named controls the existing `h-touch-target-min` /
`min-h-touch-target-min` utilities.

---

### F-17 — LOW — `notFound()` returns HTTP 200 instead of 404 (soft-404)

| | |
| --- | --- |
| Module | Routing |
| On production `main` | Yes |

Verified with a real staff session against a production build: a genuinely
unknown route (`/nonexistent-route-xyz`) correctly returns **404**, but routes
that call `notFound()` in the page body return **HTTP 200** while rendering the
"We could not find that page" body — `/dev/preview*` (production guard),
`/transactions/<another member's id>`, `/loans/<unrelated id>`.

**Security impact: none.** I checked this specifically, because a 200 on
`/dev/preview*` initially looked like the design-preview harness being exposed
in production. It is not: the guard fires and the preview content is never
rendered. Likewise the record-level cases return the not-found page with no
financial figures (F-18 below). The cost is operational: error-rate monitoring
and crawlers both see success where a record was refused or absent.

**Proposed correction.** Where practical, resolve the record before streaming
begins so `notFound()` can set the status, or render these refusals through a
route handler that sets 404 explicitly.

---

### F-18 — LOW (positive finding, recorded for completeness) — Record-level access control verified correct

Not a defect. Recorded because it is a load-bearing control and the brief asks
for evidence rather than assurances. Probed in a browser with three distinct
member identities against a production build:

| Attempt | Result |
| --- | --- |
| Member reads own transaction | visible, figures shown |
| Member reads **another member's** transaction by UUID | not-found page, **no figures** |
| Member reads a random UUID transaction | not-found page |
| Member reads a loan they are an **accepted guarantor** on | visible — correct, per migration `0042` |
| Member (neither borrower nor guarantor) reads that same loan | not-found page, **no figures** |
| Member opens any `/staff/*` route | redirected to the member dashboard |

The guarantor case is worth naming: migration `0042_guarantor_sees_borrower.sql`
deliberately lets a guarantor see the loan they stand for, and the seed makes
`BND26001` a guarantor on 7 of 8 loans. A member appearing to "see all loans" is
therefore correct behaviour, not a leak — I verified each row against
`loan_guarantors` before concluding that (`evidence/06-loan-rls-verification.out`).

---

### F-19 — LOW — Dead `SECURITY DEFINER` role helpers remain callable and ignore the temporary-password lock

| | |
| --- | --- |
| Module | Database authorization |
| Objects | `has_role(variadic user_role[])`, `assert_role(variadic user_role[])` |

Zero live functions and zero RLS policies reference either helper — every
`assert_role` call site from migrations `0002`, `0003`, `0006` and `0018` has
been superseded by a later `create or replace` that uses `assert_permission()`
or `assert_capability()`. They are dead code.

They are also still granted to `authenticated`, and — unlike their successors —
`has_role()` does **not** test `must_change_password`:

```sql
select exists (select 1 from app_users
                where id = auth.uid() and is_active and role = any (p_roles::text[]));
```

Migration `0034` added that test to `is_staff_user()`, `has_permission()` and
`current_member_id()` and did not add it here. Calling them today grants
nothing, but anything built on them in future would silently reopen the
temporary-password hole that F-01 is about.

This is also where I nearly filed a false critical finding: migration `0018`
gates `disburse_loan` on `assert_role('super_admin','manager')`, which would
have been reachable by a staff account on a temporary password. The **live**
definition comes from migration `0041` and gates on
`assert_permission('loans.disburse')`, which does honour the lock. Reading a
superseded migration as if it were current would have been wrong.

**Proposed correction.** `drop function has_role(variadic user_role[])` and
`assert_role(variadic user_role[])`. If they are kept, add
`and not must_change_password` to `has_role()` so the two gate families agree.

---

### F-20 — LOW — Identical cash collections under different idempotency keys are accepted with no near-duplicate warning

| | |
| --- | --- |
| Module | Collections |
| Evidence | `evidence/04-concurrency-tests.out`, test T3 |
| Status | By design; recorded as residual operational risk |

For merchant and bank collections the system is strict: a provider or bank
reference is mandatory, and a reference already recorded against a non-reversed
transaction is refused outright (`unique_violation`). For **cash** no external
reference exists, so nothing prevents the same physical payment being keyed
twice under two different idempotency keys. Test T3 confirmed: two identical
9,000 savings collections posted, 18,000 moved.

This is correct behaviour for an idempotency key — two keys mean two
submissions. It is not a bug. It is the one remaining way a genuine duplicate
payment can enter the books, and it is worth the SACCO knowing about explicitly,
because it is a counter-procedure question rather than a code question.

**Proposed correction (optional).** Warn, do not block: when a collection
matches an existing posted transaction on member, type, amount and date, show
the cashier a "this looks like a payment already recorded at 10:42 — reference
SAV261022091" confirmation step. Keep the ability to proceed, since a member
genuinely may pay the same amount twice in a day.

---

## E. Financial integrity assessment

**Verdict: sound.** This is the strongest part of the system and it was tested
hardest.

### Invariants and reconciliation — all held

Every check below ran against the full seeded schema
(`evidence/03-accounting-invariants.out`):

| | Check | Result |
| --- | --- | --- |
| I1 | Every posted/reversal transaction has a ledger entry | 0 missing |
| I2 | Stored latest `balance_after` vs recomputed account balance | exact on all 3 accounts |
| I3 | `financial_account_balances` view vs ledger summation | exact |
| I5 | Duplicate transaction references | none |
| I6 | Duplicate external references on non-reversed transactions | none |
| I7 | Negative member savings balances | none |
| I8 | `savings_periods.paid_amount` vs posted `savings_payments` | no divergence |
| I9 | `loan_schedule` sums vs `principal` / `interest_amount` / `total_payable` | exact on every loan |
| I10 | `loan_balances.outstanding` vs `total_payable` − posted repayments | exact |
| I11 | Orphans (savings/shares/repayments/receipts/ledger without a transaction; members without a fee charge) | 0 across all six |
| I12 | Reversal pairing: `reversed_by_id`, `reverses_id`, equal amounts, **net ledger effect zero** | 0 anomalies |
| I13 | Share capital: `share_lots` vs posted `share_purchase` transactions | 3,450,000.00 = 3,450,000.00 |

I4 found 140 entries out of date order, which is F-15 — latent, not a live
discrepancy.

### Money mathematics

- **Loan pricing.** `quote_loan()` implements flat interest as
  `principal × rate × years` and reducing-balance as the standard annuity
  `P·r / (1 − (1+r)^−n)` with `r` divided by payments per year, not by twelve.
  Both are correct. `installment_count` derives from the product's repayment
  frequency (daily 365/12, weekly 52/12, biweekly 26/12, monthly 1).
- **Schedule rounding.** `disburse_loan()` builds the amortisation once, at
  disbursement, with the final installment absorbing rounding
  (`principal − per_installment × (n−1)`) for principal, interest and total
  independently. Because `total_payable = principal + interest_amount`, the
  three agree, and invariant I9 confirms every schedule sums exactly.
- **Fees are read from the loan, not the product** — `0018_loan_engine.sql:534`
  comments it precisely: *"a fee raised since this loan was agreed is not a fee
  this member consented to."* Correct, and the kind of detail that distinguishes
  careful financial software.
- **Decimal handling.** `numeric(16,2)` throughout; no floating point in any
  money path. 22 money-formatting unit tests pass, including `0.02`,
  `99999999.99` and repeating-decimal cases like `196666.67` and `536666.65`.
- **Loan products are configuration, not constants.** Interest rates, methods,
  fees, periods and guarantor requirements all live in `loan_products`. I did
  not assume any rate; `quote_loan` reads the product row.
- **Savings rules verified as configured, not assumed.** The flexible-savings
  model of migration `0043` is live: a savings target cannot be set
  (*"Monthly savings are open: a member saves any amount they choose"*), two
  deposits in one month aggregate without either being treated as a part
  payment, and a month with any savings in it owes nothing. The minimum-balance
  rule (UGX 20,000) is enforced on withdrawal by
  `savings_payment_minimum_gate`.

### Reversals

The reversal path is the strongest single piece of logic in the system. It
refuses a reversal dated in the future or before the original; requires a
reason; refuses to reverse a disbursement that has repayments against it;
recomputes the affected savings period's `paid_amount` and status; reopens a
completed loan and restores each guarantor to the standing they actually had
(*"Consent is never invented"* — `0038_reference_numbering.sql:352`); and
recursively reverses the fees booked out of a disbursement. Verified: a
disbursement reversal returns the till to the exact prior balance
(55,246,666.69 vs 55,246,666.69), the schedule is deleted, the loan returns to
`approved`, and no standing fee remains.

### Duplicate payment and concurrency safety

All six adversarial tests passed (`evidence/04-concurrency-tests.out`). The two
mechanisms that earn this:

1. **`post_account_entry()` takes `SELECT … FOR UPDATE` on the
   `financial_accounts` row before computing the new balance.** Postings to one
   account therefore serialise, which is why twelve concurrent postings left the
   stored running balance exact (0 rows disagreeing with the cumulative sum).
2. **A unique partial index on `transactions(idempotency_key)`**, combined with
   a stable per-form-instance key regenerated only after success. A retry
   returns the original row and reference rather than posting again.

Document numbering was also tested under concurrency: 240 member numbers and 240
transaction references issued simultaneously from 24 connections were all
distinct, contiguous, correctly formatted, and never collided with each other.

**Residual risk:** F-20 (duplicate cash collection under a second key) and F-05
(register totals past 1,000 members).

---

## F. Security assessment

### Authentication

One unified sign-in for members and staff: `login_resolve()` identifies
candidate accounts from a member number, phone or email, Supabase Auth proves
the password, and `my_session()` — not the form — decides the role. Account
standing (inactive, suspended, role switched off) is re-checked after the
password proves out, and the session is signed back out if refused, so nothing
is left half-open. Failed and successful attempts are recorded with the client
address; `login_lock_state()` provides lockout with a configurable window. The
forgot-password response is deliberately identical whether or not the identifier
exists, so the form reveals nothing. Password changes require re-authentication
with the current password, so an unattended unlocked phone cannot take over an
account.

That is a well-built authentication system. **Its one defect is F-01, and F-01
is enough to make the whole temporary-password design ineffective.**

Also: F-03 (reset redirect from a controllable header), F-04 (non-atomic reset),
F-08 (idle timeout on reset-link sessions).

### Authorization and RLS

**Correct everywhere I could test it.** Three independent layers, and the
database layer is genuinely the authority:

- `requirePermission()` / `can()` in server actions — so the screen can refuse
  politely.
- `assert_permission()` / `assert_capability()` inside every mutating RPC — the
  check that actually holds. I enumerated all 118 `SECURITY DEFINER` functions
  executable by `authenticated` and traced the gate on each. Every mutating one
  is gated. The handful that look ungated are either correctly self-scoped
  (`mark_notifications_read` writes only `where user_id = auth.uid()`), public by
  design (`sacco_public_brand`, `share_unit_price`), or gate through
  `assert_capability()`, which my first pass's regex missed.
- RLS on **every one of the 41 tables**.

The nine-role × twenty-probe matrix (`evidence/05-authorization-matrix.out`)
behaved correctly in every cell. Highlights: a member sees exactly 1 member
record; `account_ledger_entries` and `financial_accounts` are invisible to
`member`, `viewer`, `field_officer` and `loan_officer` and visible to `cashier`,
`accountant`, `admin`, `manager`, `super_admin`; `audit_logs` only to
`accountant` and above; `login_attempts` to nobody through the API; no role at
all — not even `super_admin` — can grant itself a permission
(`set_role_permissions`) or change its own role (`set_user_role`); reversal and
disbursement are confined to `admin`/`manager`/`super_admin`. Approvals enforce
segregation of duties via `assert_can_approve(creator)`.

The capability gates even refuse the database owner when there is no
`auth.uid()` — calling `dashboard_metrics()` as `postgres` raises *"You do not
have permission to view the dashboard"*. That is a good sign that the checks are
real rather than decorative.

Record-level access is correct (F-18). Members cannot reach `/staff/*`. Sign-out
leaves no protected page in the back/forward cache (`Clear-Site-Data`,
`no-store`).

### Application security

| Surface | Finding |
| --- | --- |
| SQL injection | No dynamic SQL built from user input in the application; every write goes through a parameterised RPC. PL/pgSQL functions use parameters, not string concatenation. |
| XSS | One `dangerouslySetInnerHTML`, injecting a **static constant** (`InstallEventCapture.tsx:41`). No `eval`, no `new Function`. All input validated with zod. |
| CSRF | Next.js server actions carry origin checks; sign-out is POST-only ("a link or an image tag must not be able to sign somebody out"). |
| IDOR / broken access control | Tested directly — none found (F-18). |
| Open redirect | `safeNext()` requires a leading `/` and rejects `//`; `/auth/callback` applies the same rule. Correct. **But see F-03** for the reset-email redirect, which is a different and real path. |
| Secret exposure | `SUPABASE_SERVICE_ROLE_KEY` is server-only and the repository documents why importing it client-side is a build error. Zero occurrences of `service_role` in the production page HTML. **But see F-02** — the key is scoped to preview too. |
| Security headers | 4 present + HSTS from Vercel; **no CSP** (F-09). |
| `SECURITY DEFINER` functions | All 118 reviewed; all set `search_path = public`; all mutating ones gated. One dead pair to remove (F-19). |
| Unrestricted RPCs | None found beyond the intentionally public brand/price readers. |
| Rate limiting | Login lockout implemented in the database and configurable. No rate limiting on other endpoints (Vercel/Supabase platform limits only). |
| Sensitive logging | No passwords, tokens or keys written to logs. Temporary passwords are returned once to the issuing screen and never stored in readable form. |
| File uploads | Storage bucket with a 5 MB cap and a bucket policy; `attach_finance_document` is permission-gated. Not exercised end to end in this audit. |
| Dependency vulnerabilities | F-11. |

**Not tested, by instruction:** no destructive scanning, no credential attacks,
no exploitation attempted against the live site. The F-01 exploit was run only
against synthetic accounts in the disposable stack.

---

## G. Database assessment

**Verdict: strong.**

- **Migrations.** All 48 apply cleanly to an empty database in order; a full
  clean installation (bootstrap → 48 migrations → first administrator → seed)
  produces 12 members, 143 transactions, 8 loans, 3 loan products, 3 financial
  accounts, 9 roles, 39 permissions. The migration set is cumulative and uses
  `create or replace` to supersede earlier definitions — which is why reading an
  old migration as current is a trap (see F-19).
- **Constraints.** Rich and meaningful, not decorative:
  `account_ledger_entries_one_side CHECK ((debit > 0) <> (credit > 0))`
  guarantees single-sided entries; `account_ledger_entries_once UNIQUE
  (transaction_id, account_id)` prevents duplicate postings; non-negative debit
  and credit; `ON DELETE RESTRICT` on both ledger foreign keys so no transaction
  or account carrying postings can be removed.
- **Immutability.** `transactions` and `account_ledger_entries` carry
  BEFORE UPDATE OR DELETE guard triggers. Completed financial records cannot be
  altered. `fees`, `member_fees`, `fee_payment_lines` and
  `member_profile_changes` are append-only or never-deleted.
- **Indexes.** **Every single-column foreign key has a supporting index** and
  every table has at least one index — I checked exhaustively
  (`evidence/16-query-plans.out`, P1/P2 both returned zero rows). Transactions
  are indexed on `(member_id, occurred_on desc, created_at desc)`,
  `(type, occurred_on desc)`, `(occurred_on desc)`, `loan_id` (partial), and a
  GIN trigram index on `reference` for search. Ledger entries on
  `(account_id, entry_date, id)` and `(account_id, id desc)`.
- **Transaction atomicity.** Money movements run inside single RPC calls, so
  each is one database transaction. Row locks (`FOR UPDATE`) are taken on the
  account, the loan and the member where appropriate. Partial completion is not
  possible within a posting.
- **Timezone.** The database runs Africa/Kampala, asserted by the suite.
- **Views.** 17, correctly filtering `status = 'posted'` where that matters —
  `member_shares` and `member_savings` both exclude reversed transactions, which
  is why reversing a share purchase correctly removes it from share capital.

**Issues:** F-06 (`member_financials` scan shape), F-15 (`balance_after`
ordering), F-19 (dead helpers).

---

## H. Frontend assessment

**Verdict: good, with minor accessibility defects.**

- **No horizontal overflow at any tested width** (320→1920px) on any public
  page or the design preview. For a system this full of financial tables, that
  is the headline result.
- **Dashboards** pass at every width from 320px to 1855px: member (13 checks),
  staff loans/finance/collections (22), overview (11), super-admin (7) — each
  asserting labels, amounts, navigation, absence of overflow and absence of
  browser runtime errors.
- **Accessibility:** 22/22 on keyboard navigation across four staff dashboards,
  account-menu keyboard operation, mobile branding and loading/error/empty
  presentation. Defects are the measured tap-target and font-size shortfalls in
  F-16.
- **Receipts:** comprehensively correct — see §A and `evidence/09-receipt-and-print.out`.
  13 transaction categories, reversed and reversal states (which display a
  prominent banner and suppress the balance line, so **no receipt reports
  success for a reversed transaction**), long names, large amounts, missing
  optional values, 6 payment methods, 22 A4 PDF cases, one page, print chrome
  hidden. Account names are gated on finance permissions, so a member's receipt
  never names a SACCO wallet.
- **Client state:** every mutation but one renders both outcomes via
  `useActionState`; `FinancialForm` wraps all money movements in a
  confirm → disable → stable-idempotency-key → state-the-outcome →
  show-the-reference → offer-the-receipt flow. The exception is F-07.
- **Bundle size:** 103 kB shared JS, heaviest page 239 kB. Appropriate for
  low-end Android on 3G, which the code comments show was a deliberate target.
- **PWA:** manifest valid, standalone, 192/512/maskable icons all served as
  images, service worker served with `Service-Worker-Allowed: /`, and **Chrome
  reports no installability errors and fires a real `beforeinstallprompt`**.
  (The service worker registers only in production builds, by design.)

---

## I. Production infrastructure assessment

### Verified

- **Deployment SHA consistency: exact.** Production deployment
  `dpl_FTs6BNRW1cG69e9sm6n94aaonw1o` → `githubCommitSha
  0cf56aba7d22bc946128fb9bd20ebe7b80ff39c4` on `main`, state `READY`, matching
  repository HEAD and the stated deployed commit. The previous five production
  deployments were also all from `main`, with a clean lineage.
- **Rollback is available:** the two most recent production deployments are
  marked `isRollbackCandidate: true`.
- **Public surface is correctly closed.** `/` and every protected route return
  307 to `/login` with the destination preserved; `/dev/preview*` is unreachable;
  `/admin` redirects; the maintenance bypass route mints nothing while
  maintenance is off; no `service_role` string in the served HTML.
- **Headers:** `strict-transport-security: max-age=63072000` (Vercel),
  `x-frame-options: DENY`, `x-content-type-options: nosniff`,
  `referrer-policy`, `permissions-policy`, and
  `cache-control: private, no-cache, no-store` on authenticated shells.
- **Environment variables:** five configured, `hiddenProductionEnvCount: 0`,
  no `securityIssues` flagged by Vercel. I read **metadata only — no value was
  decrypted.**

### Risks

- **F-02** — production/preview share the service-role key and database URL.
  This is the most serious infrastructure finding.
- **F-03** — `NEXT_PUBLIC_SITE_URL` is unset.
- **F-10** — `MAINTENANCE_BYPASS_TOKEN` is unset.
- **F-12** — Git auto-deploy disabled for `main`; promotion is manual, and
  migrations are a separate step Vercel does not perform.
- **F-13** — no CI, so nothing is verified automatically before promotion.
- **Monitoring and alerting:** no error-reporting integration (no Sentry or
  equivalent) is present in the codebase, and no log drain is configured. Errors
  surface as Vercel runtime logs only, with nobody alerted. F-17's soft-404s
  would further mask genuine refusals in any error-rate metric.

### Recovery — assessed, not tested

Supabase's Free tier does not provide the managed point-in-time recovery of paid
tiers; scheduled backups and PITR are paid features. For a system holding real
member savings, shares and loan balances, that is the single largest
**business** risk in this report, even though it is not a software defect:

- There is no automated backup of the SACCO's financial records that this audit
  could identify, and no restore procedure documented in the repository.
- I did **not** export, read, or attempt to back up any production data, and I
  did not inspect the hosted project's settings (not reachable from this
  session). The statement above is about the tier's documented capabilities and
  the absence of any backup tooling or runbook in the repository — not an
  observation of the live project's configuration.

**Recommendation.** Either move to a Supabase tier with PITR, or establish a
scheduled, encrypted, off-site `pg_dump` with a **tested** restore — the restore
test being the part that matters, and one that can be rehearsed entirely against
a disposable database using the harness this audit used. Treat this as a
business-continuity decision for the SACCO's committee, not just a technical one.

---

## J. Remediation roadmap

Nothing below has been applied. Each item is a recommendation for your approval.

### P0 — Emergency: security and financial integrity

| # | Finding | Action | Depends on |
| --- | --- | --- | --- |
| 1 | **F-01** | **First, confirm on the hosted schema** with one read-only query: `select prosrc from pg_proc where proname = 'log_password_changed';` — if it contains `must_change_password = false`, the defect is live. | — |
| 2 | **F-01** | Apply the fix as a new migration (recommended variant: strip flag-clearing from `log_password_changed()`, clear the flag from a service-role-only function called after `updateUser()` succeeds; then revoke `log_password_changed` from `authenticated`). | 1 |
| 3 | **F-01** | Add both regression tests (SQL + the `temp-password-check` bypass step) **before** deploying, so the fix is proven. | 2 |
| 4 | **F-01** | Deploy: apply the migration to Supabase, **then** promote the Vercel deployment (F-12 — this will not happen automatically). Re-run the end-to-end reproduction against the isolated stack to confirm it now fails. | 2, 3, F-12 |
| 5 | **F-01** | Interim mitigation while 1–4 are in progress: reset the password of any account currently showing `must_change_password = false` whose `password_set_at` is not corroborated by a sign-in afterwards; brief staff that a temporary password must be handed over and changed in the member's presence. | — |
| 6 | **F-03** | Check the Supabase redirect allow-list **now** — this is a five-minute check that decides whether F-03 is critical or latent. Then set `NEXT_PUBLIC_SITE_URL` for production and rebuild. | — |
| 7 | **F-02** | Re-scope `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` to `production` only; create a staging Supabase project for preview; **rotate the production service-role key**; enable preview Deployment Protection. | — |

> Order matters: do 6 before 7, because rotating the service-role key (7) requires a redeploy and you want the `NEXT_PUBLIC_SITE_URL` change (6) to ride along in the same build.

### P1 — High-priority reliability

| # | Finding | Action |
| --- | --- | --- |
| 8 | **F-13** | Add the GitHub Actions workflow (migrations + typecheck + lint + build + `test:db` + browser suites). Make a skipped suite fail. This protects every item below. |
| 9 | **F-14** | Extend security coverage to bypass-attempt tests generally, not just F-01's. |
| 10 | **F-04** | Reorder `resetUserPassword` so the credential changes before the flag and the audit entry. |
| 11 | **F-10** | Set `MAINTENANCE_BYPASS_TOKEN` before maintenance mode is ever used; document the bypass URL. |
| 12 | **F-11** | `npm audit fix` for `next`, `sharp`, `postcss`, `brace-expansion`, `source-map-js`. Leave the `tailwindcss@4` major alone for now. |
| 13 | **F-12** | Write the release runbook: migration first, then promotion, then post-deploy verification, with named owners. |
| 14 | — | Add error reporting and alerting (Sentry or equivalent) and a Vercel log drain. Nobody is currently told when production breaks. |
| 15 | **Recovery** | Decide the backup position (tier with PITR, or scheduled `pg_dump` plus a *tested* restore). Committee decision. |

### P2 — Functional and performance

| # | Finding | Action |
| --- | --- | --- |
| 16 | **F-05** | Compute register totals in the database; paginate; stream the CSV unbounded. |
| 17 | **F-07** | Surface `markNotificationsRead`'s failure state. |
| 18 | **F-08** | Set the idle cookies in `/auth/callback`; clear them in the `signOut()` action. |
| 19 | **F-09** | Roll out a nonce-based CSP, report-only first. |
| 20 | **F-06** | Add the covering index on `transactions(member_id, status, type)`; collapse the duplicated share aggregation; revisit materialisation when membership approaches four figures. |
| 21 | **F-20** | Add the near-duplicate warning to cash collections (warn, never block). |
| 22 | **F-17** | Return real 404s for refused and absent records. |

### P3 — Cosmetic and maintainability

| # | Finding | Action |
| --- | --- | --- |
| 23 | **F-16** | Receipt title to ≥11px; five controls to the existing 44px utilities. |
| 24 | **F-15** | Rename or retire `balance_after`; never recompute stored history. |
| 25 | **F-19** | Drop `has_role()` and `assert_role()`. |
| 26 | — | Remove the unused `Icon` import in `src/components/staff/FinancialActivity.tsx:1`. |
| 27 | **F-13** | Make each suite restore the state it mutates; give `receiving-accounts-check` the fixtures it expects, or make it create them. |

### Dependency map

```
F-01 fix ──┬─ needs regression tests (P0-3) before deploy
           └─ needs the manual promotion + migration step (F-12) to reach production
F-03 fix ──── rebuild required (build-time inlined variable)
F-02 fix ──┬─ needs a staging Supabase project first
           └─ key rotation ⇒ redeploy  ⇒ batch with F-03
F-13 (CI) ─── protects every later item; do it early
F-06 ──────── measure again after F-05, which changes the query shape
```

### Regression tests required, by finding

| Finding | Test |
| --- | --- |
| F-01 | SQL: flag survives `log_password_changed()` on a locked account. E2E: REST reads 0 rows after the bypass attempt. |
| F-02 | CI assertion that no `production`-scoped secret is also scoped to `preview`. |
| F-03 | Unit: reset `redirectTo` ignores the `Origin` header when `NEXT_PUBLIC_SITE_URL` is set. |
| F-04 | Failure-injection: `updateUserById` fails ⇒ `must_change_password` unchanged and no audit row. |
| F-05 | Seed 1,001 members; assert totals and CSV row count cover all of them. |
| F-07 | Action returns `!ok` ⇒ an error alert renders. |
| F-08 | Session created via `/auth/callback` carries the configured timeout. |
| F-20 | Near-duplicate collection shows the warning and still allows an override. |

---

## K. Final verdict

**HIGH RISK.**

Not CRITICAL: there is no evidence of financial data corruption, no confirmed
unauthorized financial transaction, no broken ledger, and no mass data exposure.
Every accounting invariant held exactly, every concurrency test passed, and the
authorization model was correct in every cell I could test. The money is being
counted correctly.

Not merely OPERATIONAL WITH RISKS: F-01 is a confirmed, reproduced authentication
bypass that defeats the control standing between a staff-issued temporary
password and a member's or colleague's full account — and it makes the audit
trail state the opposite of what happened. F-02 puts RLS-bypassing credentials
for the live financial database into every preview deployment. F-03 may be an
unauthenticated account-takeover path depending on one setting I could not read.
Those three, together, are urgent.

The distance between this verdict and HEALTHY is small and almost entirely
configuration plus one function. The engineering underneath is better than the
verdict suggests: immutable transactions, a locked-row ledger, idempotency keys
that actually work, segregation of duties on approvals, RLS on every table,
471 passing assertions, and comments in the migrations that explain *why* rather
than *what* — *"Consent is never invented"*, *"a fee raised since this loan was
agreed is not a fee this member consented to"*. That is the work of someone
who understood the domain.

**Two cautions on how to read this report.**

First, a passing test suite is not proof that production is free of defects.
F-01 is the proof of that: a dedicated temporary-password security suite passes
16/16 while the bypass stands open, because the suite never attempts it. Prior
certification of this system did not establish its security; it established that
the things it checked behave as expected.

Second, this audit did not read the SACCO's live database. Everything here comes
from the repository, a faithful disposable rebuild of its schema, the running
application, and read-only observation of the public site and deployment
metadata. Where that limits a conclusion — above all F-01's presence on the
hosted schema and F-03's exploitability — I have said so rather than rounding up
to certainty. Both resolve with a single read-only check, listed first in the
P0 roadmap.

---

### Confirmation of non-interference

During this audit I did **not**:

edit production financial data · execute any production migration · change RLS,
permissions or authentication configuration · modify any account password ·
create any transaction in production · reverse any real transaction · run
destructive or credential-based scanning against the live site · disable any
security control · deploy, promote or roll back any Vercel deployment · change
any environment variable · merge anything into `main` · modify any business
rule · export or disclose any confidential member data · place any production
credential in a log, a report or an evidence file.

Everything executed ran against a disposable local PostgreSQL cluster with the
repository's own synthetic seed data. Live-site interaction was limited to
unauthenticated HTTP GET/HEAD requests to public paths. Vercel and Supabase were
read for metadata only; **no environment-variable value was decrypted**, and the
SACCO's Supabase project was never reachable from this session. The only
repository changes are this report and the files under `docs/audits/evidence/`,
committed on the audit branch `claude/cool-sagan-afkvit`.

---

### Evidence index

| File | Contents |
| --- | --- |
| `01-bkc01-proof.sql` / `.out` | F-01 SQL proof of concept; data visibility 0 → 15 rows |
| `02-bkc01-end-to-end-rest.out` | F-01 reproduced over the Supabase REST API |
| `03-accounting-invariants.sql` / `.out` | 13 invariant and reconciliation checks |
| `04-concurrency-tests.mjs` / `.out` | 6 concurrency / idempotency / duplicate-payment tests |
| `05-authorization-matrix.mjs` / `.out` | 9 roles × 20 probes, plus cross-member isolation |
| `06-loan-rls-verification.out` | Guarantor visibility verified row by row |
| `07-sql-suites.out` | 471 assertions, 11 suites |
| `08-responsive-dom-audit.out` | DOM geometry at 9 viewport widths |
| `09-receipt-and-print.out` | Receipt and A4 PDF suites |
| `10-ui-suites.out` | Dashboard, member, staff, overview, super-admin suites |
| `11-access-and-temp-password.out` | Route access matrix; temporary-password suite |
| `12-finance-fees-expenses.out` | Finance routes, membership fees, expense lifecycle |
| `13-numbering-accounts-pwa.out` | Concurrent numbering; receiving accounts; PWA |
| `14-unit-suites.out` / `15-...-corrected.out` | Unit suites, before and after correcting my harness |
| `16-query-plans.out` | `EXPLAIN ANALYZE`, index coverage |
| `17-npm-audit.json` | Full dependency advisory report |
| `18-production-readonly.out` | Read-only observation of the live site |
| `19-typecheck.log` / `20-lint.log` | Static analysis |
| `21-ledger-balance-after-ordering.sql` / `.out` | F-15 demonstration |

---

*Prepared as an independent technical audit. All findings are evidence-based;
where a cause is inferred rather than proven, the report says so. No remediation
has been applied, and none should be until this report has been reviewed and
approved.*
