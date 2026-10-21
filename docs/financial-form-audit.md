# Form audit — server-action outcomes

21 October 2026 · `claude/cool-mendel-3ey330`.

Certification found savings reaching the ledger while the screen said nothing
(BKC-05). This is the inventory behind the correction: every form that submits
to a server action, what it risks if its outcome is lost, and what was done.

## The defect

A server action's promise resolves with its result on every attempt. What is
unreliable is how the result reaches the screen. `useActionState` publishes it
through an app-router tree update, and on larger pages that update commits only
intermittently — measured at **2 of 10** real savings collections, and **7 of
16** displays for the change-password form before BKC-04. The same update
clears `useFormStatus`, so a control can also stay on "Processing…" after an
outcome that has already been decided.

So a form built on `useActionState` has three failure modes:

| Failure | What the person sees | What actually happened |
| --- | --- | --- |
| Lost confirmation | nothing | the action completed |
| Stuck control | "Processing…" forever | the action completed |
| Lost refusal | nothing | the action was refused |

None of these is visible to the server, and none is caught by a suite that
exercises a flow once.

## The correction

`useSubmission` awaits the call and holds the outcome in component state;
`ActionForm` wires it to a `<form>`; `SubmitButton` reads its pending state from
that form rather than from `useFormStatus`. Converting a form is a two-line
change at the call site, and nothing about the request, the action, the posting
rules or the permissions changes.

A submission now ends in one of **three** stated outcomes, never silence:

- **carried out** — confirmation, reference and receipt link
- **refused** — the server's own message, on the field it belongs to
- **unresolved** — the answer never came back

The third is the one that matters for money. It is not reported as a failure,
because half the time it is not one. The submission keeps its identity — the
same `FormData`, carrying the same idempotency key — and the only action offered
is to send that same submission again. Every posting function in this database
returns the original row for a key it has already seen, so the re-send either
reports the posting that happened or performs the one that never did: exactly
one ledger row either way. Nothing retries on its own.

For actions that carry **no** idempotency key — an approval, a rejection, a
reversal — re-sending is not safe to offer as a button, so those show a notice
that sends the person to the record instead. The posting functions refuse a
second approval or a second reversal, so a reload settles it.

## Corrected

| Form | What it moves | Key | Unresolved outcome |
| --- | --- | --- | --- |
| `FinancialForm` — the envelope for **10 screens**: record savings, buy shares, record repayment, cash movement, member collection, other receipt, payment, transfer, expense, reconcile | ledger postings | yes | full screen, re-send offered |
| `RecordCollectionDialog` — field officer savings collection | ledger postings | yes | full screen, re-send offered |
| `CollectMembershipFeeDialog` | fee receipts | yes | full screen, re-send offered |
| `MemberFeeActions` — pay fees | fee receipts | yes | panel, re-send offered |
| `MemberFeeActions` — charge, waive | member fee records | no | notice, reload to check |
| `ExpenseApproval` | posts an approved expense | no | notice, reload to check |
| `ApprovalControls` — submit, approve, reject, cancel | posts finance documents | no | notice, reload to check |
| `ReverseTransaction` | reverses a ledger entry | no | notice, reload to check |
| `LoanActions` — disbursement | ledger postings | yes | full screen, re-send offered |
| `LoanActions` — approve, reject, write off | loan status | no | notice, reload to check |
| `LoanWizard` | loan application | yes | panel, re-send offered |
| `GuaranteeResponse` | guarantor accept/decline | no | notice, reload to check |
| `FirstPasswordForm` | forced password change | no | notice, reload to check |
| `TemporaryPassword` | issues a one-time password | no | notice, reload to check |
| `ChangePasswordForm` | password change (BKC-04) | no | inline error, control restored |
| `MarkAllRead` | notification read state (BKC-03) | no | inline error, retry offered |

## Left on `useActionState`, with reasons

These were reviewed and deliberately not converted. None posts to the ledger,
none carries money, and for each one the current state is visible by reloading
the page — so a lost confirmation costs a reload, not a reconciliation.

| Form | Why it is left |
| --- | --- |
| `LoginForm`, `ForgotPasswordForm`, `ResetPasswordForm` | Small pages where the update commits reliably; the login form's refusal messages are asserted every run by the lockout suite and have never been seen to go missing. A lost outcome here costs a retry, not a record. |
| `RegistrationWizard`, `EditMemberForm`, `MemberStatusControl` | Member records. A repeat registration is refused on the National ID; edits and status changes are last-write-wins, so a repeat is a no-op. |
| `CreateStaffButton`, `UserRowActions`, `RoleDialogs`, `RolePermissionEditor` | Account and permission administration. Repeats are idempotent in effect (a role set twice is the same role), and the audit log records what happened. |
| `AccountAdmin`, `CategoryManager`, `Documents`, `FeeManager`, `LoanProductForm`, `LoanProductStatusControl`, `OrganisationForm`, `SettingsSectionForm`, `ShareSettingsForm` | Configuration. No ledger effect; the saved state is what the page shows after a reload. |

They remain exposed to a lost confirmation and should be converted as ordinary
maintenance. The mechanism is now one import away, so each is a small change.

## The duplicate a key cannot stop

The idempotency key protects one form instance. **Close the dialog, reopen it
and enter the same payment, and a new key is generated — the database has no
reason to refuse it.** That is a real way to post a member's money twice, and it
is not addressed by anything in this change.

What already guards it today:

- **Merchant and bank collections** must carry the external reference from the
  confirmation message, and `record_member_collection` refuses a reference
  already recorded against a live transaction. A repeat is blocked outright.
- **Cash collections** require no reference, so nothing stops a second entry.
  This is the open gap.

Proposed server-side safeguard, **not implemented here** because it changes
financial database behaviour and needs its own authorization and review: have
the posting function refuse — or require an explicit override — when the same
member, type, amount and value date are posted twice inside a short window
(a few minutes). It should refuse rather than silently de-duplicate, so that a
genuine second payment of the same amount can still be recorded deliberately.
The reversal path already exists for corrections, so refusing is recoverable.

Until then the mitigation is procedural: the unresolved screen tells the person
not to re-enter the payment, and to check the member's statement first.

## What the suites check

`scripts/certification/collection-check.mjs` runs the savings collection through
a real browser: the ordinary path across three roles at 390px and 1440px, then
a slow answer, three clicks during one slow request, a lost answer where the
posting happened, a lost answer where it did not, a refusal, and a reload after
a confirmed collection. Every attempt asserts that the screen states an outcome,
that **exactly one** ledger row carries the submission's key, that the reference
on screen is the ledger's reference, and that the member's balance moved by the
amount recorded and no more.

See [the certification report](release-certification.md) for results.
