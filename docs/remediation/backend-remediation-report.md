# Backend remediation report

**Security hardening, financial reliability and system remediation for the
Bakenye Unity and Development SACCO backend, against the findings of the
22 October 2026 full-system diagnostic.**

| | |
| --- | --- |
| Repository | `JTREVORM/BAKENYE-SACCO` |
| Branch | `claude/happy-knuth-y3gay4` |
| Commit | `806ff7b655696ea8fe421612a631ea69ff8b7f01` (this report is amended into it, so the SHA names the tree it describes) |
| Base | `main` at `0cf56aba7d22bc946128fb9bd20ebe7b80ff39c4` — verified identical to the audited and deployed commit |
| Audit implemented | `docs/audits/full-system-diagnostic-2026-10-22.md` (branch `claude/cool-sagan-afkvit`, commit `a87331b451cd237c411fd3884f8050156c1f858a`) |
| Prior work reviewed | `claude/cool-mendel-3ey330` at `7b954cacee3e7f754e23472b1f5abee3b4d78b0f` |
| Migrations added | `0049`, `0050`, `0051`, `0052` |
| Date | 22 October 2026 |
| **Deployed** | **No** |
| **Production migrations applied** | **No** |
| **Merged to `main`** | **No** |

---

## A. Note on the branch name

The brief suggested `fix/security-financial-hardening`. This session is
constrained to develop and push on `claude/happy-knuth-y3gay4` and not to push
to any other branch without explicit permission, so all the work is there. The
content is what the brief asked for; only the ref name differs. Say the word and
it can be pushed to `fix/security-financial-hardening` as well.

---

## B. What was confirmed before anything was changed

The audit's central finding was reproduced first, so the fix could be measured
against an observed defect rather than a described one.

**F-01 reproduced** on a clean rebuild of production's schema (48 migrations,
the repository's own synthetic seed), with a member login provisioned exactly as
Supabase Auth's admin API does it and left on a staff-issued temporary password:

| | On a temporary password | After one `log_password_changed()` call |
| --- | --- | --- |
| `must_change_password` | `true` | **`false`** |
| Transactions visible | 0 | **15** |
| Member records visible | 0 | **1** |
| `current_member_id()` | null | **the member** |
| `portal.view` permission | no | **yes** |
| Temporary password still live | — | **yes** |
| Audit rows claiming a password change | 0 | **1** |

The audit's figures exactly. One unauthenticated-parameter RPC converted a
confined session into a fully privileged one, permanently, while the credential
the issuing officer was shown stayed valid and the audit trail recorded the
opposite of what had happened.

**Baseline also confirmed:** 471 assertions across 11 SQL suites passed on the
unmodified schema, matching the audit precisely. That number is the control for
everything below.

---

## C. Prior remediation: what was reused

`claude/cool-mendel-3ey330` contains 16 commits, mostly dashboard and receipt UI
work outside this assignment. It was **not merged**. Four files were reviewed
individually and the password-security design in them was adopted, because it is
sound and keeps the database as the authority:

| Reviewed | Verdict |
| --- | --- |
| `supabase/migrations/20261020144523_verified_password_changes.sql` | **Adopted**, renumbered to `0049` and extended (see below). The begin/complete proof design — snapshot the Auth hash, mint a single-use short-lived nonce, refuse to lift the lock unless the hash moved — is the right shape. |
| `src/app/(auth)/actions.ts` (`updateVerifiedPassword`) | **Adopted**, with clearer failure semantics and an added guard for a missing admin client. |
| `src/lib/supabase/admin.ts` (comment) | Not needed; the existing comment is accurate for this change set. |
| `supabase/tests/members_access_test.sql` | **Adapted** rather than taken, because the retired functions are now called differently. |

What was **added** beyond the prior work:

- The migration was renumbered from a timestamp name to `0049`, matching the
  repository's `NNNN_` convention. A `20261020…` filename sorts after `0048` by
  luck rather than by design, and migrations are applied in filename order.
