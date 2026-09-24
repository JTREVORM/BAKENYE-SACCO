# Bakenye SACCO — System Remediation Report

**Prepared:** 24 September 2026
**Branch:** `fix/sacco-qa-findings`
**Scope:** The seven findings (V‑1 … V‑7) raised by the documentation QA, plus one further
defect found while fixing them.

---

## Executive summary

**All seven findings are resolved, and an eighth defect found during the work is resolved with
them.** Two were functional defects that stopped documented procedures working, one was a defect
that overstated money on a document members take to a bank, one was a whole class of missing
validation, one was a privacy/usability problem, one was a broken seed, one was a presentation
fault, and one was a gap in what could be tested rather than a fault in the application.

Nothing was worked around. Every fix addresses the cause, and every fix is covered by a test that
fails without it.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| V‑1 | Reversing a savings payment failed outright | **Critical** — the only correction procedure did not work | **Fixed** |
| V‑2 | A money field silently multiplied fractional amounts by 100 | **High** — wrong amounts offered for posting | **Fixed** |
| V‑3 | The demo seed could not run against the current schema | Medium — no reproducible environment | **Fixed** |
| V‑4 | Cycles expecting nothing were shown to members as targets | Low | **Fixed** |
| V‑5 | A guarantor could not see whose loan they were backing | **High** — a real obligation with no visibility | **Fixed** |
| V‑6 | Six money functions accepted a value date in the future | **High** — reports silently disagreed with balances | **Fixed** |
| V‑7 | The supporting-document path could not be tested | Environment, not a defect | **Verified working** |
| V‑8 | *(found here)* A member statement double-counted reversals | **High** — statements overstated balances | **Fixed** |

Row-level security was not weakened anywhere. No authorisation was bypassed. No production data was
touched. The nine roles retain exactly the permissions they had.

---

## Finding by finding

### V‑1 — Reversing a savings payment failed

| | |
| --- | --- |
| **Root cause** | `reverse_transaction()` rewrote the savings period's status from a `CASE` of bare string literals. PostgreSQL types such a `CASE` as `text` and will not assign it to `savings_periods.status`, which is a `savings_status` enum. The statement raised every time, so **no savings payment could ever be reversed** — and reversal is the SACCO's only way to correct money recorded against the wrong member. A second copy of the same "recompute a period from its payment rows" arithmetic lived in `record_scheduled_savings()`, and the two had already drifted apart: for a period expecting nothing that had money paid into it, collection said `paid` and reversal said `partial`. |
| **Fix** | Migration `0039`. The arithmetic now lives in one correctly-typed function, `recompute_savings_period()`, called by both paths, so they cannot diverge again. It is revoked from the API roles — only the money functions, which check their own caller first, may call it. A waived period is left waived: a waiver is a manager's written decision, and money arriving or being reversed afterwards does not overturn it. An audit of every live function assigning a `CASE` to a status column found no other instance. |
| **Tests** | `supabase/tests/qa_findings_test.sql`: a savings payment reversed without error; the balance falling by exactly the reversed amount; the period recomputed and correctly typed; the original marked `reversed`; the audit entry written; a second reversal refused; the helper not callable from the API; a waiver surviving. Also checked interactively: a weekly and a monthly payment, a blank reason refused, a cashier refused, a member refused, and the collection path still moving `pending → partial → paid`. |
| **Status** | **Fixed and tested.** |

### V‑2 — A money field multiplied fractional amounts by 100

