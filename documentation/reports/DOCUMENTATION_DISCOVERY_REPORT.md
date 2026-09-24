# Documentation Discovery Report

**Project:** Bakenye Unity and Development SACCO — digital SACCO management system
**Repository:** `jtrevorm/bakenye-sacco` (branch `claude/sweet-feynman-t3tcvn`)
**Prepared:** 24 September 2026
**Purpose:** Establish, from evidence in the repository and from the running application, exactly
which features exist and which user roles can reach them, so that the two user manuals document
only real behaviour.

> Everything in this report was confirmed either by reading the source and the database migrations,
> or by running the application in an isolated local test environment (see
> `DOCUMENTATION_VERIFICATION_REPORT.md`). Nothing here is assumed from what SACCO software
> usually does.

---

## 1. Application architecture

| Layer | What is actually used | Evidence |
| --- | --- | --- |
| Front end / server | Next.js 15 (App Router), React 18, mostly Server Components | `package.json`, `src/app/**` |
| Styling | Tailwind CSS 3, compiled ahead of time from a port of the original design's config | `tailwind.config.ts` |
| Backend data store | PostgreSQL through Supabase (PostgREST data API + Supabase Auth) | `src/lib/supabase/*`, `supabase/migrations/**` |
| Authentication | Supabase Auth (email/password; bcrypt hashes held by Auth) with an application-level identifier resolver | `src/app/(auth)/actions.ts`, migration `0032` |
| Authorisation | Row-level security plus `has_permission()` checks inside `SECURITY DEFINER` functions | `0004_rls.sql`, `0011`, `0029` |
| Business logic | Database functions — every money movement is one atomic function call | `0002_functions.sql`, `0018`, `0023`, `0027`, `0030` |
| Documents / PDFs | The browser's own print engine plus a print stylesheet and letterhead component — no PDF library | `src/lib/print.ts`, `src/components/print/PrintLetterhead.tsx` |
| Charts | Hand-written server-rendered SVG — no chart library | `src/components/staff/TrendChart.tsx` |
| Icons | Material Symbols, subsetted to the glyphs actually used | `src/lib/icons.ts` |

**Database size:** 38 migrations, `0001`–`0038`. The schema carries 60 tables and views and about
200 functions (counted by PostgREST when it loaded the schema in the test environment).

**Money handling, as implemented (verified in the migrations):**

* Every money movement writes exactly one row to `transactions`; a trigger makes `UPDATE` and
  `DELETE` on that table raise an exception.
* Balances are **not stored**. Savings, share value and loan balances are SQL views that sum the
  ledger.
* The application has no direct `INSERT` right on `transactions`, `share_lots`, `loan_repayments`
  or `savings_payments`; money moves only through database functions that check the caller first.
* Corrections are **reversals** — a compensating entry linked to the original, with a mandatory
  reason. (One defect found here: see the verification report, finding **V‑1**.)
* Amounts are `NUMERIC(16,2)`; arithmetic happens in PostgreSQL, not in JavaScript.

**There is no payment-provider integration.** Choosing "Mobile Money" when recording a payment
records that money already received; nothing in the application contacts MTN, Airtel or any
gateway. This is stated in the repository README and confirmed in the code: `payment_intents` rows
are created with `provider = 'manual'`. **The manuals must not suggest that paying by mobile money
updates a member's balance automatically.**

---

## 2. User roles

Roles are rows in the `roles` table, not constants in code. Nine roles ship with the system; a
Super Admin can create more. Read from the running database:

| Role key | Display name | Kind | Lands on |
| --- | --- | --- | --- |
| `super_admin` | Super Admin | staff | Administration (`/staff/admin`) |
| `admin` | Admin | staff | Administration (`/staff/admin`) |
| `manager` | SACCO Manager | staff | SACCO overview (`/staff`) |
| `loan_officer` | Loan Officer | staff | Loans desk (`/staff/loans-desk`) |
| `cashier` | Cashier / Teller | staff | Cashier desk (`/staff/desk`) |
| `accountant` | Accountant | staff | Finance (`/staff/finance`) |
| `field_officer` | Field Officer | staff | Collections (`/staff/savings/collect`) |
| `viewer` | Viewer | staff | SACCO overview (`/staff`) |
| `member` | Member | member | Member portal (`/`) |

Each of these landings was **confirmed by signing in** as a demonstration account of that role in
the test environment.