- F-04's reset reservation (`begin`/`complete`/`abort`), which the prior branch
  did not address.
- `issue_temporary_password()` retired, which the prior branch left in place.
- A dedicated 41-assertion security suite, and a REST-boundary check that is
  proven able to fail.

---

## D. Findings addressed

| Finding | Severity | Status | How |
| --- | --- | --- | --- |
| **F-01** temporary-password bypass | CRITICAL | **Closed, verified at the REST boundary** | `log_password_changed()` retired to a raising stub and revoked from every role; the lock now lifts only through a service-role-only two-step ceremony that requires the Auth password hash to have demonstrably changed |
| **F-03** reset redirect from the `Origin` header | HIGH | **Closed by removal** | The only code path that read the header is gone with the suspended recovery flow; `siteUrl()` replaces it and throws in production rather than guessing |
| **F-04** non-atomic staff reset, fails open | MEDIUM | **Closed** | Reserve → install → confirm, with an explicit abort that restores the prior standing; the audit trail now distinguishes a reset *started*, *issued* and *failed* |
| **F-05** register totals and CSV truncate past 1,000 | MEDIUM | **Closed** | Totals computed in the database over the complete filtered set; the table pages; the CSV is a streaming download covering the whole roll |
| **F-06** `member_financials` scan shape | MEDIUM | **Addressed, measured** | One covering index. 1,510–1,630 ms → 236–264 ms at 3,012 members / 300,143 transactions |
| **F-08** session timeout inconsistency | MEDIUM | **Closed** | `/auth/callback` now writes the configured timeout and a first stamp; the `signOut()` action clears what the route always did |
| **F-09** no Content-Security-Policy | MEDIUM | **Implemented, report-only** | Nonce-based CSP in middleware, `Content-Security-Policy-Report-Only` by default |
| **F-10** maintenance mode would lock everyone out | MEDIUM | **Closed in code** | The gate refuses to close without a bypass token unless total lockout is explicitly requested; the token itself is a production configuration step |
| **F-11** dependency advisories | MEDIUM | **Partly closed** | The three runtime-reaching advisories fixed; 14 → 11, the rest build-time only and needing major upgrades |
| **F-12** no release procedure | MEDIUM | **Documented** | `docs/remediation/release-runbook.md` |
| **F-13** no CI | MEDIUM | **Closed** | `.github/workflows/ci.yml`, four independent jobs, no secrets, fail-on-skip |
| **F-14** no test covers F-01 | MEDIUM | **Closed, and proven** | Two new suites, both demonstrated to fail against the restored defect |
| **F-15** `balance_after` ordering | LOW | **Documented, not altered** | Column comment in the schema and a warning on the TypeScript type; immutable history untouched. A separate controlled change is proposed below |
| **F-19** dead `SECURITY DEFINER` role helpers | LOW | **Closed** | Dropped, after proving nothing references them, with a guard that refuses to run if anything does |
| Recovery / backups | — | **Documented** | `docs/remediation/backup-and-restore.md` |
| **F-02** production/preview share credentials | HIGH | **NOT ADDRESSED** | Needs a second Supabase project, a key rotation and a redeploy. Out of scope here; see §I |
| **F-07** silent notification failure | MEDIUM | **Backend correct; frontend is Codex's** | The action already returns `{ ok: false, error }`; `MarkAllRead.tsx` discards it. Contract documented, component untouched |
| F-16, F-17, F-18, F-20 | LOW | Not in scope | Frontend accessibility, soft-404s, a positive finding, and a counter-procedure recommendation |

---

## E. Exact files changed

### Migrations added (4)