| | |
| --- | --- |
| **Root cause** | Traced from source to screen. `loan_balances.installment_amount` is `196666.67`; the repayment form set that correctly; `MoneyInput` then formatted it with `groupDigits()`, which stripped every non-digit **including the decimal point**, giving `19666667`. The hidden input the form posts was built from the same digits-only string, so the display *and* the submitted value were both a hundred times too large. The server was never at fault — it accepts a decimal. **Wider than reported:** "Full balance" was broken the same way for any loan with a fractional outstanding balance (four of the five demonstration loans), and rounding is not an option there, because a full settlement must equal the balance to the cent or the database refuses it. Every screen that fills a money field for the user was exposed. |
| **Fix** | `src/lib/money.ts` and `src/components/ui/form.tsx`. `groupDigits()` keeps a decimal point and up to two digits after it; a new `ungroupDigits()` produces the plain number the form posts; the input asks for a `decimal` keypad so a phone offers a separator. Typing whole shillings is unchanged. |
| **Tests** | 22 unit cases over the two helpers: whole and fractional amounts, mid-typing states (`1200.`, `.5`), more than two decimals, already-grouped input, junk, and a round trip of every awkward value the system supplies. End to end in the browser on a loan owing UGX 536,666.65 with a UGX 76,666.67 installment — *One installment* now shows and posts `76666.67` (was 7,666,667); *Full balance* now shows and posts `536666.65` (was 53,666,665); typing is unchanged. Posting the full balance cleared the loan exactly: outstanding 0.00, 100% repaid, completed, both guarantors released, ledger row for 536,666.65, audit written. |
| **Status** | **Fixed and tested.** |

### V‑3 — The demo seed could not run against the current schema

| | |
| --- | --- |
| **Root cause** | Seven statements in `supabase/seed.sql` used write paths that later migrations deliberately withdrew (direct inserts into `savings_plans`, `loan_products`, `loan_guarantors`, `loans` and `loan_schedule`; the internal `ensure_savings_period()`; the owner-only `run_daily_maintenance()`), and one passed a `timestamp` to a `date` parameter. A clean development or demo environment could not be created at all. |
| **Fix** | Loan products now go through `save_loan_product()`, the function the Loans → Products screen calls. The remainder are seed-only operations with no application equivalent, so they borrow the owner role for one statement and hand it straight back, each with a comment saying why. Two changes matter beyond "the file runs": savings targets keep their **backdated** `active_from` (setting them through `set_savings_plan()` would stamp them active from today, leaving every historical cycle with an expectation of zero), and repayment dates are **capped at today**, which is what produced the future-dated rows behind V‑6. |
| **Tests** | Clean-installation test from an empty database — 41 migrations, first administrator, then the seed. Result: 12 members, 178 transactions, 8 loans at every lifecycle stage, 3 loan products, 168 savings periods, 21 backdated savings plans, **0 future-dated entries**. Every member statement agrees with the dashboard; the Cash & Bank report agrees with the ledger for every account. The repository's own `scripts/reset-data.sql` was also exercised: it cleared every member and business record and kept the configuration (9 roles, 3 categories) exactly as documented. |
| **Status** | **Fixed and tested.** |

### V‑4 — Cycles expecting nothing were shown as targets

| | |
| --- | --- |
| **Root cause** | Not a wording problem. The savings scheduler deliberately raises a row for a cadence the member's category does not collect on, carrying an expectation of zero, so that a shortfall is always measurable. That is right in the data and wrong on the screen. **Save Money** printed `Weekly target (Week 38, 2026): UGX 20,000 of UGX 0`. Worse, **My Savings** chose "the cycle you are being judged against" as the earliest pending row of *any* cadence, so a zero-expectation week from the previous month was shown as the current cycle while the member's real monthly obligation went unmentioned. |
| **Fix** | Both screens now consider only cycles that actually expect something. Money paid into any other cycle is untouched and still appears in the balance and the transaction history; the arrears arithmetic is unchanged. No schema or scheduler change. |
| **Tests** | In the browser, for a Diamond Saver: My Savings now shows `Sep 2026 · Paid UGX 100,000 · Expected UGX 100,000` (was `Week 35, 2026 · Expected UGX 0`); Save Money now shows only `Monthly target (Sep 2026): UGX 100,000 of UGX 100,000`. Neither screen contains `of UGX 0` or `Expected: UGX 0`. |
| **Status** | **Fixed and tested.** |

### V‑5 — A guarantor could not see whose loan they were guaranteeing

