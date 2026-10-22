# Backend contracts — SACCO security and reliability remediation

**For the frontend work running in parallel (Codex). This is the server side of
the boundary; it says what the backend now returns, so the screens can be built
against it without reading the server code.**

| | |
| --- | --- |
| Branch | `claude/happy-knuth-y3gay4` |
| Baseline | `main` at `0cf56aba7d22bc946128fb9bd20ebe7b80ff39c4` |
| Audit this implements | `docs/audits/full-system-diagnostic-2026-10-22.md` (branch `claude/cool-sagan-afkvit`, commit `a87331b451cd237c411fd3884f8050156c1f858a`) |
| Migrations added | `0049`–`0052` |
| Applied to production | **No.** Nothing in this work has been deployed or migrated. |

Nothing below changes a financial calculation, a ledger rule, a receipt number,
a role, a permission or an RLS policy. Where a shape *has* changed, it is called
out under **What changed for you** and listed again in §10.

---

## 1. Temporary-password states

An account provisioned by the SACCO — a new member login, a new staff account,
or any account whose password was reset — starts on a temporary password the
issuing officer was shown once. Until the holder replaces it, the database
itself answers "no" to everything: `has_permission()`, `is_staff_user()` and
`current_member_id()` all test `must_change_password`, so the account reads no
records through the REST API either, not just through the screens.

Three states, and the server tells you which one you are in:

| State | `my_session().must_change_password` | What the holder may reach |
| --- | --- | --- |
| On a temporary password | `true` | `/change-password` only. Every other route redirects there. |
| Settled | `false` | Their own dashboard and records, per their role. |
| Refused | n/a — sign-in is refused | Nothing; see §9. |

**What changed for you: nothing.** `my_session()` is unchanged, the redirect to
`/change-password` is unchanged, and `FirstPasswordForm` / `ChangePasswordForm`
keep the same action signatures and the same `ActionResult` shape.

What changed underneath is that the lock can no longer be lifted without the
credential actually changing (F-01). The RPC `log_password_changed()` is retired
and raises; `begin_password_change()` and `complete_password_change()` are
service-role only. **If any frontend code calls `supabase.rpc('log_password_changed')`
directly, it will now fail with `42501`. It should be deleted, not re-pointed —
there is no browser-callable replacement by design.**

---

## 2. First-login password change

`chooseFirstPassword(prev, formData)` — unchanged signature.

Form fields: `current_password`, `password`, `confirm`.

| Outcome | Shape |
| --- | --- |
| Success | redirects to the role's landing path. No result is returned to render. |
| Wrong current password | `{ ok: false, error: 'Your current password is incorrect.', field: 'current_password' }` |
| Password too weak | `{ ok: false, error: '<the SACCO's rule>', field: 'password' }` |
| Mismatch | `{ ok: false, error: 'The two passwords do not match.', field: 'confirm' }` |
| Same as current | `{ ok: false, error: 'Choose a password different from your current one.', field: 'password' }` |
| Session gone | `{ ok: false, error: 'Your session has expired. Please sign in again.' }` |

**One new outcome to render** — the partial failure the two-system ceremony can
produce. The password *did* change, but the lock could not be lifted:

```
{ ok: false,
  error: 'Your password was changed, but your account could not be opened just now. '
       + 'Please sign in with your new password and finish the step again.' }
```

Treat it as an ordinary error alert. The wording is deliberate and should not be
softened: the person's **new** password is the live one, and signing in again
brings them back to this screen, where the step completes. Do not invite them to
retry with their old password — it no longer works.

A transient failure before the credential changed returns
`{ ok: false, error: 'The password could not be changed just now. Please try again.' }`.
That one is a plain retry.

`changePassword()` (profile) has exactly the same contract and returns
`{ ok: true, data: null, message: 'Your password has been changed. Use the new one next time you sign in.' }`
on success.

---

## 3. Forgot password — **suspended**

A SACCO business decision: self-service recovery is unavailable to members and
staff alike. A forgotten password is handled in person by an officer who can
identify the holder.

`requestPasswordReset(prev, formData)` now **always** returns, whatever was
submitted and whether or not the identifier names a real account:

```
{ ok: false,
  error: 'Self-service password recovery is temporarily unavailable. '
       + 'Please contact SACCO Support or visit the SACCO office for assistance.' }
```

The exact string is exported as `RECOVERY_SUSPENDED_MESSAGE` from
`@/lib/recovery` — import it rather than retyping it, so the page and the server
cannot drift apart.

Notes for the screen:

- It is `ok: false`, not a success. The person did not get what they asked for,
  and the page should not look like a confirmation.