| File | Purpose |
| --- | --- |
| `supabase/migrations/0049_verified_password_changes.sql` | F-01 and F-04. Retires `log_password_changed()` and `issue_temporary_password()`; adds the private `password_security` schema, the change-proof and reset-reservation stores, `begin`/`complete_password_change` (service role only), `begin`/`complete`/`abort_temporary_password_reset` (the officer's own session, so the database keeps deciding who may reset whom), and a trigger that destroys an outstanding change proof whenever an account is locked |
| `supabase/migrations/0050_submission_status_lookup.sql` | `submission_status(key)` — read-only, scoped to the submitter |
| `supabase/migrations/0051_register_totals_and_scale.sql` | F-05, F-06, F-15. `member_register_totals()`, the covering index, and the column comment |
| `supabase/migrations/0052_retire_dead_role_helpers.sql` | F-19. Drops `has_role()` and `assert_role()` behind a guard |

### Tests and tooling added (5)

| File | Purpose |
| --- | --- |
| `supabase/tests/password_security_test.sql` | 41 assertions, every one an attempted bypass |
| `scripts/password-security-rest-check.mjs` | The same control over a real PostgREST with a real bearer token |
| `.github/workflows/ci.yml` | Four independent jobs |
| `.github/scripts/ci-db-setup.sh`, `ci-postgrest.sh`, `ci-verify-detection.sh` | CI's sealed environment, and the proof the check can fail |
| `.github/scripts/check-migration-order.mjs` | Migration numbering, sequence and transaction balance |

### Application changed (12)

| File | Change |
| --- | --- |
| `src/app/(auth)/actions.ts` | `updateVerifiedPassword()` replaces both `log_password_changed()` call sites; `requestPasswordReset()` and `resetPassword()` refuse while recovery is suspended; the `Origin` fallback is gone; `signOut()` clears the session cookies |
| `src/lib/recovery.ts` | The suspension switch, the fixed message, `siteUrl()`, and the five conditions for re-enabling |
| `src/app/auth/callback/route.ts` | Declines to spend a recovery code while suspended; writes the configured idle timeout and a first stamp |
| `src/app/auth/signout/route.ts` | Also clears the recovery marker |
| `src/lib/session-timeout.ts` | Documents what `DEFAULT_IDLE_MINUTES` is now for |
| `src/app/actions/members.ts` | `resetUserPassword()` rewritten as the three-step ceremony with explicit failure handling |
| `src/lib/csp.ts` | The policy, the modes, and the per-request nonce |
| `src/middleware.ts` | CSP applied on every response path; the maintenance gate uses the new decision |
| `src/lib/maintenance.ts` | `maintenanceGateDecision()` — F-10 |
| `src/app/(staff)/staff/reports/members/page.tsx` | Database totals, `?page=N` pagination, link to the streaming export |
| `src/app/(staff)/staff/reports/members/export/route.ts` | The streaming CSV, permission-gated |
| `src/types/{access,db,treasury}.ts` | New RPC and payload types; the F-15 warning |

### Also changed

`scripts/test-db.mjs` (required-suite and empty-suite guards),
`scripts/temp-password-check.mjs` (the bypass-attempt step the audit asked for),
`supabase/tests/members_access_test.sql` (uses the new functions),
`package-lock.json` (dependency fixes; `package.json` untouched).

### Documentation

`docs/remediation/backend-contracts.md`, `release-runbook.md`,
`backup-and-restore.md`, this report, and `evidence/`.

---

## F. The two design decisions worth challenging

Stated plainly, because they are judgement calls rather than mechanical fixes.

### 1. The staff reset takes the lock *before* the credential changes

F-04 is about a reset that committed the lock and an `account.password_reset`
audit row before Supabase Auth had installed the replacement password. The
obvious reading is "change the password first, then set the flag". That is the
wrong fix, and the implementation deliberately does not do it.

Of the two partial states the window can produce:

- **locked, old password still live** — the holder can still sign in, is forced
  through "choose your password", and their old password is accepted there. Fully
  recoverable, and the account is never open on a credential a second person
  knows.
- **new temporary password live, no forced change** — the officer has been shown
  a credential that now works indefinitely. That is F-01's blast radius, created
  by the fix.

So the lock is still taken first. What was actually wrong was the *record*: the
audit trail could not distinguish a reset that succeeded from one that failed.
It now writes `account.password_reset_started` on reservation,
`account.password_reset` only once the database has seen the Auth hash change,
and `account.password_reset_failed` on abort. The officer's screen says which
happened. Three audit actions are new; no existing action changed meaning.

### 2. The maintenance gate fails *open*

F-10: `MAINTENANCE_MODE` was set, `MAINTENANCE_BYPASS_TOKEN` was not, so turning
maintenance on would 503 everybody including the maintainer, recoverable only by
the redeploy you were trying to avoid.

The gate now refuses to close when there is no way back through it, logging
loudly on every request, unless `MAINTENANCE_ALLOW_TOTAL_LOCKOUT=true` says that
is genuinely intended. So the site stays up when the operator has forgotten the
token.

That trades a visible outage for a visible non-event. It is the recoverable
direction — the operator loads the site, sees it serving, reads the log, sets a
token, tries again — and it costs nothing in security, because the gate was
never an access control: everything past it needs a real Supabase session and
RLS still decides every row. If the SACCO would rather the gate always closed,
one line in `maintenanceGateDecision()` changes it.

---

## G. Tests run

All against the disposable stack described in `evidence/README.md`. No test
touched production, any preview deployment, or any real member record.

### Passed

| Suite | Result |
| --- | --- |
| Clean install from empty | **52 migrations apply in order**, first administrator provisioned by the auth trigger, seed applied — 12 members, 143 transactions, 8 loans, 3 accounts |
| SQL suites (12 files) | **513 assertions, 0 failures** — 471 baseline, unchanged, plus 41 new, plus 1 added to the existing access suite |
| `password_security_test.sql` | **41 / 41** — the lock under attempted bypass, proof reuse, expiry, wrong nonce, unchanged-credential completion, privilege escalation, the F-04 failure paths, reset/change concurrency, suspended and deactivated accounts |
| F-01 over real PostgREST | **12 / 12** — `POST /rpc/log_password_changed` → HTTP 403 (42501), and the lock holds: 0 transactions, 0 members, 0 ledger entries, flag untouched, no audit row, credential untouched |
| **Detection check, SQL** | **8 failures against the restored defect** (41 pass / 0 fail on the fixed schema) |
| **Detection check, REST** | **5 failures against the restored defect**, reproducing the audit's HTTP 204, 15 transactions, 1 member, 1 false audit row |
| Migration hygiene | 52 migrations, numbering contiguous, no duplicates, filename order equals numeric order, every `begin;` balanced |
| Remediation migrations re-applied | `0049`–`0052` all re-apply cleanly, so an interrupted production run can be retried |
| F-06 performance | 1,510–1,630 ms → 236–264 ms at 3,012 members / 300,143 transactions, three runs each way, warm cache both ways |
| F-05 reconciliation | Totals from `member_register_totals()` equal the sum of the per-member rows **exactly** on all four figures at 3,012 members |
| `submission_status()` | Correct for a found key, an absent key, empty and null input, and a key recorded by somebody else (not readable) |
| Phone validation | 36 / 36 |
| Money formatting | 22 / 22 |
| TypeScript `--noEmit` | Clean |
| ESLint | 1 warning, pre-existing (see below) |
| Production build | Succeeds, 79 pages, **103 kB shared JS — unchanged from baseline** |
| Accounting invariants | Unaffected: no migration touches a financial record, and the 471 baseline assertions that cover them still pass |

### Not run, and why

| Not run | Why |
| --- | --- |
| Browser suites needing a signed-in staff account against live GoTrue (`temp-password-check`, `access-check`, `finance-check`, `expense-check`, `membership-fee-check`, the dashboard and receipt suites) | They need the test-stack gateway running alongside a built app. The gateway exists but wiring it up was not reached. **The F-01 bypass step was added to `temp-password-check.mjs` and is not yet executed** — it is the one new assertion in this change set that has not itself been run. Its SQL and REST equivalents both pass and both are proven able to fail, so the control is verified; the browser assertion is additional coverage, not the proof. |
| The browser suites in CI | Deliberately out of the workflow rather than in it half-configured. Letting them no-op would be F-14's mistake in a different costume. |
| Native GoTrue password lifecycle (real bcrypt, real `updateUser`) | The disposable stack's auth is Supabase-shaped but not GoTrue. The SQL and REST tests model the credential change by writing `auth.users.encrypted_password` directly, which is exactly what the database compares. `temp-password-check.mjs` is what exercises the real thing, and it has not been run. |
| Load testing | Out of scope, and the brief forbids it against production. |
| Anything against production, preview, or real data | Prohibited by the brief, and not done. |

### Failed

None outstanding. Two assertions in the new SQL suite failed on first run and
were corrected — both were faults in the assertions, not the code: a
`returns void` function compared with `is null`, and a column-name regex that
matched `password_set_at` (a timestamp) and `must_change_password` (a flag).

One CI step I wrote was **wrong and was removed**: it asserted that the whole
migration chain could be re-applied from `0001`. It cannot, and is not meant to
— `create type` has no `if not exists`, and Supabase applies each migration once
and records that it did. The step now asserts the narrower thing that is true
and that matters: the four remediation migrations are individually
re-appliable, which is what makes an interrupted production run retryable.

---

## H. Compatibility requirements

### Backward compatibility with the currently deployed application

Every migration is safe to apply before the new code is promoted, and
`0050`–`0052` are purely additive. `0049` is the one with an effect on
`0cf56ab`, and it is in the safe direction: a password change still changes the
credential but no longer lifts the lock, so the holder stays on "Choose your
password"; staff resets fail outright. **A short window in which first-login
password changes and staff resets do not complete** — a service interruption,
not a security hole, and the right way round. The runbook requires it be kept to
minutes, outside counter hours.

### Breaking changes for callers

| Change | Who must change |
| --- | --- |
| `log_password_changed()` raises and is revoked from every role | Any direct caller. There were none in `main`'s client tree; Codex should grep their branch. There is no browser-callable replacement by design. |
| `issue_temporary_password()` raises and is revoked | Only `resetUserPassword()` called it, and it is updated. |
| `has_role()`, `assert_role()` dropped | Nothing — verified against functions, RLS policies, views, the catalogue and the application tree. One stale *comment* in `src/components/member/PaymentGuide.tsx:16` still mentions `assert_role()`. |
| `ExportButtons` on the register gets `showCsv={false}` | The register page, done. The component is unchanged and every other caller is unaffected. |
| `resetUserPassword()` can return `ok: true` with a caveat `message` | The temporary-password card should render `message` rather than a fixed string — contracts §4, item 4. |

### Frontend coordination

`docs/remediation/backend-contracts.md` is the contract, written for Codex, with
a prioritised list of the nine frontend changes this work implies. Codex's
branch was **not merged** into this one.

### Environment and platform

- Node 22, PostgreSQL 16 locally / 17 on Supabase. No finding depends on the
  difference.
- `package.json` unchanged — `next` 15.5.24 → 15.5.28 and `sharp` 0.35.4 →
  0.35.5 are within existing ranges.
- `NEXT_PUBLIC_SITE_URL` **must** be set in production: `siteUrl()` now throws
  there rather than guessing.

---

## I. Remaining risks

Ordered by what I would do next.

### 1. F-02 — preview deployments carry production credentials. **Still open, and now the most serious finding.**

`SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` remain scoped to both
`production` and `preview`, so every preview deployment runs with an
RLS-bypassing key for the live financial database. Not addressed here: it needs
a second Supabase project, a re-scope, a key rotation and a redeploy, and the
brief explicitly forbids changing the preview/live arrangement as part of this
task.

With F-01 closed, this is the largest security exposure left. It also constrains
testing: nothing may be posted or migrated against a preview while previews
point at live data, which is why everything above ran on a disposable stack.

### 2. The restore has never been tested

`docs/remediation/backup-and-restore.md` documents the procedure and the
rehearsal. Neither has been performed, because performing it needs a copy of
production data and this work took none. **Until somebody runs the rehearsal,
the SACCO's recovery position is unproven**, and on the Free tier there is no
managed point-in-time recovery behind it. A committee decision, not a technical
one.

### 3. `temp-password-check.mjs`'s new step is unrun

The one assertion added here that has not been executed. Low risk — it is a test,
not product code, and the same control is verified two other ways — but it
should be run before the release, and the runbook's §6 covers the same ground by
hand.

### 4. The CSP is report-only and has not been observed in a browser

The policy is written and wired, and the default cannot break anything. But no
report-only run has been collected, so whether it would block something real is
unknown. Two things are already known to need attention before
`CSP_MODE=enforce`: the inline script in `InstallEventCapture.tsx` needs the
nonce, and `NEXT_PUBLIC_SUPABASE_URL` must be set or `connect-src` will not name
the project host. Enforcing without a clean report-only run would risk exactly
what the brief forbids.

### 5. Eleven dependency advisories remain

All build-time only, reachable through `tailwindcss@3` and `eslint-config-next`,
all needing major upgrades (`tailwindcss@4`, `next@16`, `eslint-config-next@14`).
The audit's advice was to leave them, and I agree: they are ReDoS and
file-disclosure issues in build tooling, not runtime exposure, and a Tailwind 4
migration during a security release is the wrong trade. Worth a planned
follow-up. Note that `next` still appears in `npm audit` — **only** via its
bundled `postcss@8.4.31`, not for any Next.js defect; the two cache-poisoning
advisories the audit named are fixed.

### 6. F-15 proposed as a separate controlled change

`account_ledger_entries.balance_after` is a posting-order artefact, wrong by
value date for any backdated entry, and nothing displays it. It is now
documented on the column and on the TypeScript type. Retiring it from the
`account_movements` view needs that view dropped and recreated along with its
dependents, which is a riskier migration than anything here and not justified by
a latent defect. **Recommendation:** a dedicated change that drops it from the
view only, leaving the immutable column in place. Do not recompute stored
history.

### 7. Not addressed, from the audit

F-07's component (Codex's), F-16 (accessibility), F-17 (soft-404s), F-20
(near-duplicate cash warning — a counter procedure before it is code), and the
absence of error reporting and alerting. Nobody is currently told when
production breaks; that remains true.

