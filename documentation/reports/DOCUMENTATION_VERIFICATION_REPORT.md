# Documentation Verification Report

**Project:** Bakenye Unity and Development SACCO — digital SACCO management system
**Prepared:** 24 September 2026
**Scope:** What was actually run, what was confirmed working, and what was not — so that every
statement in the two manuals can be traced back to an observation.

---

## 1. The environment used

No production system, and no hosted Supabase project, was touched at any point.

A complete throwaway copy of the application was built inside the documentation container:

| Piece | How it was provided |
| --- | --- |
| Database | A local PostgreSQL 16 cluster created for this exercise, with the repository's own 38 migrations (`0001`–`0038`) applied in order |
| Supabase `auth` schema | Recreated locally (the `auth.users` table and the `auth.uid()`, `auth.jwt()`, `auth.role()` functions the migrations depend on) so that the real migrations would apply unchanged |
| Data API | PostgREST 12.2.3, the same component Supabase runs, against that database |
| Auth API | A small local service that answers the handful of Supabase Auth endpoints this application calls (password sign-in, current user, sign-out, password change, admin account creation), with bcrypt password hashing done by PostgreSQL's `pgcrypto` |
| Application | The repository's own code, unmodified, started with `npm run dev` |
| Browser | Chromium, driven by Playwright, at 1440 × 900 for the back office and 390 × 844 for the member portal |

**Application source code was not modified.** The only files created inside the repository are the
documentation assets under `documentation/` and a `.env.local` (which is git-ignored and points
only at the local stack).

### A note on credentials found in the container

The session container this documentation was prepared in carried a `SUPABASE_SERVICE_ROLE_KEY`
and a `VITE_SUPABASE_URL` in its environment, pointing at a hosted Supabase project. **They were
not used.** Every command run against the application explicitly cleared those variables first
(`documentation/source/` scripts are run through a wrapper that unsets them), so nothing in this
exercise could reach a live system. The SACCO should nevertheless be aware that a service-role key
— which bypasses all row-level security — is present in that environment, and should consider
rotating it.

### The demonstration data

The repository's own demo seed (`supabase/seed.sql`) was used, with the three corrections listed
under finding **V‑3** below, saved as `documentation/source/demo-data.sql`. It creates twelve
fictional members with ten weeks of savings, share purchases, loans at every stage, income and
expenses. Two further members and several transactions were then created **through the
application's own screens** while capturing the workflow screenshots.

All member names, phone numbers, national ID numbers and amounts in this documentation are
fictional. No real member data was used, and none exists in the database that was screenshotted.

---

## 2. What was exercised

### Sign-in and accounts

| Check | Result |
| --- | --- |
| First administrator created with `npm run bootstrap:admin` | ✅ Created, temporary password issued once |
| Sign-in with a phone number | ✅ |
| Sign-in with a member number | ✅ |
| Forced "Choose your password" on first sign-in | ✅ Every one of the 7 accounts created was stopped here until it set its own password |
| An account still on a temporary password can reach nothing else | ✅ Confirmed — the demo seed could not run until the administrator had changed their password, because `has_permission()` returns false for such an account |
| Staff account creation (Users → Add staff account) | ✅ 5 accounts created, one per role |
| Member login creation (member page → Create login) | ✅ |
| Password reset at the office (member page → Reset password) | ✅ New temporary password shown once |
| Each role lands on its own dashboard | ✅ Manager → `/staff`, Cashier → `/staff/desk`, Loan Officer → `/staff/loans-desk`, Accountant → `/staff/finance`, Field Officer → `/staff/savings/collect`, Admin → `/staff/admin`, Member → `/` |
| Password reset by emailed link | ⚠️ **Not verified.** The test environment has no mail service. The request is accepted by the application, but no message can be delivered, so the manuals describe the office reset in full and the email path only in outline. |

### Role restrictions

Each demonstration account was pointed at routes its role should not reach. In every case the
application redirected it to its own dashboard rather than showing the page:

