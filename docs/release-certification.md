# Dashboard production-readiness certification

20 October 2026 · Africa/Kampala · `claude/cool-mendel-3ey330` · application base `a0f697f`.

**FAIL — certification remains on HOLD. A real temporary-password security test and an Overview chart-filter browser check fail.**

The isolated environment is established. This phase changes only test tooling,
ignored artifact rules and certification evidence. Approved dashboard designs,
application authentication, permissions, database migrations, security policies,
financial calculations and Vercel configuration are unchanged.

## Results

| Check | Result / evidence |
| --- | --- |
| Clean isolated installation | PASS: PostgreSQL 16, real Supabase Auth/GoTrue 2.197.0 and PostgREST 13.0.7; all 48 repository migrations applied unchanged. Random local credentials; loopback-only endpoints; disposable database marker; tmpfs database. |
| Disposable accounts | PASS: eight existing staff roles, two independent members, one temporary-password account and one disabled account. No production dump, credentials or financial records used. |
| Existing database validation | PASS: **471 assertions, zero failures**, across all 11 SQL suites; transaction rollback. [Full evidence](certification-evidence/database-suites.log). |
| Real Auth / REST / RLS | **56 pass, 1 fail**. Native sign-in/session mappings for all roles; mutual member isolation; own financial figures vs database; denied collections, role escalation, security overview and peer statements; disabled/suspended account restrictions. [Results](certification-evidence/api-results.json). |
| Temporary-password enforcement | **FAIL:** direct `log_password_changed()` grants the account its role permissions while its Auth password remains unchanged. See blocker below. The normal choose-password form is separately tested. |
| Native financial workflows | PASS: six scenarios through real authenticated RPCs: receiving accounts, savings and receipts, transfer submission/approval, ten-share purchase, loan application/review/approval/disbursement/repayment, expense approval/reversal, reconciliation and reports vs ledger. No settings or calculation changes. [Results](certification-evidence/workflow-results.json). |
| Dashboard metric reconciliation | PASS: **11/11**. Seven metrics for every staff role, Administration account counts, Collections savings/shares and Finance balances equal the underlying test registers. [Results](certification-evidence/metrics-results.json). |
| Native expiry / refresh / logout | PASS: expired JWT rejected beyond PostgREST clock skew; native refresh succeeds; logout revokes refresh token. Real browser session survives original token expiry through SSR refresh. [Refresh evidence](certification-evidence/refresh-results.json). |
| Authenticated desktop/mobile browser regression | **198 pass, 1 unresolved failure** after focused retries. All eight staff roles and both members checked at 1440/390/320px; dashboard figures, keyboard drawers, protected routes, native collection/expense actions and logout/Back checks pass. Overview chart-range click timed out. [Results](certification-evidence/browser-results.json). |
| Account restrictions / anonymous access / lockout | PASS: **14/14**. Anonymous data/admin API denial, direct finance reads for all eight staff roles, suspended/inactive/archived/exited member restrictions and real-form generic errors/configured lockout. [Results](certification-evidence/restrictions-results.json). |
| Production preview protection | PASS: all five compiled preview functions throw Not Found before any fetch; public client bundles contain none of the checked fixture markers; signed-out production HTML/RSC routes redirect to login. Authenticated preview requests are also checked in the browser suite. |
| Lint / TypeScript / production build | PASS: `npm run lint -- --ignore-pattern 'work/**'`, `npm run typecheck`, local-credential production build. |
| Existing automated frontend checks | PASS: dashboard certification 5/5, fixture consistency 5/5, phone suite. No frontend or shared styling changes in this phase. |

## Existing role assignments