| | |
| --- | --- |
| **Root cause** | Row-level security was **not** at fault. A member may read exactly one row of `members` — their own — which is correct and deliberate. The Guarantees screen nevertheless asked PostgREST to embed the borrower through that table, got nothing back, and printed the literal string `Unknown member`. A member guaranteeing several loans could not tell them apart. |
| **Fix** | Migration `0042`: a dedicated read path, `my_guarantees()`, rather than a wider policy. It is `SECURITY DEFINER`, so it can read past RLS, but it decides for itself what to disclose. **Authorisation is the `WHERE` clause** — `g.member_id = current_member_id()` — so there is no parameter a member can tamper with. Staff who already hold `loans.view` may name a member, so the office can answer a guarantor's question without a second, looser route into the register. It returns the borrower's name, member number and photograph, the loan and how far it has been repaid, and the caller's own guaranteed amount — **no phone number, no National ID, no savings, no shares, no other loans, nothing about members the caller does not guarantee**. It is `STABLE` and read-only, with `search_path` fixed and no dynamic SQL, revoked from `public` and `anon` and granted only to `authenticated`. This mirrors `search_guarantor_candidates()` (0029), the pattern already used for the guarantor search. |
| **Security tests** | **A** a guarantor sees the borrower they guarantee. **B** passing another member's id returns the caller's own rows, never theirs. **C** a member who guarantees nothing enumerates nothing, by any route. **D** a guarantor cannot alter the loan they can now see (permission denied). **E** RLS on `members` is unchanged — still exactly one row. **F** withdrawing a guarantee removes the access with it (7 → 6 rows). **G** the screen no longer shows "Unknown member" — verified in the browser. **H** a caller with no member record gets nothing. Plus: a loan officer and a cashier may look a member up; a field officer, who lacks `loans.view`, may not. |
| **Status** | **Fixed and tested.** |

### V‑6 — Six money functions accepted a value date in the future

| | |
| --- | --- |
| **Root cause** | Systemic, and wider than reported. Seven money-posting functions refused a date after today; **six did not** — `record_loan_repayment`, `record_savings_payment`, `buy_shares`, `record_cash_movement`, `record_income` and `disburse_loan`. The guard had been added one function at a time and these were missed. The damage is to the books rather than the ledger: a Cash & Bank report, an account statement and a reconciliation are all drawn up **as at** a date and correctly exclude a future-dated entry, while the account's live balance includes it. The two then disagree, and the difference looks exactly like a reconciliation variance nobody can explain. |
| **Fix** | Migration `0041`. The rule now lives in one function, `assert_not_future()`, applied to all six. All thirteen money-posting functions now carry it. |
| **Evidence it mattered** | The repository's own seed walked into this and produced two repayments dated one and two months ahead. They made the treasury suite's *"opening + in − out = closing = ledger balance, for every account"* check fail on two accounts, by UGX 88,333.33 and by two cents. With V‑6 fixed and the seed corrected, that check passes. |
| **Tests** | `qa_findings_test.sql` asserts a future date is refused by savings, cash movement and share purchase. The treasury suite's account-reconciliation check passes on a clean install. |
| **Status** | **Fixed and tested.** |

### V‑7 — The supporting-document path could not be tested

| | |
| --- | --- |
| **Root cause** | Not an application defect. The upload path needs Supabase Storage, which the documentation environment did not provide, so it had never been exercised. |
| **Fix** | The gap was in the test environment, so that is what was fixed: the local stack now implements the slice of Storage the application uses — upload, signed links and download — backed by the `storage.objects` table the migrations already create. The auth stand-in also gained the columns the repository's own SQL suites insert, which had been stopping four of the six suites from running at all. **No application code needed changing.** |
| **Tests** | An expense recorded with a PNG attached: `finance_documents` row written with the right file name, MIME type and size (74 bytes), the object stored, no error surfaced. The application's own document route returned the exact bytes back through its two-minute signed link — 74 bytes, PNG magic bytes, `content-type: image/png`. A member is refused (403) before storage is touched; a field officer is refused; a cashier and an accountant are allowed. A tampered signature is rejected (400), and so is an expired link (400). The magic-byte check in `attachDocument()` and the RLS policy on `finance_documents` both behave as written. |
| **Status** | **Verified working.** |