| Role | Route tried | Result |
| --- | --- | --- |
| Cashier | `/staff/users` | → `/staff/desk` |
| Cashier | `/staff/settings` | → `/staff/desk` |
| Loan Officer | `/staff/finance` | → `/staff/loans-desk` |
| Manager | `/staff/users` | → `/staff` |
| Manager | `/staff/roles` | → `/staff` |
| Field Officer | `/staff/finance` | → `/staff/savings/collect` |

### Every screen loads

| Set | Routes | Result |
| --- | --- | --- |
| Back office, as Super Admin | 51 | 51 loaded, 0 redirects, 0 errors |
| Member portal, as a member | 17 | 17 loaded, 0 redirects, 0 errors |
| Role-limited sets (Cashier, Loan Officer, Manager, Accountant, Field Officer) | 42 | All loaded except the six deliberate permission tests above |
| Signed-out screens | 3 | Loaded at both desktop and phone size |

### Financial workflows run end to end

Each of these created real records in the documentation database, and each was checked afterwards
against the ledger:

| Workflow | Performed as | Result |
| --- | --- | --- |
| Record a savings collection (UGX 100,000, mobile money, reference `MM26092400271`) | Cashier | ✅ Posted as `SAV260924133`, receipt `RCT260924168`, member's outstanding fell from UGX 140,000 to UGX 40,000, money landed in Cash at Merchant |
| Register a member through the five-step wizard | Manager | ✅ Member `BND26013` created, UGX 25,000 of fees charged and paid in cash, receipt issued, status Active |
| Start a loan review | Loan Officer | ✅ |
| Approve a loan | Manager | ✅ Reason recorded |
| Disburse a loan | Manager | ✅ Loan became Active with a UGX 2,360,000 balance and a repayment schedule |
| Record a loan repayment (UGX 200,000, cash) | Cashier | ✅ Receipt `LRP260924015` |
| Sell shares (5 shares at UGX 20,000) | Cashier | ✅ Receipt `SHR260924013` |
| Record an expense | Accountant | ✅ Filed as *Awaiting approval*; no money moved |
| Approve the expense | Manager | ✅ Confirmation warned that "the ledger is posted and the account balances change as soon as you confirm" — and it did |
| Create fees (Membership UGX 20,000, Registration UGX 5,000) | Super Admin | ✅ Both appear at registration and total UGX 25,000 |
| Reverse a transaction (a deposit) | Super Admin (via the same database function the screen calls) | ✅ Compensating entry written, both rows still visible |

The audit log recorded every one of these: 133 savings entries, 15 loan repayments, 13 share
purchases, 13 member creations, 8 loan applications, 5 approvals, 4 disbursements, 4 expense
approvals and 61 sign-ins, each with its actor and reason.

### Controls that were confirmed to work

| Control | How it showed up |
| --- | --- |
| A second, explicit confirmation before money moves | The collection dialog and the repayment form both require **Review** and then a confirmation before anything is saved |
| Validation stops an incomplete form | Registration refused to advance without a share category, and without the amount received |
| An amount larger than the balance is refused | A repayment of UGX 19,666,667 against a UGX 2,360,000 loan was refused with a clear message (see **V‑2**) |
| A transaction reference must be unique | Stated on the collection form and enforced by a database index |
| An expense does not move money until approved | The entry sat as *Awaiting approval* and the account balance was unchanged until the manager confirmed |
| Members cannot record their own payments | The member "Save Money", "Buy Shares" and "Repay Loan" screens give payment instructions and a reference only; there is no control that writes to the ledger |

---

## 3. Findings

### V‑1 — Reversing a savings collection fails *(defect, blocking a documented feature)*

**What happens.** Calling the reversal that the Transactions screen uses, on any savings
transaction, raises:

```
ERROR: column "status" is of type savings_status but expression is of type text
CONTEXT: PL/pgSQL function reverse_transaction(uuid,text,date) line 70
```