| Role | Dashboard / destination |
| --- | --- |
| Super Admin | Administration — `/staff/admin` |
| Admin | Administration — `/staff/admin` |
| SACCO Manager | Overview — `/staff` |
| Loan Officer | Loans — `/staff/loans-desk` |
| Cashier / Teller | Cashier — `/staff/desk` |
| Accountant | Finance — `/staff/finance` |
| Field Officer / Collections | Collections — `/staff/savings/collect` |
| Viewer | Overview — `/staff` |
| Member | Member portal — `/` |
| Owner, Secretary, Treasurer | No separate role definitions; none created. Existing operational titles must use an approved existing assignment. |

These assignments come from the clean application migrations and real `my_session()`
responses, not display-name assumptions. Role permissions and `landingPath()` remain
unchanged. [Synthetic database snapshot and migration checksums](certification-evidence/synthetic-snapshot.json).

## Release blockers

**BKC-01 — mandatory temporary-password change can be bypassed.**

`supabase/migrations/0034_temporary_passwords.sql`, `log_password_changed()` (lines
40–54), is executable by an authenticated account. It clears
`app_users.must_change_password` without proving that the native Auth password was
changed. A disposable Cashier account first had no staff permissions. Calling this
RPC directly, without `auth.updateUser()`, made `has_permission('dashboard.staff')`
return true. The API regression deliberately fails on that behavior and restores
the disposable account afterwards. This is within-role access using a temporary
password, rather than escalation to another role.

The normal frontend password-choice form does change the Auth password, but cannot
prevent a caller from bypassing it through REST. Resolving this requires a reviewed
security/backend correction, which is outside the authorized test-only scope.
No policy or financial logic was weakened to make the suite green. Certification
cannot pass until the correction is approved, implemented and the failing
regression passes in an isolated environment.

**BKC-02 — Overview chart-range browser check remains unresolved.**

The focused native browser check clicked the Overview's 12-month option but the
URL remained `/staff` and the rendered selection did not update within 30 seconds.
The Administration range filter passed its focused retry. No chart, navigation or
calculation was patched to hide this failure. Investigate whether this is a client
navigation defect or a browser/environment timing problem, then obtain a clean
repeatable result. [Focused results](certification-evidence/browser-chart-results.json).

The initial notification test also observed a 30-second busy button despite
successful database updates. A fresh session retry passed both persistence and
peer isolation. That earlier timeout is retained in the evidence and should be
considered during stability review; no notification code was changed.

## Limitations and remaining verification

- This is a real local Auth/REST/database stack, not a hosted Supabase staging
  project. Hosted configuration/version parity and real infrastructure integrations
  remain unverified; no production credentials or project were queried.
- Storage has migration-compatible metadata tables only. Actual file upload,
  signed download and profile-photo workflows are unverified; unsupported gateway
  endpoints return 501. Email/SMS recovery delivery is unverified without a local
  delivery sink. Manual payment references do not prove external bank/mobile-money
  settlement.
- SQL suites cover four-eyes controls, guarantors, financial edge cases and
  reconciliation. The additional API lifecycle tests use native tokens. Browser
  coverage proves collection posting and expense approval; it does not claim every
  loan/reversal form has been submitted through the UI.
- Browser automation uses Chromium; real-device Safari/Firefox and assistive
  technology audits remain unverified. Loading/error/empty presentation had passed
  the prior fixture certification; full network-outage/retry recovery remains
  unverified in this phase.

Initial investigation used 60-second tokens and GoTrue's binary default zero-second
refresh reuse interval, which produced refresh collisions. The harness was aligned
to Supabase's documented 10-second reuse interval and normal 3600-second tokens;
rotation remains enabled. The accelerated expiry test still uses native 60-second
tokens, then restores normal issuance. This was a local harness correction, not
an application auth change or a claim about hosted configuration. See
[Supabase session rules](https://supabase.com/docs/guides/auth/sessions).

[Reproduction and safe cleanup](../scripts/certification/README.md) ·
[Desktop/mobile screenshots](certification-evidence/README.md).

Thirty synthetic desktop/mobile screenshots are included. All eight standard check groups passed; the expected failing API security regression remains failing. No merge, deployment, production mutation or Vercel change was performed.