- **No field-level error, ever.** The result carries no `field`, because the
  answer must not depend on what was typed. A malformed member number and a
  valid one get the same sentence. Please do not add client-side validation that
  blocks submission or reports "not a valid member number" — that would turn the
  form into an account-existence oracle, which the server is careful not to be.
- Nothing is emailed, nothing is logged against the identifier, and the database
  is not consulted at all.

Three doors are shut, not one, so a saved link or a hand-crafted POST meets the
same refusal:

| Entry point | Behaviour while suspended |
| --- | --- |
| `requestPasswordReset()` server action | the message above |
| `resetPassword()` server action | the same message, before the session is even examined |
| `GET /auth/callback?next=/reset-password` | redirects to `/forgot-password?reason=unavailable` **without spending the code** — no session is created |

So `/forgot-password` should read the `reason=unavailable` query parameter and,
when present, show the same contact-support content it shows after a submission.
That query parameter is how somebody arrives from an old emailed link.

`/reset-password` is unreachable through any supported path. Keep the route, but
it only ever needs to render the suspended message.

Re-enabling is a separate reviewed change, gated on five conditions documented
at the top of `src/lib/recovery.ts`. Please do not build a UI that assumes it is
coming back in this release.

---

## 4. Staff-assisted password reset

`resetUserPassword(prev, formData)` — unchanged signature, field `user_id`.

This is now a three-step ceremony on the server (reserve → install → confirm),
because a Supabase Auth call and a PostgreSQL transaction cannot be made atomic
with each other. **The screen does not see the steps.** What it sees is one of
four results:

| Outcome | Shape | What the officer should understand |
| --- | --- | --- |
| Success | `{ ok: true, data: { password: 'KQPM-4827' }, message: 'Password reset. It is shown only now.' }` | Hand it over. Unchanged from before. |
| Auth failed, rolled back | `{ ok: false, error: 'The password could not be reset just now. Please try again. No password was changed.' }` | Nothing happened. Try again. |
| Auth failed, rollback also failed | `{ ok: false, error: 'The password was not reset, and this account is now locked until a reset succeeds. Their old password still works. Please try the reset again.' }` | The account is confined but usable with its old password. Retry. |
| Installed but not fully recorded | `{ ok: true, data: { password: '...' }, message: 'The temporary password below is active, but the reset could not be fully recorded. Give it to the account holder, then ask an administrator to confirm the reset in the audit log.' }` | **Still a success for the person at the counter.** Show the password. |

**What changed for you:** the last row. A success can now carry a `message` that
is a caveat rather than a confirmation, so `TemporaryPassword` /
`MemberAccountPanel` should render `message` whenever it is present, rather than
assuming a fixed success string. The password is in `data.password` in both
success cases, so the reveal-once card needs no other change.

Permission errors are unchanged and come back through `fail()` as
`{ ok: false, error: 'You do not have permission to perform this action.' }`.
The database decides: `members.manage` for a member login, `users.manage` for a
staff account, and only a Super Admin may reset another Super Admin's.

The plaintext password exists only in the server action and in that one
response. It is never stored, never logged, and never in an audit row.

---

## 5. Session expiry

Unchanged in shape: an idle session is signed out by the middleware on its next
request and lands on `/login?reason=timeout` (plus `next=<path>` when the
destination was a protected page). `/login` already reads `reason` — nothing to
change.

What was fixed (F-08) is which sessions obey the SACCO's configured timeout:

- Every path that opens a session now writes the configured value. Previously
  `/auth/callback` wrote neither cookie, so a session created from an emailed
  link ran on a hardcoded 60 minutes whatever Settings → Security said, and
  skipped the idle check entirely on its first request.
- The `signOut()` **server action** now clears `bnd_last_seen`, `bnd_idle_min`
  and the recovery marker, as the `/auth/signout` **route** always did. The
  forms use the route, so this was latent; both are now consistent.

Cookies are `httpOnly` and invisible to the browser. Account standing —
suspended, deactivated, role switched off — is still re-checked at sign-in by
`admitOrRefuse()` and on every page by `requirePermission()` and RLS; a change
of standing mid-session takes effect on the next request, not after a timeout.

---

## 6. Financial submission: success, and uncertainty

**The existing design is correct and is not changing.** `post_transaction()`
returns the original row when it sees an idempotency key it has already posted,
a unique partial index on `transactions(idempotency_key)` makes that race-proof,
and `FinancialForm` holds one stable key per form instance and regenerates it
only after success. A double tap, a browser resend and a dropped response all
carry a key the server has already seen and all post exactly once.

So: **keep the stable-key-per-form-instance behaviour exactly as it is.** It is
the thing that makes everything below safe, and regenerating a key on retry
would break it.