### 8. Browser suites are still not in CI

See §G. The security assertions are covered; the workflow is honest about what
it does not run.

---

## J. Required production environment changes

Runbook §2 has the detail. Summary, and **none of these has been made**:

| Variable | Value | Required |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://www.bakenye-sacco.online` | **Yes.** Build-time inlined, so it must be set *before* the build that is promoted. `siteUrl()` throws in production without it. |
| `MAINTENANCE_BYPASS_TOKEN` | ≥ 16 random characters | Before maintenance mode is ever used |
| `CSP_MODE` | leave unset (report-only) | No |

Do not change `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` or
`MAINTENANCE_MODE` in this release.

---

## K. Deployment sequence

Full procedure, with the verification steps and the named roles, in
`docs/remediation/release-runbook.md`. The shape:

1. **Confirm F-01 is live** on the hosted schema — one read-only query. If it
   comes back clean, stop and find out why.
2. **Back up the database**, record the SHA-256, and restore it into a throwaway
   to prove it works.
3. **Apply `0049` → `0050` → `0051` → `0052`**, checking each. Verify the grants,
   that the dead helpers are gone, that 9 roles and 39 permissions are
   unchanged, and that every accounting invariant still holds.
4. **Set the environment variables** (§J) on the production target.
5. **Build and promote** — Git deployment is disabled for `main`, so merging
   deploys nothing and somebody must promote by hand.