### How permission is decided

`has_permission(key)` returns true when **all** of the following hold for the signed-in account:
it is active; its role is active; the permission's scope matches the role's kind (staff / member);
the account is **not** still on a temporary password; and either the role is `super_admin`, or the
permission is a *core* permission, or the role has been granted it explicitly.

Two consequences worth documenting:

1. **A person on a temporary password can do nothing at all** except choose a new password.
2. **Super Admin always holds every permission** and cannot be locked out.

### Role–permission matrix (read from the live `permissions` / `role_permissions` tables)

● granted  ·  ○ held by every staff role automatically (core permission)  ·  — not held

| Permission | Super Admin | Admin | Manager | Loan Officer | Cashier | Accountant | Field Officer | Viewer | Member |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Staff dashboard | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | — |
| View members | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | own record |
| Register members | ● | ● | ● | — | — | — | — | — | — |
| Edit member records | ● | ● | ● | — | — | — | — | — | — |
| Change member status | ● | ● | ● | — | — | — | — | — | — |
| Allow a shared phone number | ● | ● | — | — | — | — | — | — | — |
| View categories | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | — |
| Manage categories | ● | ● | ● | — | — | — | — | — | — |
| Collect fees | ● | ● | ● | — | ● | — | — | — | — |
| Manage fees | ● | ● | ● | — | — | — | — | — | — |
| View savings | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | own |
| Record savings | ● | ● | ● | — | ● | — | ● | — | — |
| Waive a savings schedule | ● | ● | ● | — | — | — | — | — | — |
| View shares | ● | ● | ● | — | ● | ● | — | ● | own |
| Sell shares | ● | ● | ● | — | ● | — | — | — | — |
| View loans | ● | ● | ● | ● | ● | ● | — | ● | own |
| Assess loan applications | ● | ● | ● | ● | — | — | — | — | — |
| Approve loans | ● | ● | ● | — | — | — | — | — | — |
| Disburse loans | ● | ● | ● | — | — | — | — | — | — |
| Record repayments | ● | ● | ● | ● | ● | — | — | — | — |
| Manage guarantors | ● | ● | ● | ● | — | — | — | — | — |
| View transactions | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | own |
| Reverse transactions | ● | ● | ● | — | — | — | — | — | — |
| Deposits & withdrawals | ● | ● | ● | — | ● | — | — | — | — |
| View finance | ● | ● | ● | — | ● | ● | — | — | — |
| Record income & expenses | ● | ● | ● | — | ● | ● | — | — | — |
| Approve finance entries | ● | ● | ● | — | — | — | — | — | — |
| Reconcile accounts | ● | ● | ● | — | — | ● | — | — | — |
| Set up accounts | ● | ● | ● | — | — | — | — | — | — |
| View reports | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | own |
| Member statements & reports | ● | ● | ● | ● | — | ● | ● | — | — |
| Manage staff accounts | ● | ● | — | — | — | — | — | — | — |
| Manage roles & permissions | ● | — | — | — | — | — | — | — | — |
| View audit log | ● | ● | ● | — | — | ● | — | — | — |
| View settings | ● | ● | ● | — | — | — | — | — | — |
| Change settings | ● | ● | ● | — | — | — | — | — | — |
| Member portal | — | — | — | — | — | — | — | — | ○ |
| Apply for a loan (portal) | — | — | — | — | — | — | — | — | ● |
| Answer guarantee requests | — | — | — | — | — | — | — | — | ● |

Rules that cannot be configured away (migration `0029`): only a Super Admin may grant *Manage
staff accounts* or *Manage roles & permissions*; the Member role can hold only member-scope
permissions; nobody may edit the role they themselves hold; every grant and withdrawal is audited.

---

## 3. Routes

76 page routes exist. Grouped by area:

**Signed-out (4 + help):** `/login`, `/forgot-password`, `/reset-password`, `/change-password`,
`/help`.

**Member portal (17):** `/`, `/savings`, `/savings/deposit`, `/shares`, `/shares/buy`, `/loans`,
`/loans/[id]`, `/loans/apply`, `/loans/repay`, `/transactions`, `/transactions/[id]`,
`/statements`, `/reports`, `/guarantees`, `/notifications`, `/profile`, `/more`,
plus `/no-member-record` for a login with no member record.