**Why.** In the current `reverse_transaction()` (migration `0038`, and the same in `0036`), the
statement that rewrites the savings period's status builds it from a `CASE` of bare string
literals. PostgreSQL types that `CASE` as `text` and will not assign `text` to the
`savings_status` column without a cast.

**Effect.** Reversing a savings collection — the SACCO's documented way of correcting a payment
recorded against the wrong member — does not work. Reversing other kinds of transaction (a deposit
was tested) works normally.

**How this was handled in the manuals.** The reversal procedure is documented, because it is the
correct procedure, but it is marked with a clear warning that reversing a *savings* transaction
currently fails and must be escalated. This should be fixed before the manuals are relied on for
that step.

**Suggested fix (not applied — this is a documentation exercise).** Cast the `CASE` result, e.g.
`… end::savings_status`, in `reverse_transaction()`.

### V‑2 — A fractional "one installment" quick-fill enters 100× the amount *(defect)*

**What happens.** On **Loans → Record Repayment**, the shortcut button offered *One installment ·
UGX 196,666.67*. Pressing it put **19,666,667** in the amount field.

**Why.** The money input formats what it is given with a digits-only helper
(`groupDigits()` in `src/lib/money.ts`), which strips the decimal point. `196666.67` becomes
`19666667`.

**Effect.** Any preset amount that is not a whole number is entered a hundred times too large.
In the case tested the system refused it, because it exceeded the outstanding balance — so no
wrong amount was posted. On a loan whose outstanding balance is more than a hundred times the
installment, the refusal would not trigger.

**How this was handled in the manuals.** The staff manual tells cashiers to type the amount and to
check the figure in the field before pressing Review, and does not present the quick-fill buttons
as a shortcut to rely on.

**Suggested fix (not applied).** Preserve decimals in the money input's display formatting, or
round preset amounts to whole shillings before offering them.

### V‑3 — The committed demo seed no longer matches the schema *(maintenance)*

`supabase/seed.sql` cannot run against the current migrations. Three statements in it use write
paths that later migrations deliberately withdrew:

| Statement in the seed | Why it fails now |
| --- | --- |
| `insert into savings_plans …` | Migration `0036` revoked `insert, update` on `savings_plans` from `authenticated`; targets are now set with `set_savings_plan()` |
| `insert into loan_products …` | Migration `0037` removed the seeded products; they are now created with `save_loan_product()` |
| `perform ensure_savings_period(…)` | Migration `0030` §14 revoked the internal functions from `authenticated` |
| `disburse_loan(p_disbursed_on => current_date - interval '5 months')` | The parameter is a `date`; the expression is a `timestamp`, so no function matches |

A corrected copy, with each change commented, is at `documentation/source/demo-data.sql`. The
repository's own file was left untouched.

### V‑4 — A confusing target line on the member "Save Money" screen *(cosmetic)*

For a member whose savings category is monthly, the weekly line reads *"Weekly target (Week 38,
2026): UGX 20,000 of UGX 0"* — what they have paid, out of an expectation of zero. It is not
incorrect (they have no weekly expectation), but it reads oddly. The member manual explains how to
read these figures rather than leaving members to guess.

### V‑5 — A guarantor cannot see whose loan they are guaranteeing *(defect)*

**What happens.** On the member portal's **Guarantees** screen, every loan a member has agreed to
back is listed as *"Unknown member"*.

**Why.** A member may read only their own row in `members` — row-level security allows nothing else,
which is correct and deliberate. The guarantees page nevertheless reads the borrower's name through
that table and falls back to the literal string `'Unknown member'` when it comes back empty
(`src/app/(member)/guarantees/page.tsx:122`). Confirmed in the database: signed in as a member,
`select count(*) from members` returns **1**.

**Effect.** A guarantor sees their total exposure, each loan number, each purpose and each amount,
but not the name of the person they are standing for. Where a member guarantees several loans, they
cannot easily tell them apart.