6. **Verify**, by somebody who did neither the migration nor the deployment,
   including the F-01 bypass attempt over REST. Check it; do not assume it.
7. **Brief the staff**: self-service recovery is withdrawn, and a temporary
   password must be handed over and changed in the member's presence.

Rollback and forward-recovery options, including the explicit warning never to
restore the old `log_password_changed()` to fix a password problem, are in
runbook §8.

---

## L. Integration requirements for Codex

`docs/remediation/backend-contracts.md` is the document; its §10 is the
prioritised list. In short:

1. Delete any direct `rpc('log_password_changed')` call — it now raises.
2. `/forgot-password` shows contact-support, reads `?reason=unavailable`, and
   **must not validate the identifier client-side** — that would make the form
   an account-existence oracle the server is careful not to be.
3. `/reset-password` renders only the suspended message.
4. The temporary-password card renders `message` when present.
5. The change-password forms render the new partial-failure error normally.
6. Design the register pagination controls — keep `?page=N` and 250 per page.
7. Keep the CSV as a real navigation to `./export`.
8. **F-07:** surface `markNotificationsRead()`'s failure in `MarkAllRead.tsx`.
9. Optionally use `submission_status()` for an uncertain money submission — and
   keep the stable idempotency key per form instance exactly as it is, because
   that is what makes the posting path duplicate-safe.