What the backend adds is the missing answer for the *uncertain* case — the
request committed but the response was lost:

```ts
const { data } = await supabase.rpc('submission_status', {
  p_idempotency_key: key,
});
```

`SubmissionStatus` (exported from `@/types/db`):

```ts
{ found: false }
// Nothing was posted under this key. Nothing is owed and nothing is
// half-done; the submission may be made again with the same key.

{ found: true, status: 'posted', reference: 'SAV261022091',
  transaction_id: '…', type: 'monthly_savings', method: 'cash',
  amount: '100000.00',          // a string: do not round it through a float
  occurred_on: '2026-10-22', recorded_at: '…', description: '…',
  receipt_no: 'RCP…' | null, reversed: false, reversal_reference: null }
// It landed. `reference` is what to show and to print a receipt from.

{ found: true, reversed: true, reversal_reference: 'REV261022003', … }
// It landed and has since been reversed. Explain it; do not retry it.
```

Rules this contract depends on:

- **Read-only.** It creates nothing, posts nothing, reverses nothing and repairs
  nothing. Deliberately: deciding that a payment did not happen is a counter
  procedure, not something software should infer from a timeout.
- **Scoped to the submitter.** A caller only ever reads back a posting
  `recorded_by` themselves. It is a receipt for your own submission, not a
  lookup over other people's. It needs no new permission for that reason.
- `found: false` is a normal answer, not an error. An absent key is not a 404.

Suggested use: on a submission that errors in a way that might be a lost
response (a network failure, an aborted request, a timeout) rather than a stated
refusal, ask once, then tell the person what is true — "that payment is
recorded, reference SAV261022091" or "that payment was not recorded; you can
submit it again". Please do not auto-resubmit and do not auto-reverse.

**F-07 is still yours.** `markNotificationsRead()` returns
`ActionResult<unknown>` and returns `{ ok: false, error }` on RPC failure;
`MarkAllRead.tsx` discards it, so a failure stops the spinner, re-renders the
same unread list and tells the user nothing. The server contract is already
correct — see §8. I have not touched the component.

---

## 7. Pagination and reporting

### Member register — `/staff/reports/members`

F-05: the page fetched at most 1,000 rows and then added them up, so past 1,000
members the totals would have read like SACCO-wide figures while understating
savings, share capital and the loan book, and the CSV would have omitted members
silently.

Three things are now true, and the data-layer side of each is done:

**Totals come from the database**, over every member the filter selects:

```ts
const { data } = await supabase.rpc('member_register_totals', {
  p_status: status,   // MemberStatus | null — null means the whole roll
});
```

`MemberRegisterTotals` (from `@/types/db`):

```ts
{ members: 3012,
  savings_balance: '4504354000.00',   // strings, for the same reason as above
  share_count: 345,
  share_value: '3450000.00',
  loan_balance: '2503333.31',
  overdue_amount: '393333.34' }
```

Gated on `members.view` — the same permission the page requires. The totals read
the same views the per-member rows read, so the totals row and the rows above it
reconcile by construction; that is asserted in testing and held exactly at 3,012
members.

**The table pages.** `?page=N`, 250 rows per page, via `.range()`. The page
renders Previous/Next and "Page N of M". This is a plain functional
implementation — **it is yours to design**, and it is the one piece of markup I
added that expects to be replaced. The contract it needs is only: `page` in the
query string, `PAGE_SIZE = 250`, and `Math.ceil(totals.members / PAGE_SIZE)`
pages.

**The CSV is a streaming download**, not a client-side array:

```
GET /staff/reports/members/export?status=<MemberStatus>
```

Permission-gated on `members.view`, checked in the route itself. It streams the
whole roll a page at a time, so memory stays flat however long the register
gets, and sends `Content-Disposition: attachment` with a dated filename. The
page links to it with a plain anchor and passes `showCsv={false}` to
`ExportButtons`, because the component's client-side CSV is the thing that was
truncating. **Please keep the download as a real navigation** (an anchor or a
form) rather than a fetch — a streamed attachment needs the browser to handle
it. Styling the link is yours.

If the stream breaks part way, the last line of the file reads
`EXPORT INCOMPLETE - this file stops after N members. Please try again.` A
register export must never be quietly short.

### Everything else

No other report's shape changed. The PDF path still goes through the browser's
own print engine via `PrintLetterhead` / `printDocument()`.

---

## 8. Notification action results

Unchanged, and already correct:

```ts
markNotificationsRead(): Promise<ActionResult<unknown>>
  → { ok: true, data: … }
  → { ok: false, error: '<a sentence safe to show>' }
```

