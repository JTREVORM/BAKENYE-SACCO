# Dashboard security remediation and release certification

20 October 2026 · `claude/cool-mendel-3ey330` · baseline `c6a07aa`.

**HOLD — BKC-01 and BKC-02 are fixed and their regressions pass, but notification UI stability remains a release blocker (BKC-03).**

No production mutation, migration, merge, deployment or Vercel change was made.
The only application changes are verified password completion and financial
chart range navigation/scroll restoration and dense-range labels. Approved dashboard layouts, styles,
role definitions, permission predicates and financial calculations are unchanged.

## Blockers

**BKC-01 — fixed in the development branch.** The unsafe RPC is retired and
execution revoked from clients and service role. All three password actions now
use a server-only, one-use proof around successful native Supabase Auth updates.
The database independently verifies that the Auth password hash changed; metadata
updates, unchanged passwords, expired/replayed/wrong-account proofs and direct
client completion cannot unlock accounts. A new staff reset invalidates in-flight
proofs. Completion and its account audit are atomic; disabled accounts stay
disabled. Existing onboarding, current-password checks and recovery marker remain.
See [security review and rollout requirements](password-security-remediation.md).

**BKC-02 — fixed in the development branch.** Instrumentation of the unchanged
baseline showed a correct HTTP 200 RSC response containing the **12-month** chart,
while the client stayed at `/staff` with the old selection. Both successful and
stalled transitions occurred with standard tokens; a longer wait also failed.
This localizes the defect to Next's client navigation, rather than search-param
parsing or financial data. The precise internal Next scheduler cause is not
claimed. The two range links now perform native navigation; a small chart-only
mount effect restores the anchor once streamed content appears. Existing chart
calculations, RPC and styling are unchanged. The 12-month view spaces six axis
labels while retaining all twelve buckets and tooltips. [Investigation evidence](certification-evidence/blocker-investigation.json).

**BKC-03 — notification UI stability remains unresolved.** Repeated native member
checks leave “Mark all read” disabled/busy beyond 30 seconds after the database
update. Passing fresh-session retries do not close this intermittent failure.
Tracing observed overlapping action/refresh requests. Removing the explicit
client refresh did not resolve it (8/10 attempts passed, 2 member attempts failed),
so that speculative application change was reverted. Notifications' application
code, mutation and permissions are unchanged. Final repeated checks of the
restored component fail 4 of 10 attempts; all four database updates persist and
leave peer notifications unread. Results are reported separately below. Certification cannot pass until
this interaction is reliably fixed and repeated member/staff checks pass.

## Final isolated results

| Check | Result / evidence |
| --- | --- |
| Clean installation | PASS: all **49** repository migrations, including one additive security migration; original 48 unchanged. Native GoTrue 2.197.0, PostgREST 13.0.7, PostgreSQL 16. Loopback-only services, random local credentials, disposable marker and tmpfs database. |
| SQL suites | PASS: **472 assertions / 11 suites**, zero failures; all original assertions retained, plus bypass rejection. [SQL output](certification-evidence/database-suites.log). |
| Auth / REST / RLS | PASS: **57/57**; existing staff assignments, two-member mutual isolation, unauthorized writes/reads, temporary/disabled restrictions, logout, native JWT expiry and refresh. [Results](certification-evidence/api-results.json). |
| Password security | PASS: **14/14**; RPC/table grants and definer search paths, original bypass, flag writes, metadata tricks, unchanged/failed native updates, proof expiry/replay/account binding, reset races, native recovery, old-password rejection, refresh, member onboarding and credential-free audit. [Results](certification-evidence/password-results.json). |
| Financial workflows | PASS: **6/6**; actual authenticated savings/receipts, ten shares at UGX 10,000 = UGX 100,000, transfer approval/conservation, loan application/review/approval/disbursement/repayment, expense approval/reversal/duplicate refusal, reconciliation and reports vs ledger. [Results](certification-evidence/workflow-results.json). |
| Dashboard reconciliation | PASS: **11/11**, including seven metrics for all eight staff roles, account counts, member collection figures and ledger-derived Finance balances. [Results](certification-evidence/metrics-results.json). |
| Browser expiry / refresh | PASS: native browser JWT expiry with successful SSR refresh; normal token issuance restored to 3600 seconds with rotation and documented 10-second reuse interval. [Evidence](certification-evidence/refresh-results.json). |
| Chart interactions | PASS: **9/9**, **36 transitions** (6/12/6/12/6), Super Admin/Admin/Manager at 1440/390/320px. Rendered bucket count and every tooltip amount equal real RPC results; keyboard Enter, viewport retention and no overflow checked. [Results](certification-evidence/browser-chart-results.json). |
| Role browser regression | **209 snapshot checks pass after focused rechecks** (initial broad run: 197 pass, 3 failures). Two profile failures were icon-prefixed error-text selector mistakes; corrected staff/member forms pass native password changes, audits and old-password rejection. Earlier attempts remain in evidence. This does **not** close the notification stability failure below. [Results](certification-evidence/browser-results.json). |
| Notification stability | **FAIL: 6/10** final attempts pass; **4 Cashier attempts** remain busy beyond 30 seconds. All four have `ownRead=true`, `peerUnread=true`: writes persist and peer isolation holds, but visible completion fails. Member attempts passed this final run; earlier member failures are retained. Original notification application code is unchanged. [Results](certification-evidence/notification-results.json). |
| Restrictions / lockout | PASS: **14/14**; anonymous reads, role finance access, suspended/inactive/archived/exited members and real-form generic errors/lockout. [Results](certification-evidence/restrictions-results.json). |
| Accessibility / shared styling / preview layouts | PASS: **3/3 existing browser suites**, **80 reported groups**: keyboard/modal/menu, mobile branding, shared non-dashboard styling, loading/error/empty states, 40 staff width scenarios and 10 member widths plus restricted states. [Results](certification-evidence/preview-results.json). |
| Lint / TypeScript / production build | PASS; all eight standard check groups. Dashboard invariants **5/5**, fixture arithmetic **5/5**, phone tests **36/36**, target safety guard **1/1** (six invalid-target variants). [Checks](certification-evidence/standards-results.json), [console](certification-evidence/standards-console.log). |
| Production preview exclusion | PASS: five compiled preview routes throw Not Found before fetching; checked fixture markers absent from public client bundles; signed-out local production HTML/RSC routes protected. Authenticated requests checked by browser regression. |