Files of Codex's touched here, so they are known rather than discovered: the
member register page's data fetching and its totals label. Nothing else —
`MarkAllRead.tsx`, `FinancialForm.tsx` and the rest are untouched. Two cosmetic
audit items were left deliberately to avoid conflicts: the unused `Icon` import
in `src/components/staff/FinancialActivity.tsx:1` (the one ESLint warning) and
the stale `assert_role()` comment in
`src/components/member/PaymentGuide.tsx:16`.

---

## M. Confirmation of non-interference

During this work I did **not**: apply any migration to production or to any
preview · deploy, promote or roll back any Vercel deployment · change any
environment variable · change any authentication configuration · merge anything
into `main` · merge Codex's branch · reset any real password · create, reverse or
alter any real transaction · read, export or disclose any production data or
credential · run any destructive or credential-based test against the live site
· change the preview/live database arrangement · change any financial
calculation, ledger rule, receipt-numbering rule, role or permission · add
application-wide rate limiting.

Every test ran against a disposable local PostgreSQL cluster with the
repository's own synthetic seed, behind a local PostgREST, with synthetic
accounts created and destroyed by the tests. The hosted Supabase project was
never contacted. PostgREST 12.2.3 was downloaded from its official GitHub
release.

---

## N. Verdict

**F-01 is closed, and the closure is proven rather than asserted.** The bypass
the audit reproduced over the real REST API now returns HTTP 403 / SQLSTATE
42501, and the lock holds: 0 transactions, 0 members, 0 ledger entries, no audit
row, the flag untouched. The temporary-password design does what migration
`0034`'s header always claimed it did.

More importantly for the next person: the tests that say so have been shown to
fail when the defect is put back. The audit's sharpest observation was that a
dedicated temporary-password suite passed 16/16 while the bypass stood wide
open, because it never attempted the bypass. Both new suites were run against
the restored defect and both fail, with the audit's own numbers; CI runs both
directions on every push, so quietly re-opening the hole — or quietly declawing
the test — fails the build.

F-03, F-04, F-05, F-08, F-10, F-13, F-14 and F-19 are closed. F-06 is addressed
with a measured 6× improvement. F-09 is implemented in the cautious mode. F-11
is partly closed, with the runtime-reaching advisories fixed and the rest
honestly accounted for. F-12 and the recovery position are documented.

**F-02 is still open and is now the most serious finding in the system.** Every
preview deployment still holds an RLS-bypassing key for the live financial
database. It needs a decision this work was not permitted to make.

The financial core was the strongest part of the system before this work and is
untouched by it: 471 baseline assertions still pass unchanged, every accounting
invariant still holds, the shared JS bundle is the same 103 kB, and no
calculation, ledger rule, reference number or permission was altered. Nothing
here has been deployed, no production migration has been applied, and nothing
has been merged to `main`.