`mark_notifications_read()` writes only `where user_id = auth.uid()`, so it is
self-scoped and needs no permission check. The failure path is real and
reachable, and it is currently invisible to the user (F-07, §6).

---

## 9. Authentication errors safe to show

These strings are fixed on the server so every path says the same thing. Render
them as given; they are written to be shown to a member at a counter.

| Situation | Message |
| --- | --- |
| Wrong identifier or password | `Invalid login credentials. Please check your identifier and password.` (field `password`) |
| Account inactive or role switched off | `Your account is currently unavailable. Please contact SACCO administration.` |
| Member suspended | `Your account is currently suspended. Please contact the SACCO administration.` |
| Supabase unreachable | `Unable to sign in right now. Please check your connection and try again.` |
| Too many attempts | `Too many unsuccessful attempts. Please wait N minutes and try again, or visit the SACCO office.` |
| Self-service recovery | `RECOVERY_SUSPENDED_MESSAGE` (§3) |
| Session expired mid-action | `Your session has expired. Please sign in again.` |

Two rules worth keeping:

- **Sign-in reveals nothing about which accounts exist.** A member number that
  exists and one that does not produce the same response, including the same
  lockout behaviour. Please do not add anything that distinguishes them.
- Never surface a raw PostgreSQL error. `fail()` in `@/lib/errors` maps SQLSTATE
  codes to sentences; anything unmapped becomes a generic message.

---

## 10. Backend changes that need a matching frontend change

In the order I would do them.

| # | Change | Why | Where |
| --- | --- | --- | --- |
| 1 | **Any direct `rpc('log_password_changed')` call must be deleted.** | The RPC is retired and raises `42501`. There is no browser-callable replacement; the server does it. | grep the client tree; I found none on `main`, but check your branch |
| 2 | `/forgot-password` shows the contact-support page, reads `?reason=unavailable`, and does **not** validate the identifier client-side. | §3. Client-side validation would make the form an account-existence oracle. | `ForgotPasswordForm.tsx`, `forgot-password/page.tsx` |
| 3 | `/reset-password` only ever renders the suspended message. | §3. No supported path reaches it. | `reset-password/page.tsx` |
| 4 | The temporary-password card renders `message` when present, not a fixed success string. | §4, the "installed but not fully recorded" row. | `TemporaryPassword.tsx`, `MemberAccountPanel.tsx`, `UserRowActions.tsx` |
| 5 | The change-password forms render the new partial-failure error like any other error. | §2. No new shape — just make sure a long `error` string is not truncated. | `ChangePasswordForm.tsx`, `FirstPasswordForm.tsx` |
| 6 | Design the member-register pagination controls; keep `?page=N` and 250/page. | §7. My markup is functional, not designed. | `staff/reports/members/page.tsx` |
| 7 | Keep the CSV as a real navigation to `./export`; style the link. | §7. A streamed attachment needs the browser. | same page |
| 8 | **F-07:** surface `markNotificationsRead()`'s failure. | §6, §8. The only place in the codebase where an action result is discarded. | `MarkAllRead.tsx` |
| 9 | *Optional, and only where it helps:* use `submission_status()` to resolve an uncertain money submission. | §6. Not required; the posting path is already duplicate-safe without it. | `FinancialForm.tsx` |

Two things I changed in files that are otherwise yours, so you know rather than
discover them: the member register page's **data fetching** (totals RPC,
`.range()` pagination, the export link and `showCsv={false}`), and the totals
row's label. I left the table markup, the status badges and the print letterhead
alone. I did not touch `MarkAllRead.tsx`, `FinancialForm.tsx`, or any other
component.

Two cosmetic audit items I deliberately left to you rather than risk a conflict:
the unused `Icon` import in `src/components/staff/FinancialActivity.tsx:1` (the
one ESLint warning), and the stale comment in
`src/components/member/PaymentGuide.tsx:16` that refers to `assert_role()`,
which migration `0052` removes.

---

## 11. Things that did not change, and should not

Worth stating plainly, because several are load-bearing and easy to "tidy":

- `my_session()` is the authority on role and permissions. Never the form, never
  a cookie, never a prop.
- The stable idempotency key per form instance, regenerated only on success.
- Immutable transactions and ledger entries; reversal is the only correction.
- Approval segregation of duties (`assert_can_approve`).
- Every balance derived from the database, never computed in the browser.
- `account_movements.running_balance` is the running balance. The sibling column
  `balance_after` is a posting-order artefact and must never be displayed — see
  the warning on the type in `@/types/treasury` (F-15).
- Money amounts cross the boundary as strings wherever this document says so.
  Put them through `toNumber()`; never through `parseFloat` on a formatted
  string.