The test stack now preserves migrations' explicit RPC revocations, rather than
re-granting every public function afterward. Clean runs require an empty private
artifact directory, preventing old results from silently entering a new run.

## Existing role assignments

| Role | Dashboard |
| --- | --- |
| Super Admin / Admin | Administration — `/staff/admin` |
| Manager / Viewer | Overview — `/staff` |
| Loans Officer | `/staff/loans-desk` |
| Cashier | `/staff/desk` |
| Accountant | Finance — `/staff/finance` |
| Field Officer / Collections | `/staff/savings/collect` |
| Member | Member portal — `/` |
| Owner / Secretary / Treasurer | No separate role definitions; none created. |

Assignments were verified through real `my_session()` responses and guards.
[Role/account/ledger snapshot and migration checksums](certification-evidence/synthetic-snapshot.json).

## Production status and remaining limitations

**Production remediation remains on HOLD.** Authorized read-only inspection of
only the deployed function definition and execution grants confirmed the legacy
vulnerable body and `authenticated` execution. The function was **not invoked**;
no account or financial data was read and no exploitation was attempted.
The new migration and matching application must be rolled out together under
separate authorization, followed by hosted verification. This branch's local
PASS does not mean production has been patched.

- The local stack uses PostgreSQL 16; hosted metadata reports PostgreSQL 17.
  Hosted Auth/configuration parity and infrastructure integrations remain
  unverified. No hosted credentials were imported into mutation tooling.
- Native recovery-token/password-update behavior is verified using a disposable
  admin-generated recovery link. External email/SMS delivery and the emailed
  PKCE callback journey remain unverified without a delivery sink.
- Storage has migration-compatible metadata only; actual uploads, signed URLs
  and profile-photo delivery remain unverified. Unsupported endpoints return 501.
  Manual references do not certify external bank/mobile-money settlement.
- Native financial RPCs and SQL assertions cover the complete tested lifecycle;
  browser submission covers collection and expense approval, rather than every
  loan/reversal form. Network-outage/retry recovery remains unverified.
- Chromium desktop/mobile and keyboard behavior are checked. Real-device
  Safari/Firefox and assistive-technology/WCAG audits remain unverified. Native
  Auth access JWTs retain their normal expiry semantics; instant revocation of
  already-issued access tokens is not claimed.

[Reproduction / cleanup](../scripts/certification/README.md) ·
[Desktop/mobile screenshots](certification-evidence/README.md).

Thirty dashboard and six chart review JPGs are included. No failed stability
attempt was replaced by a passing retry in the repeated notification suite. The
open BKC-03 validation failure and unremediated production function prevent an
overall PASS. The isolated database was disposable; no production transaction
was executed.