### V‑8 — A member statement double-counted reversals *(found during this work)*

| | |
| --- | --- |
| **Root cause** | `member_statement()` lists a reversed entry and its reversal side by side, which is right — the member should see the correction, not a gap. But the running balance added every listed row by its **type** alone and ignored its **status**, so a reversed deposit was counted twice: once as the cancelled original and once as the reversal. |
| **Why it matters** | Confirmed on demonstration data that predates any change here: a member with one reversed deposit had a statement closing at UGX 600,000 while the dashboard and the ledger both said UGX 500,000. A statement is a document a member takes to a bank. The defect was already reachable for deposits, withdrawals, shares and loan entries; fixing V‑1 would have made it the normal case. |
| **Fix** | Migration `0040`. A reversal now carries the opposite sign to the type it reverses; the original keeps its own sign and the pair nets to nothing, so the running balance tells the true story line by line. The opening balance is computed the same way, so an entry made before the period and reversed inside it is not lost twice. An audit of every other report that sums transactions found no similar case. |
| **Tests** | All 13 demonstration members checked: statement closing balance = `member_financials.savings_balance` = the ledger, **zero mismatches**. Covered by `qa_findings_test.sql`. |
| **Status** | **Fixed and tested.** |

---

## Security

### Row-level security

RLS was **not weakened anywhere**. The one place it could have been — V‑5 — was deliberately solved
without touching a policy. The regression suite proves it directly: a member still sees exactly one
row of `members`, cannot see another member's schedules, payments, ledger, loans, guarantees,
payment intents, audit log or books, and cannot pull another member's statement. All 23 checks in
`rls_isolation_test.sql` pass.

### The guarantor access path

`my_guarantees()` is the only new read path. It is `SECURITY DEFINER` because it must be, and it is
constrained by construction rather than by convention:

* authorisation is the `WHERE` clause, not a parameter check that could be forgotten;
* `set search_path = public`, `STABLE`, no dynamic SQL, no string concatenation into SQL;
* revoked from `public` and `anon`, granted only to `authenticated`;
* returns a fixed, minimal column list — the borrower's name, member number and photograph, and
  nothing else about them;
* read-only, so the new visibility grants no new ability to change anything.

Tests A–H above, plus the cross-role checks, all pass.

### Roles and permissions

No permission was added, removed or moved. The nine roles behave exactly as before, re-verified
after every change:

| Role | Re-verified |
| --- | --- |
| Super Admin | Full access; the only role that may manage roles and permissions |
| Admin | Staff accounts; cannot manage roles |
| SACCO Manager | Approvals, settings, reversals; **cannot** manage staff accounts or roles |
| Loan Officer | Assess and collect; **cannot** approve or disburse; **cannot** open Finance |
| Cashier / Teller | Counter work; **cannot** reverse, register members, or open Users or Settings |
| Accountant | Books and reconciliation; **cannot** approve their own entries |
| Field Officer | Collections; **cannot** open Finance; **cannot** see guarantees (no `loans.view`) |
| Viewer | Read-only |
| Member | Own records, plus the loans they guarantee — and now the borrower's name on those |

The guarantor fix did **not** grant members any staff permission: `my_guarantees()` returns rows, not
rights, and test E confirms the member's view of `members` is unchanged.

**Proved, not assumed.** Two databases were built from the same bootstrap — one with migrations
`0001`–`0038` (the state before this work) and one with all 42 — and their entire authorisation
surface was compared:

| What was compared | Rows | Result |
| --- | --: | --- |
| Role → permission grants | 84 | **identical** |
| Role definitions (kind, system flag, status, dashboard) | 9 | **identical** |
| Permission definitions (module, scope, core, sensitive) | 39 | **identical** |
| RLS policies, including every `USING` and `WITH CHECK` expression | 65 | **identical** |
| Tables with row-level security enabled | 42 | **identical** |
| Function security flags and execute grants | 322 → 325 | **only three additions**, below |

The three new functions are the only change to what is callable:

| Function | `SECURITY DEFINER` | Granted to |
| --- | --- | --- |
| `assert_not_future(date, text)` | no | nobody — internal helper, revoked from `public`, `anon` and `authenticated` |
| `recompute_savings_period(uuid)` | yes | nobody — revoked from `public`, `anon` and `authenticated`; only other functions may call it |
| `my_guarantees(uuid)` | yes | `authenticated` — the intended member-facing read |

No existing function changed its security flag or its grants. The bodies of `record_scheduled_savings`,
`reverse_transaction`, `member_statement` and the six functions in `0041` were re-issued, but their
signatures, `SECURITY DEFINER` settings and ACLs are byte-identical to before.

The same check is repeatable: `documentation/source/permission-matrix.mjs` signs in as every
demonstration account and asks for every staff and member route, recording whether the application
served it or turned the account away, so the access matrix can be diffed between two builds. Run
against the corrected build, over 28 routes:

| Account | Lands on | Routes served |
| --- | --- | --: |
| Super Admin | `/staff/admin` | 19 of 28 |
| SACCO Manager | `/staff` | 17 of 28 |
| Cashier / Teller | `/staff/desk` | 15 of 28 |
| Accountant | `/staff/finance` | 16 of 28 |
| Loan Officer | `/staff/loans-desk` | 13 of 28 |
| Field Officer | `/staff/savings/collect` | 11 of 28 |
| Member | `/` | 9 of 28 |

The result that matters for V‑5: **the member was turned away from all nineteen staff routes**, and
every staff account was turned away from all nine member routes. The guarantor fix widened nothing.
`/staff/users`, `/staff/roles` and `/staff/settings` are served only to the roles that may manage
them, and `/staff/audit` only to those with `audit.view`.

One result deserves stating plainly rather than being left to look like a finding. `/staff/admin` is
served to every staff role, because it asks only for `dashboard.staff` and then gates each block on
its own permission — a field officer who opens it sees the header and nothing else. That is the
application's existing design, not a consequence of this work: `dashboard.staff` is granted to
exactly the same roles before and after, as the grant diff above shows. Route reachability is not
data exposure, and the matrix measures the former; the latter is covered by the RLS suites.

### Secret exposure (§17)

No key value is printed, committed or reproduced anywhere in this work.

| Check | Result |
| --- | --- |
| Tracked `.env*` files | Only `.env.example`, which holds placeholders (`your-service-role-key`) |
| `.env.local` | Git-ignored and untracked; it points only at the local test stack |
| JWT-shaped strings in tracked files | **None** |
| Service-role key values anywhere in git history | **None** |
| Keys in the manuals or the reports | **None** — only the variable *name*, in the warning below |

**Action still required by the SACCO.** The build environment this work ran in carried a
`SUPABASE_SERVICE_ROLE_KEY` and a `VITE_SUPABASE_URL` pointing at a hosted project. They were never
used — every command ran with them explicitly cleared, against a throwaway local database — but a
service-role key bypasses all row-level security, and it was present somewhere it did not need to
be. **It should be rotated in the Supabase dashboard, and removed from any environment that does not
require it.** The key itself is deliberately not reproduced here.

---

## Financial integrity

Every change touching money was checked along the whole chain — **before → transaction → after →
history → balance → reports → audit log**.

| Check | Result |
| --- | --- |
| Savings reversal: balance falls by exactly the reversed amount | ✅ 600,000 → 500,000 on a 100,000 reversal |
| Savings reversal: the period is recomputed from the payment rows | ✅ paid 0.00, status `pending` |
| Savings reversal: dashboard, ledger and statement agree afterwards | ✅ all three read 500,000 |
| Statements across every member | ✅ 13 of 13 agree with the dashboard and the ledger |
| Cash & Bank report vs the ledger, per account | ✅ passes on a clean install (failed before V‑6) |
| Repayment of a fractional full balance | ✅ cleared exactly: outstanding 0.00, 100%, completed |
| Guarantors released when a loan completes | ✅ 2 of 2 |
| Category analytics after a reversal | ✅ consistent with the ledger |
| Immutability | ✅ transactions still cannot be edited or deleted; account entries still cannot be edited |