**How this was handled in the manuals.** The member manual describes the screen as it actually
behaves, including the "Unknown member" label, and tells members to use the loan number and purpose
instead, and to ask at the office if they need to be sure.

**Suggested fix (not applied).** Return the borrower's name and member number through a
`SECURITY DEFINER` function that discloses only those two fields to an accepted guarantor — the same
approach `search_guarantor_candidates()` already takes for the guarantor search.

### V‑6 — A loan repayment may be dated in the future *(minor)*

**What happens.** `record_loan_repayment()` accepts a payment date after today. The repository's own
demo seed produced one: a repayment on the merchant account dated **24 October 2026**, a month
after the data was created.

**Why it matters.** The savings collection function deliberately refuses a future date; loan
repayment does not, so the two behave differently for the same kind of mistake. The effect is
visible in reconciliation: a reconciliation as at today correctly excludes the future-dated entry,
so its system balance is lower than the account's live balance, and the difference looks like a
variance when it is not one.

**How this was handled in the manuals.** The staff manual explains that a reconciliation is worked
out **as at the date you give it**, and that a difference must be investigated rather than assumed
to be an error in the count.

**Suggested fix (not applied).** Refuse a future `paid_on` in `record_loan_repayment()`, as
`record_scheduled_savings()` already does.

### V‑7 — Supporting documents on finance entries could not be tested *(environment)*

The expense form has an **Attach** control for a supporting document. It needs Supabase Storage,
which the documentation environment does not provide, so the upload path was not exercised and is
not documented as a working step.

---

## 4. What the manuals may and may not claim

| Claim | Permitted? |
| --- | --- |
| "Members can see their savings, shares, loans and statements" | ✅ Verified |
| "Members cannot record their own payments" | ✅ Verified, by design |
| "Paying by mobile money updates my balance automatically" | ❌ **False.** There is no payment integration. A staff member records it. |
| "A cashier can reverse a mistake themselves" | ❌ Only a Manager, Admin or Super Admin may reverse, and savings reversals currently fail (**V‑1**) |
| "A guarantor can see whose loan they are backing" | ❌ The name shows as *Unknown member* (**V‑5**) |
| "The system prevents all duplicate entries" | ⚠️ Partly. Repeat submissions of the same form are prevented (idempotency keys), and a payment reference cannot be used twice on the same account. Two genuinely different entries for the same money are not prevented. |
| "An expense leaves the account as soon as it is recorded" | ❌ It waits for approval |
| "Each role sees only what it should" | ✅ Verified by the redirect tests above |
| "Statements and reports can be printed or saved as PDF" | ✅ Verified — the print rendering was captured and carries the SACCO letterhead |

---

## 5. How to reproduce this verification

The scripts used are in `documentation/source/`. They drive the real application through a browser
and make no direct database writes except where a comment says otherwise:

| Script | What it does |
| --- | --- |
| `lib.mjs` | Shared browser helpers |
| `walk.mjs` | Loads a list of routes and screenshots each, reporting any redirect |
| `first-run.mjs` | First sign-in and the forced password change |
| `make-accounts.mjs`, `activate-accounts.mjs` | Creates and activates the five demonstration staff accounts |
| `member-login.mjs`, `member-reset.mjs` | Creates and resets a member's portal login |
| `make-fees.mjs` | Creates the demonstration fees |
| `workflow-collection.mjs` | The savings collection, step by step |
| `workflow-registration.mjs` | The five-step registration wizard |
| `workflow-loan.mjs`, `workflow-loan2.mjs`, `workflow-repayment.mjs` | The loan lifecycle |
| `workflow-shares-expense.mjs`, `workflow-approval.mjs`, `workflow-approval2.mjs` | Share sale, expense and approval |
| `capture-print.mjs` | Report print rendering |
| `capture-public.mjs` | Signed-out screens |
| `demo-data.sql` | The corrected demo seed |

`documentation/README.md` explains how to stand the environment up again.
