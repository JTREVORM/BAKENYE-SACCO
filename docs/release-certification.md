# Dashboard security remediation and release certification

21 October 2026 · `claude/cool-mendel-3ey330` · baseline `96e1d54`.

**HOLD — BKC-01 to BKC-04 are fixed and every suite passes on a clean run, but
the platform defect behind the last three is not itself fixed: it still reaches
every other server-action form, and it was measured losing the on-screen
confirmation of savings that had already been posted to the ledger (BKC-05).**

No production mutation, migration, merge, deployment or Vercel change was made.
The only application changes are verified password completion, financial
chart range navigation/scroll restoration and dense-range labels, the
notification control's loading, duplicate and error handling, and the
change-password form's result and busy state. Approved dashboard layouts, styles,
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

**BKC-03 — fixed in the development branch.** The unchanged baseline reproduced
the failure at **6/10** attempts; every failure had the write committed
(`ownRead=true`) and the peer's notifications untouched (`peerUnread=true`),
with `aria-busy` still true past 45 seconds. The action POST returned HTTP 200
within 110–155ms and the client reached `router.refresh()` 2–6ms later, so the
action promise always resolved: the control stayed busy because
`useTransition`'s pending state was bound to a **client router update that never
committed**.

Narrowing it took the rest of the question apart. Revalidation paths, the staff
Suspense boundary, the server action itself and transitions were each ruled out;
a plain `router.refresh()` with the read state changed directly in the database
and no action involved still failed, while the same refresh on a probe route
under the same staff layout applied every time. Moving the notifications page
content onto that probe route reproduced the failure, removing only the
notification list fixed it, and restoring the list as bare titles reproduced it
again — so it tracks the size of the rendered list, not `Icon`, `Link` or
relative times. A length sweep applied the update at 1 and 20 items but not at
5, 10, 30, 40, 45 or 50. The server was right throughout: the captured action
response carried the corrected tree (no "Mark all read", "You are all caught
up") on every attempt, and reloading always showed the saved state. Against a
50-item list, `router.refresh()` applied **1/6**, `router.replace()` on the same
route **1/6**, both together **2/6**, and a **native document navigation 6/6**.

The control therefore owns its busy state and settles it on the action's own
result, refuses a second request while one is open, reports a failure and allows
a retry, and shows the saved state through a native navigation — the same
client-navigation defect the dashboard chart ranges navigate around. The
mutation, its RPC, revalidation and permissions are unchanged. No internal
Next.js cause is claimed. [Investigation evidence](certification-evidence/blocker-investigation.json) ·
[pre-fix reproduction](certification-evidence/baseline/bkc-03-baseline-trace.json).

**BKC-04 — fixed in the development branch.** An unchanged build, instrumented
only to log the value the action's promise resolved with, settled the question:
across **16** submissions of a wrong current password the promise resolved with
"Your current password is incorrect." **16/16**, while the form displayed it
**7/16** — and display matched, one for one, the attempts where a client tree
update followed the 200 response. The server refused all 16: the
`auth.password_changed` audit never moved and the new password never became
valid. So `useActionState` does not render the value its own action function has
already returned to the client; it publishes that value through an app-router
update, and on these profile pages the update commits only intermittently.

Moving the result into component state while keeping the form's `action` prop
fixed the message and left a second fault behind: `useFormStatus` clears its
pending state through the same update, so the button stayed disabled on
"Saving…" after an error that had already rendered. The form therefore handles
its own submission in `onSubmit` and holds both the result and the busy state
locally. A synchronous in-flight ref refuses a second submit. Field errors, the
success banner, dropped requests and server failures all render from the
awaited result. The action, its server-side re-authentication, the one-use
verified-completion proof, the audit and the session handling are unchanged, and
no password check moved into the browser. The cost is that this one form now
needs JavaScript, where the form action previously let it submit without it.
[Investigation evidence](certification-evidence/blocker-investigation.json) ·
[pre-fix reproduction](certification-evidence/baseline/bkc-04-baseline-trace.json).

**BKC-05 — new, unresolved, and the reason this is still a HOLD.** BKC-02,
BKC-03 and BKC-04 were each fixed by taking one control off the client
tree-update path. The defect underneath is untouched, and every other form in
the application still publishes its result through `useActionState`.

That is not theoretical. On the stack that had already run a full certification,
**2 of 10** real savings collections through the field officer screen posted to
the ledger with **no "Savings recorded" dialog**: the money was taken and
recorded, and the person at the counter saw nothing. The browser regression's own
Collections check failed the same way once in two runs. On the final clean stack
the same measurement was 15/15, so the rate varies with the state of the
system — but the failures are real, and they are on the money-handling path.
The per-form idempotency key stops a resubmission of the same open dialog; a
re-entered collection carries a new key and would post twice. The forced
first-password change was also seen redirecting only on a second attempt.

None of this is changed here: it is outside BKC-04 and it belongs to the
financial screens, so it needs its own review and regression. The remedy is the
pattern proven three times in this branch — await the action, hold the result
and the busy state locally — applied to the remaining server-action forms,
financial confirmations first.
[Evidence](certification-evidence/baseline/collection-confirmation-exposure.json).

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
| Role browser regression | PASS: **209/209** on the clean run (200 broad checks plus the merged chart rechecks), zero failures. Both staff and member profile password-form checks — the two that failed before — now pass unchanged. Collections, approvals, guarded routes, peer-URL refusals, logout, idle timeout and the temporary-password flow all pass. [Results](certification-evidence/browser-results.json). |
| Change-password form | PASS: **66/66 checks in each of four runs** (two before the clean stack, two on it), **50 wrong-password submissions per run** — four staff roles and a member, each at 390px and 1440px. Every refusal was reported on the current-password field, with the account row, the audit count and both passwords re-checked against Auth afterwards. Also covered per run: confirmation mismatch, policy refusal, reusing the current password, an expired session, a dropped request, an injected HTTP 500, a duplicate submit posting once, and the successful change with its audit and the retirement of the old password. Retained pre-fix evidence: **7/16** displayed. [Run 1](certification-evidence/password-form-results.json), [run 2](certification-evidence/password-form-repeat-results.json), [pre-fix](certification-evidence/baseline/bkc-04-baseline-trace.json). |
| Notification stability | PASS: **54/54 interactions in each of three independent runs** on the final production build — a member and four staff roles at 390px and 1440px, five attempts apiece, plus duplicate-tap refusal and dropped-request recovery per area. Every attempt checked database persistence, the peer account's notifications staying unread, and the control gone after a reload. [Run 1](certification-evidence/notification-results.json), [run 2](certification-evidence/notification-repeat-results.json), [run 3](certification-evidence/notification-recheck-results.json). Retained failures from the previous certification: the **6/10** pre-fix baseline and a **44/54** ordering run. [Baseline](certification-evidence/baseline/bkc-03-baseline-trace.json), [ordering run](certification-evidence/baseline/notification-order-results.json). |
| Server-action confirmations outside the fixed controls | **FAIL (BKC-05): 2 of 10** real savings collections posted to the ledger with no on-screen confirmation on the stack that had already run a full certification; **15/15** confirmed on the final clean stack; the browser regression's Collections check failed the same way once in two runs. The ledger was correct in every case. [Evidence](certification-evidence/baseline/collection-confirmation-exposure.json). |
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
- BKC-05 is a client-side display failure only. No server check, permission or
  audit is bypassed by it, and the ledger was correct in every observed case —
  the risk is that somebody acts on a screen that did not confirm work the
  database had already done.
- A suite that exercises a flow once cannot clear an intermittent defect. That
  is why the notification and change-password suites repeat their interactions
  50+ times each, and why a single green Collections check is not read here as
  evidence that BKC-05 is absent.
- Chromium desktop/mobile and keyboard behavior are checked. Real-device
  Safari/Firefox and assistive-technology/WCAG audits remain unverified. Native
  Auth access JWTs retain their normal expiry semantics; instant revocation of
  already-issued access tokens is not claimed.

[Reproduction / cleanup](../scripts/certification/README.md) ·
[Desktop/mobile screenshots](certification-evidence/README.md).

Thirty dashboard and six chart review JPGs are included. No failed attempt was
replaced by a passing retry: every failed run is kept, and the pre-fix
reproductions for BKC-03 and BKC-04, the previous certification's focused
notification retries and its retained ordering run live under
`certification-evidence/baseline/`. **This is an isolated certification**: a
disposable local stack of real GoTrue, PostgREST and PostgreSQL, seeded with
synthetic accounts and money. It says nothing about the hosted project, which
still runs the unremediated password function. The open BKC-05 failure and that
unremediated production function prevent an overall PASS. The isolated database
was disposable; no production transaction was executed.