No fix introduced a case where the dashboard says one number and the history or the reports say
another. The two places where that *was* true — V‑6 and V‑8 — are the two that were fixed.

### Audit log

No audit control was removed or relaxed. Reversals still require a reason and still write
`transaction.reversed` with the before and after values. Repayments, disbursements, approvals,
waivers, registrations and role changes all still audit. The new `recompute_savings_period()` writes
no audit entry of its own by design — it is arithmetic inside an already-audited operation, not an
action a person takes.

---

## Testing summary

| Suite | Result |
| --- | --- |
| `qa_findings_test.sql` (new) | **16 / 16** — V‑1, V‑5, V‑6, V‑8 |
| `rls_isolation_test.sql` | **23 / 23** |
| `audit_fixes_test.sql` | pass |
| `members_access_test.sql` | pass |
| `numbering_test.sql` | pass |
| `treasury_test.sql` | pass |
| **Total, clean install** | **210 passed, 0 failed** |
| **Total, migrations only** | **210 passed, 0 failed** |
| Money unit checks | **22 / 22** |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | clean |
| `npm run build` | succeeds |
| Clean installation (empty DB → 42 migrations → admin → seed) | succeeds, financially consistent |
| Authorisation surface, before vs after (grants, roles, permissions, policies, RLS flags, function ACLs) | **no difference** — see *Roles and permissions* |
| Nine-role route access matrix (`permission-matrix.mjs`) | every role lands on its own dashboard and is turned away from every screen it may not open |

Two checks in `numbering_test.sql` only ever passed against an empty database — it wound the day's
document counters back to zero and left them there, so the next real receipt collided with one
already issued, and it expected member number 001 on a register that already had members. Both were
corrected; they are unrelated to the findings and were committed separately.

---

## Documentation

The two manuals were written against the system as it was, and said plainly what did not work. Now
that those things work, the manuals would be wrong if left alone. Both were reissued as
**version 1.1**.

### What was removed, and what replaced it

| Where | Version 1.0 said | Version 1.1 says |
| --- | --- | --- |
| Staff manual, front matter | A warning box: "Two things in the system need fixing before you rely on this manual for them" | A "What changed in version 1.1" box recording that both were corrected and re-tested, and that the 1.0 workarounds are no longer needed |
| Staff manual §7 (Savings) | "A savings reversal currently fails" — report it, keep a written note | How a savings reversal actually behaves: the cycle is put back to paid, part paid or pending, recalculated from the payments that remain |
| Staff manual §8 (Loans) | "Type the amount — do not trust the shortcut buttons", because a fractional installment came out 100× too large | "Read the figure in the box before you go on" — ordinary counter discipline, with the shortcut described as filling in the correct amount, cents included |
| Staff manual §10 (Reversals) | "Reversing a savings payment currently fails" | "What a reversal puts back" — that a reversal restores the savings cycle and the loan schedule, and none of it needs adjusting by hand |
| Staff manual §17 (Troubleshooting) | A "Known defects at the time of writing" table with workarounds | "Defects reported in version 1.0, and now corrected" — the same two entries, stated as *what used to happen* against *what happens now*, kept so a reader still holding the earlier edition knows its workarounds are obsolete |
| Member guide §11 (Guarantees) | "The borrower is shown as 'Unknown member'" | "What you are shown about the borrower, and what you are not" — the borrower's name, member number, amount still owed and next due date, and an explicit list of what a guarantor still cannot see |
| Member guide §4 (Savings) | "If a cycle shows UGX 0 expected" — an explanation of a line that should not have been there | "You only see the cycles your category actually collects", with the assurance that a cycle that is not listed is one nothing is owed on |

Nothing was softened to hide a problem: the troubleshooting section still carries both defects, as
history rather than as live warnings, and every other warning box in either manual — the ones about
there being no payment-provider connection, about a posted transaction never being editable, about
never correcting an error with an opposite entry — is untouched, because those remain true.

### Screenshots