**Back office (51 documented routes; all render — see §5):** four role dashboards
(`/staff/admin`, `/staff`, `/staff/desk`, `/staff/loans-desk`), members, categories, savings,
shares, loans, transactions, finance, reports, users, roles, settings, audit, notifications and
profile — the full list and per-screen headings are in `SCREENSHOT_INVENTORY.md`.

**Development only:** `/dev/preview` (a design QA harness that returns 404 when
`NODE_ENV=production`) and `/admin/[[...path]]` (a redirector that sends any `/admin…` URL to the
signed-in person's own dashboard).

---

## 4. Feature inventory

Verified = exercised in the running application during this documentation exercise.

| Module | Role(s) with access | Available? | Verified? | Main actions | Document? |
| --- | --- | :-: | :-: | --- | :-: |
| Sign in (one form for everyone) | All | Yes | Yes | Member number / phone / staff email + password | Both |
| Forced password change on first sign-in | All | Yes | Yes | Choose your own password | Both |
| Forgot password (emailed link) | Accounts that have an email | Yes | Partly — no mail service in the test environment | Request a reset link | Both, with a caveat |
| Password reset at the office | Admin / Manager (members), Admin (staff) | Yes | Yes | Issue a new temporary password | Staff |
| Member dashboard | Member | Yes | Yes | Balances, next payment, quick links, recent activity | Member |
| Member savings | Member | Yes | Yes | Balance, target, history | Member |
| "Save money" payment guide | Member | Yes | Yes | Shows how to pay and the reference to quote — **records nothing** | Member |
| Member shares | Member | Yes | Yes | Shares held, progress to category, purchase history | Member |
| "Buy shares" payment guide | Member | Yes | Yes | Instructions only — **records nothing** | Member |
| Member loans | Member | Yes | Yes | Loan list, balance, schedule, repayment history | Member |
| Loan application from the portal | Member (permission `portal.loan_apply`) | Yes | Yes | Multi-step application | Member |
| "Repay loan" payment guide | Member | Yes | Yes | Instructions only — **records nothing** | Member |
| Member transactions & statements | Member | Yes | Yes | List, detail, printable statement | Member |
| Guarantee requests | Member | Yes | Yes | See loans they guarantee, and their total exposure. **The borrower&rsquo;s name does not display — see V‑5** | Member, with the defect flagged |
| Member notifications | Member | Yes | Yes | Read messages | Member |
| Member profile (read-only) + change password | Member | Yes | Yes | View record; change own password | Member |
| Member registration (5 steps) | Admin, Manager | Yes | Yes | Register, set categories, charge fees, take payment, receipt | Staff |
| Member search / register | All staff | Yes | Yes | Search by number, name or phone | Staff |
| Member edit + change history | Admin, Manager | Yes | Yes | Edit with a mandatory reason; field-by-field history | Staff |
| Member status (Pending/Active/Suspended/Inactive/Archived) | Admin, Manager | Yes | Yes | Change with a reason | Staff |
| Create member login / reset password | Admin, Manager | Yes | Yes | Issue a temporary password | Staff |
| Categories (share + savings tiers) | Admin, Manager (manage); all staff (view) | Yes | Yes | Create, edit, retire; place members | Staff |
| Savings collection | Admin, Manager, Cashier, Field Officer | Yes | Yes | Find a member, record cash/MoMo/bank/cheque against a reference | Staff |
| Savings schedules & waivers | Admin, Manager | Yes | Yes | See paid/partial/missed; waive with a reason | Staff |
| Savings performance analytics | All staff (view) | Yes | Yes | Per-category collection rates | Staff |
| Share sales | Admin, Manager, Cashier | Yes | Yes | Record a share purchase at the stored price | Staff |
| Loan application capture (back office) | Admin, Manager, Loan Officer | Yes | Yes | Capture an application with guarantors | Staff |
| Loan assessment / approval / disbursement | Assess: +Loan Officer; approve & disburse: Admin, Manager | Yes | Yes | Move a loan through its lifecycle | Staff |
| Loan repayments | Admin, Manager, Loan Officer, Cashier | Yes | Yes | Record a repayment; interest-first allocation | Staff |
| Loan products | View: any staff who may see loans; edit: settings permission | Yes | Yes | Define name, code, rate, limits, fees, guarantors | Staff |
| Transactions ledger & detail | All staff (view) | Yes | Yes | Search, filter, open, print receipt | Staff |
| Transaction reversal | Admin, Manager | Yes | **Partly — fails for savings transactions (V‑1)** | Compensating entry with a reason | Staff, with the defect flagged |
| Deposits and withdrawals | Admin, Manager, Cashier | Yes | Yes | Record a member deposit or withdrawal | Staff |
| Finance: Cash at Merchant / Bank / Hand | Admin, Manager, Cashier, Accountant | Yes | Yes | Per-account balances and movements | Staff |
| Finance: receipts, payments, transfers, expenses | Record: Admin, Manager, Cashier, Accountant; approve: Admin, Manager | Yes | Yes | Record and approve | Staff |
| Reconciliation | Admin, Manager, Accountant | Yes | Yes | Record a statement balance and any variance with a reason | Staff |
| Finance reports (cashbook, receipts & payments, P&L) | Admin, Manager, Cashier, Accountant | Yes | Yes | Filter, print, export CSV | Staff |
| Reports (member register, statements, ledgers) | All staff (view); member reports by permission | Yes | Yes | Filter, print as PDF, export CSV | Staff |
| Users (staff accounts) | Admin, Super Admin | Yes | Yes | Create, change role, deactivate, reset password | Staff |
| Roles & permissions | Super Admin only | Yes | Yes | Create roles, switch permissions on and off | Staff |
| Settings | Admin, Manager | Yes | Yes | Members, savings, loans, security, fees, treasury, receipts | Staff |
| Fees | Admin, Manager | Yes | Yes | Define fees; charge, collect and waive them | Staff |
| Audit log | Admin, Manager, Accountant | Yes | Yes | Who changed what, when, and why | Staff |
| Staff notifications | All staff | Yes | Yes | Read messages | Staff |
| Staff profile | All staff | Yes | Yes | Own details; change own password | Staff |
| Supporting documents on finance entries | Finance roles | Partly | **No — file storage is not available in the test environment** | Attach a file to an entry | Excluded; noted as unverified |
| Scheduled nightly maintenance | System (database job) | Yes | Yes | Opens schedules, marks missed, flags loan defaults | Mentioned, not a user action |

---

## 5. Screens suitable for screenshots

Every one of the 51 back-office routes and 17 member-portal routes listed above was loaded in the
running application and screenshotted; none redirected away, which confirms the Super Admin
demonstration account reaches all of them. Role-limited views were captured separately by signing
in as each demonstration role.

**Needs additional verification / excluded from the manuals**

| Area | Why |
| --- | --- |
| Password reset by email link | No mail service exists in the test environment; the request is accepted but no message can be delivered, so the manual describes the office reset in detail and the email path only in outline. |
| Uploading supporting documents to finance entries | Requires Supabase Storage, which the test environment does not provide. |
| Reversing a savings collection | Fails in the current code — see verification finding **V‑1**. Documented as a known issue rather than as a working procedure. |
| The borrower's name on a member's Guarantees screen | Shows as *Unknown member* — see verification finding **V‑5**. Documented as it behaves. |
| Any mobile-money "integration" | Does not exist. The manuals say plainly that payments are recorded by staff, not received by the system. |

---

## 6. Documentation plan

| # | Deliverable | Audience | Source of truth |
| --- | --- | --- | --- |
| 1 | `BAKENYE_SACCO_MEMBER_USER_MANUAL.pdf` | Members | Member-portal routes, captured at phone size, plus the sign-in screens |
| 2 | `BAKENYE_SACCO_STAFF_ADMIN_MANUAL.pdf` | Staff, managers, administrators | Back-office routes at desktop size, per role |
| 3 | `DOCUMENTATION_DISCOVERY_REPORT.md` | SACCO management / reviewers | This document |
| 4 | `DOCUMENTATION_VERIFICATION_REPORT.md` | Reviewers | What was run, what passed, what failed |
| 5 | `SCREENSHOT_INVENTORY.md` | Reviewers | Every screenshot, its screen, role and status |
| 6 | `PDF_MANUAL_QA_REPORT.md` | Reviewers | Page-by-page review of both PDFs |

Writing rules adopted for both manuals:

1. No feature is described unless it was seen working in the running application.
2. Where the system only *records* something a person did elsewhere, the manual says so.
3. Role restrictions are stated on every workflow.
4. No interest rate, fee, deadline or category figure is quoted as SACCO policy — the manuals
   explain where each figure is configured and show the demonstration values as examples.
