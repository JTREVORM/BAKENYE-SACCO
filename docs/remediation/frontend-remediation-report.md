# Frontend remediation and backend integration report

Date: 22 October 2026 (Africa/Kampala). Repository: `JTREVORM/BAKENYE-SACCO`.

## Integration baseline and delivery

- Branch: `fix/frontend-reliability-support`.
- Claude branch was fetched; its HEAD was verified as **`7735712b8d229adff0a8779f9a7efc7dfaa07616`** before creating this branch directly from that commit.
- Read the entire `backend-contracts.md`, `backend-remediation-report.md`, and the audit at `a87331b451cd237c411fd3884f8050156c1f858a` (the audit file is on its audit branch, not the backend branch).
- Frontend implementation commit: **`a4f84ba1ddf2bd718ff10f5d81fef15c603ae45e`** (all code, browser tests and evidence; its direct parent is Claude's verified commit). This report is a documentation-only child commit. The final delivery commit is also reported in the delivery message; `git rev-parse origin/fix/frontend-reliability-support` identifies the branch tip.
- No merge, deployment, production migration, live-data transaction, or preview configuration change was performed.

## Changes and compatibility

Recovery now uses the premium sign-in presentation, official logo, navy, gold and white. Both recovery routes show support information without fields or submission controls. The text derives from `RECOVERY_SUSPENDED_MESSAGE`; direct visits, `reason=unavailable` and the existing legacy callback have the same destination. No telephone, WhatsApp or support link was invented.

Password forms keep their original server actions, field names, validation, redirects and forced-change restrictions. Alerts display the complete partial-completion message. Field errors have live announcements and descriptions connected to their inputs. A lost response produces cautious sign-in guidance instead of asserting that the password was unchanged. Next navigation signals are preserved.

Staff password dialogs show every returned success message prominently alongside the active password, including the administrative-follow-up caveat. Failures show the exact server error without a password. Dialog state is destroyed on dismissal and is never written to storage or logs. Closing is blocked while processing. Clipboard refusal has visible manual-copy guidance. The staff-account creation dialog likewise clears its password state on dismissal; reopening previously showed the old credential, reproduced before correction. A reproduced create-login defect was also fixed: the dialog now survives the server refresh that changes the control from Create login to Reset password.

Financial forms preserve the existing key generator and one stable key per form instance. Explicit refusals allow correction; uncertain results use the existing read-only, submitter-scoped `submission_status` RPC. A posted result shows the real reference and transaction link; a reversed result explains the reversal. A missing result never triggers a post. Failed verification keeps uncertainty and the original key visible for manual checks. Draft/approval/reconciliation forms do not infer request absence from transaction absence. A reproduced native form-reset defect previously changed the DOM account selector while leaving the React summary on the chosen account. A native reset listener now preserves all entered fields across returned results; the same-key rejection/retry regression verifies the account and ledger outcome end to end. Original successful actions retain their category-specific messages and links, and summaries refresh after confirmed success. No financial RPC, reversal action or business rule was changed.

Notifications now inspect the actual action result, show errors, finish loading, prevent duplicate actions and refresh counts only after success. The notification page's existing “You are all caught up” state confirms the resulting zero unread count.

The register keeps the totals RPC, parallel server queries, 250-row `.range()` pagination and streaming export route. The interface adds status selection, record ranges, First/Previous/Next/Last navigation, boundary states, safe page-number presentation and a styled plain download anchor. Totals explicitly cover all filtered members. Both print and screen disclose that the records are only one register page. The PDF filename includes its register-page number. A reproduced printing defect omitted the 250th record; register-scoped print rules now release the fixed-height shell and use landscape A4.

Receipt secondary text and the document title are at least 12px on screen and print. The approved design, amounts, categories, numbers and issuing rules are retained. Login visibility/recovery controls, collection member links, carousel controls and small form buttons have 44px touch areas. An observed install-prompt race that covered credential dialogs now defers the install offer until other dialogs close.

## Files modified

Implementation:

- `src/app/(auth)/forgot-password/page.tsx`
- `src/app/(auth)/reset-password/page.tsx`
- `src/app/(auth)/change-password/FirstPasswordForm.tsx`
- `src/app/(auth)/login/LoginForm.tsx`
- `src/app/(auth)/login/LoginScene.tsx`
- `src/app/(auth)/login/login.module.css`
- `src/components/auth/RecoverySupport.tsx` (new)
- `src/components/auth/password-feedback.ts` (new)
- `src/components/auth/ChangePasswordForm.tsx`
- `src/components/accounts/TemporaryPassword.tsx`
- `src/components/accounts/MemberAccountPanel.tsx`
- `src/app/(staff)/staff/users/CreateStaffButton.tsx`
- `src/components/forms/FinancialForm.tsx`
- `src/components/forms/submission-feedback.ts` (new)
- `src/components/finance/forms/ExpenseForm.tsx`
- `src/components/finance/forms/PaymentForm.tsx`
- `src/components/finance/forms/TransferForm.tsx`
- `src/components/finance/forms/ReconcileForm.tsx`
- `src/components/MarkAllRead.tsx`
- `src/app/(staff)/staff/reports/members/page.tsx`
- `src/app/(staff)/staff/reports/members/MemberRegister.module.css` (new)
- `src/components/Receipt.module.css`
- `src/components/collections/MemberCollectionPanel.tsx`
- `src/components/ui/form.tsx`
- `src/components/ui/scroll.tsx`
- `src/components/pwa/InstallPrompt.tsx`
- `src/components/staff/FinancialActivity.tsx` (unused import)

Regression tooling: `scripts/frontend-remediation-check.mjs`, `scripts/frontend-layout-check.mjs`, `scripts/frontend-test-proxy.mjs` (new); readiness fixes in `scripts/ui-refinement-check.mjs` and `scripts/receipt-print-check.mjs`; browser/proxy/native sign-out corrections in `scripts/temp-password-check.mjs` with all of Claude's bypass assertions preserved. This report and `frontend-evidence/` contain the review evidence.

All migrations, especially **0049–0052**, auth and financial server actions, RLS, reporting/export logic, CI, security headers, infrastructure and environment files are unchanged from Claude's commit. There are no browser calls to the retired `log_password_changed` RPC.

## Before and after evidence

All screenshots use isolated synthetic data. Temporary-password text is masked in saved dialog captures.

| Interface | Before | After |
| --- | --- | --- |
| Login at 1024px | [Before](frontend-evidence/before-login.png) | [After](frontend-evidence/login-1024.png) |
| Recovery at 390px | [Old form](frontend-evidence/before-recovery.png) | [Support page](frontend-evidence/recovery-390.png) |
| Receipt at 320px | [9px title](frontend-evidence/before-receipt.png) | [Readable title](frontend-evidence/receipt-320.png) |
| Financial confirmation at 320px | [Clipped button](frontend-evidence/before-financial-mobile.png) | [Complete controls](frontend-evidence/confirmation-320.png) |
| Member register | [Before](frontend-evidence/before-register.png) | [Page 1](frontend-evidence/register-page-1.png) · [Page 2](frontend-evidence/register-page-2.png) · [Mobile](frontend-evidence/register-390.png) |

Local production-mode captures: [390px](frontend-evidence/recovery-production-390.png) · [1440px](frontend-evidence/recovery-production-1440.png).

Recovery: [320px](frontend-evidence/recovery-320.png), [390px](frontend-evidence/recovery-390.png), [768px](frontend-evidence/recovery-768.png), [1024px](frontend-evidence/recovery-1024.png), [1280px](frontend-evidence/recovery-1280.png), [1440px](frontend-evidence/recovery-1440.png), [1600px](frontend-evidence/recovery-1600.png), [1920px](frontend-evidence/recovery-1920.png).

Staff reset: [Failure](frontend-evidence/reset-failure.png), [Partial completion](frontend-evidence/reset-partial.png), [Success](frontend-evidence/reset-success.png), [Create-login handover](frontend-evidence/create-login.png).

Password feedback: [First login](frontend-evidence/first-password-partial.png), [Profile](frontend-evidence/profile-password-partial.png).

Financial feedback: [Recovered posting](frontend-evidence/financial-recovered-posted.png), [No posting found](frontend-evidence/financial-not-found.png), [Unverified outcome](frontend-evidence/financial-uncertain.png), [Reversal](frontend-evidence/financial-reversed.png), [Uncertain approval request](frontend-evidence/financial-request-uncertain.png).

[Receipt print preview](frontend-evidence/receipt-print.png), [staff PDF](frontend-evidence/receipt-staff.pdf), [member PDF](frontend-evidence/receipt-member.pdf), [monochrome PDF](frontend-evidence/receipt-monochrome.pdf).

[Notification refusal](frontend-evidence/notifications-error.png), [filtered register](frontend-evidence/register-filtered.png), [complete printed register page](frontend-evidence/register-page-2-complete.pdf).

## Isolated verification

The test environment uses a new disposable PostgreSQL 16 database, the repository's Supabase-compatible bootstrap, **all 52 migrations applied from empty**, and the synthetic seed. A local PostgREST 13.0.7 and the repository's local Auth/Storage gateway serve the real application. The initial 12 members are extended with 1,001 synthetic register records. No hosted Supabase project or preview was used.

Failure injection is confined to a loopback-only test proxy. It can refuse an Auth/RPC call or forward it fully and then replace the response to reproduce a lost result. The actual actions, password ceremony, authorization and RPC results remain in the path. Test URLs are checked for loopback and no environment files are loaded by the new test suite.

| Check | Result |
| --- | --- |
| Empty isolated installation | **52 migrations applied** with synthetic seed |
| Existing SQL suites | **513 assertions passed**, 0 failures, 12 suites |
| Existing `temp-password-check.mjs` browser suite | **20 checks passed**, 0 problems, against the emulator and real remediated RPCs |
| Real PostgREST temporary-password security boundary | **12 checks passed**, 0 problems |
| Phone/dashboard unit tests | **46 passed**, 0 failed/skipped |
| Money formatting tests | **22 passed**, 0 failures; existing absolute import adapted locally |
| First-login and profile browser flows | Passed: field errors, complete partial message, actual new credential, restrictions and redirect |
| Staff reset browser flows | Passed: refusal, active-password caveat, normal success, loading completion and reveal-once dismissal |
| Create-login and create-staff dialogs | Passed: survive refresh, display password, clear state after dismissal |
| Install prompt/dialog interaction | Passed: defers until credential dialog closes, offer remains usable |
| Financial frontend/backend regression | **7 flow groups passed**: success/ref/link; rejection/same-key retry; lost response/posted; absent/manual retry; failed lookup/reversal; real RPC same-key reuse; uncertain approval request |
| Notification browser flows | Passed: refusal visible and unread; button re-enabled; success refreshes database count to zero |
| Member register | Passed at **1,013 members**: 250/page, authoritative totals, filters, full CSV, printed last record, page disclosures |
| Register/financial confirmation layout | **16 viewport cases passed**, plus full 1,013-record CSV, PDF completeness and invalid/out-of-range page checks |
| Dashboard keyboard/accessibility suite | **26 checks passed** |
| Public recovery/login/receipt width matrix | **All 8 widths passed**, plus legacy callback and 0 runtime errors |
| Dashboard/receipt suite | **194 layout checks and 22 A4 PDF cases passed**, print/PDF actions and keyboard focus, 0 runtime errors |
| Additional full-value financial stress suite | **320 checks passed**, 13 receipt-category checks, 4 staff/member print-shell cases and monochrome output, 0 runtime errors |
| TypeScript | Passed, `tsc --noEmit` |
| ESLint | Passed, 0 errors/warnings |
| Production build | **Passed**, all 79 pages generated; shared JS remains **103 kB** |
| Local production-mode smoke | Passed: recovery/reset/back navigation at 390/1440px, old callback, fixture data suppressed |
| Native GoTrue lifecycle | **Not executed — unavailable**, see limitations |

Required viewports: **320, 390, 768, 1024, 1280, 1440, 1600 and 1920px**. The confirmation checks include a full `UGX 1,250,000,000` figure and explicit button bounds. At 320px the original confirmation bar clipped the submit button despite no page overflow; narrow controls now stack.

The new integration script supports `FRONTEND_SCOPE=public|auth|staff|notifications|reports|finance` (`all` by default). Supply explicit local `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, synthetic `STAFF_EMAIL`/`STAFF_PASSWORD` and `FRONTEND_TEST_FAULT_FILE`. The local test proxy listens on 55429 and forwards only to the isolated gateway on 55431. Use `FRONTEND_EVIDENCE_DIR` for output. Existing stack bootstrap/setup is documented under `documentation/source/test-stack/`. No new browser checks were wired into CI because CI configuration remains Claude's scope.

## Limitations and failed runs

Native Supabase GoTrue is **not available** in this environment. The local gateway uses PostgreSQL bcrypt and emulates the Auth API. Password installation, real database proof/completion, restrictions, failure semantics and browser feedback can be exercised here; native GoTrue session rotation, token revocation, refresh/cookie interactions and hosted Auth behavior remain **unexecuted release gates**. Emulator success is not native GoTrue certification.

No test ran against live money, a live-connected preview, or production. No assertion here establishes production readiness or authorizes deployment.

Initial browser runs exposed the create-login refresh/unmount defect and an install dialog intercepting reset controls. Both were corrected. One harness assertion accidentally selected Next's route announcer as well as the form alert; the selector was narrowed. Password form fields are intentionally cleared by the existing action lifecycle, so retry tests refill all three fields. The notification test now waits for the transition to finish before asserting the button is enabled. Repeated fixture insertion hit the existing phone guard before `ON CONFLICT`; fixture setup now skips existing rows before insertion. The first temporary-password browser invocation timed out while compiling/navigating the member list. The subsequent run reached sign-out but its Fetch-based helper hit a loopback-host redirect/CORS failure. Its browser harness now uses the configured proxy, suitable navigation waits, suppresses the separately tested install offer, and submits sign-out as the application does: a native POST navigation. All original security assertions were retained and the complete suite passes. A concurrent development recompilation returned one transient receipt HTTP 500. Two legacy stress runs also modified server HTML before selective hydration and consequently failed their runtime-error assertions; the harnesses now explicitly wait for hydrated target nodes and keep those assertions strict. One report test selected hidden print text, and its privileged totals comparison initially omitted the synthetic administrator claims; both harness issues were corrected. Redirect checks now wait for the streamed client navigation. The stock money test's absolute `/var/tmp` import needed a local invocation adapter. Supabase's changelog endpoint returned HTTP 403 under the environment's network policy; no Supabase product configuration or backend behavior was introduced.

No final mandatory local suite has an outstanding failure. Native GoTrue checks remain unexecuted. CI execution was not tested or changed. The broad legacy route/fee/expense suites (`access-check.mjs`, `finance-check.mjs`, `expense-check.mjs`, `membership-fee-check.mjs`) were not rerun as standalone suites; the focused new tests cover the required remediation flows but do not claim every unrelated workflow in those scripts.

The existing production fixture guard suppresses preview data; its streamed response still uses HTTP 200, matching the audit's pre-existing F-17. That routing behavior was preserved. Raw terminal logs under `frontend-evidence/` are normalized only to remove trailing whitespace.

The CLI GitHub credential expired during the task. Publication uses the connected GitHub Git-data tools, with every uploaded blob and the final tree compared against local Git hashes. It changes only the requested new branch. Native GoTrue validation and coordinated production review are required before release.