Screenshots showing the old behaviour were retaken against the corrected system, from the rebuilt
demonstration database. The Guarantees screen is now captured from **Nakabugo Christine's** account
rather than Musoke John's: with the demonstration seed running correctly, she is the member who
actually guarantees other members' loans, and Musoke John — whose account the rest of the member
guide uses — guarantees none. The member guide's front matter now names both example accounts, so a
reader is not left to wonder why one screen shows a different person.

The repayment capture was changed to press the **One installment** shortcut rather than avoid it.
Version 1.0's capture script typed the amount by hand precisely because the shortcut was broken;
pressing it and reading the box back is now what demonstrates the fix, and the figure it produces is
recorded in the capture log. On the rebuilt demonstration database it printed
`one-installment quick-fill -> 76,666.67` — the amount that used to come out as 7,666,667 — and the
repayment it then posted is in the ledger as `LRP260924015`, exactly `76666.67`, taking the loan from
UGX 536,666.65 to UGX 459,999.98.

Two new figures were added under `shared/` as evidence for V‑4: the savings and Save Money screens of
a monthly-only saver, whose four zero-expectation weekly cycles are no longer listed as targets.

### The rebuilt documents

| | Version 1.0 | Version 1.1 |
| --- | --- | --- |
| Member User Guide | 36 pages, 25 figures, 2.6 MB | **37 pages**, 25 figures, 2.6 MB |
| Staff & Administrator Manual | 91 pages, 95 figures, 15.4 MB | **92 pages**, 95 figures, 15.4 MB |
| Screenshots in the repository | 210 | **212** |

Each manual grew by a page because the explanations that replaced the warning boxes are longer than
the warnings were. `qa.py` reports for both: no blank pages after the cover, nothing outside the
margins, no unresolved placeholders, no text below 5.5pt. The rendered PDFs were then read back and
checked for the text that had to go and the text that had to appear — fourteen assertions, all
passing, including that the string "Unknown member" no longer occurs anywhere in the member guide.

### Reports

`DOCUMENTATION_VERIFICATION_REPORT.md` was **not** rewritten. It is the record of what was observed
before the fixes, and rewriting its findings would falsify that record. A status note was added at
the top, a status table under *Findings*, and the two claims that changed (the guarantor claim, and
V‑6's "suggested fix (not applied)") were updated in place with the change marked as such.
`PDF_MANUAL_QA_REPORT.md` was updated for the reissued documents.

---

## Git

| | |
| --- | --- |
| **Branch** | `fix/sacco-qa-findings`, from `claude/sweet-feynman-t3tcvn` |
| **Migrations added** | `0039` … `0042` — new files; no historical migration was edited |
| **Application files changed** | `src/lib/money.ts`, `src/components/ui/form.tsx`, `src/app/(member)/guarantees/page.tsx`, `src/app/(member)/savings/page.tsx`, `src/app/(member)/savings/deposit/page.tsx`, `src/types/db.ts` |
| **Other** | `supabase/seed.sql`, three test suites, three scripts (`PGSSLMODE` support), the local test stack |

Commits, in order:

1. `fix(db): a savings payment can be reversed again (V-1)`
2. `fix(db): a member statement must account for reversals (V-8)`
3. `fix(db): no money may be recorded with a value date in the future (V-6)`
4. `fix(seed): the demo seed runs against the current schema again (V-3)`
5. `fix: a guarantor can see who they are guaranteeing (V-5)`
6. `test: make the numbering suite independent of what the register already holds`
7. `fix(ui): a money field keeps the cents it is given (V-2)`
8. `fix(member): a cycle that expects nothing is not shown as a target (V-4)`
9. `test: a local stack that can run the suites, a clean install and Storage (V-7)`
10. `fix(member): only a disbursed loan has an amount still owed (V-5 follow-up)`
11. `docs: reissue both manuals as version 1.1, without the obsolete warnings`
12. `docs: the remediation report, and the QA reports reconciled with it`
13. `test: a repeatable nine-role access matrix, and capture scripts that prove the fixes`
14. `docs: recapture the account screenshots from the rebuilt demonstration database`
15. `docs: rebuild both manuals at version 1.1 from the corrected system`
