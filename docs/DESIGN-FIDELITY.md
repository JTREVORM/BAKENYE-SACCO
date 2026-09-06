# Design fidelity

The Stitch export is the visual source of truth. This is the record of what was carried over
verbatim, what had to change, and why — so a future reader can tell a deliberate decision from
drift.

The original export is untouched at
[`stitch_bakenye_mobile_sacco_navigator/`](../stitch_bakenye_mobile_sacco_navigator/).

---

## Screens

| Stitch screen | Now | Fidelity |
| --- | --- | --- |
| `member_dashboard_mobile` | [`(member)/page.tsx`](../src/app/(member)/page.tsx) | Verbatim — greeting, royal-blue savings hero with its blurred corner, two-up Shares / Loan Balance, Next Payment strip, 3×2 action grid, transaction stack |
| `bnd_sacco_mobile_app` | — | Byte-identical duplicate of `member_dashboard_mobile` (same MD5). Not ported twice. |
| `savings_mobile` | [`(member)/savings`](../src/app/(member)/savings/page.tsx) | Verbatim, except the invented yield rate — see below |
| `loans_mobile` | [`(member)/loans`](../src/app/(member)/loans/page.tsx) | Verbatim — active-loan card, gold progress bar, Next Payment panel, two actions, apply row, history list |
| `apply_for_loan_step_1…review` | [`LoanWizard.tsx`](../src/app/(member)/loans/apply/LoanWizard.tsx) | Six exported screens → six steps of one flow. Progress header, radio cards and review layout carried over. |
| `transaction_receipt_mobile` | [`Receipt.tsx`](../src/components/Receipt.tsx) | Verbatim treatment, extended to carry everything rule 17 requires |
| `my_profile_mobile` | [`(member)/profile`](../src/app/(member)/profile/page.tsx) | Verbatim — radial-gradient header, verified pill, information list, next-of-kin card |
| `reports_center_mobile` | [`(member)/reports`](../src/app/(member)/reports/page.tsx) | Verbatim tiles and list |
| `members_staff_mobile` | [`MembersBrowser.tsx`](../src/app/(staff)/staff/members/MembersBrowser.tsx) | Mobile cards verbatim; desktop table added |
| `staff_dashboard_desktop` | [`(staff)/staff/page.tsx`](../src/app/(staff)/staff/page.tsx) | Verbatim — sidebar, 80px header, four stat cards, secondary strip, activity timeline, pending-loans table |
| `finance_cashbook_desktop` | [`(staff)/staff/finance`](../src/app/(staff)/staff/finance/page.tsx) | Verbatim — period selector, income and expense columns |
| `audit_logs_desktop` | [`(staff)/staff/audit`](../src/app/(staff)/staff/audit/page.tsx) | Verbatim — search, module filter, five-column table |
| `user_roles_permissions_desktop` | [`(staff)/staff/users`](../src/app/(staff)/staff/users/page.tsx) | Verbatim table; permission matrix now generated from real rules |
| `image.png` | [`public/brand/bnd-logo.png`](../public/brand/bnd-logo.png) | The real BND crest, used throughout |

Screens Stitch did not export — login, password reset, transactions list, shares, member detail,
loan detail, statements, notifications, guarantees, income/expense forms — were built from the
design system it *did* define, using its tokens, type roles, card treatments and spacing.

---

## Tokens

[`tailwind.config.ts`](../tailwind.config.ts) is a 1:1 port of the `tailwind.config` block Stitch
embedded in every screen: every colour, radius, spacing key and font size, under the same names.
A class copied out of the Stitch HTML compiles to exactly the CSS it did before.

The only additions are three `warning` colours — DESIGN.md describes a warning role that the export
never defined a token for — and two cheap keyframes for skeletons.

---

## Assets

Stitch referenced eighteen images from `lh3.googleusercontent.com`, which will eventually expire.
All eighteen were downloaded and committed:

- The crest → `public/brand/bnd-logo.png`. It turned out to be the genuine BND emblem —
  *Obuwangwa bwa Bakenye Bugungumale · Obumu Niigo Amaani* — not a placeholder, so it is used as
  the real logo everywhere.
- The portrait photos → `public/avatars/`. Member photos come from the database in production;
  these remain as demo assets.

Nothing is loaded from a remote host at runtime except the subsetted icon font.

---

## Deliberate departures

Six changes were necessary rather than cosmetic. Each is commented at the point it occurs.

**Zoom is unlocked.** Stitch exported `maximum-scale=1, user-scalable=no`. That fails WCAG 1.4.4,
and the membership includes older members who pinch-zoom. The viewport now allows 5×.

**The member app is not `md:hidden`.** The exported member screens carried `md:hidden` on `<body>`
— they were mobile-only previews. Members do open the app on a laptop at the branch. The mobile
composition is unchanged; wider screens gain a left rail, applying the transition DESIGN.md already
describes for the staff sidebar.

**The savings "Yield Rate +4.2% p.a." badge is gone.** The SACCO has no interest-on-savings product
anywhere in the brief, and printing an invented rate on a member's balance is a false financial
promise. That slot now shows the member's real deposits and withdrawals, in the same position with
the same treatment.

**Dashboard growth pills show real numbers or nothing.** The `+12%` on the stat cards was
decoration. It now shows an actual month-on-month figure, or is not rendered. An invented growth
number on a financial dashboard is worse than no number.

**Desktop tables become cards below `md`.** Rule 27, and the reason the audit passes at 320px.

**Per-row edit pencils open one form.** `my_profile_mobile` drew an edit pencil on every field.
Six one-field round trips is slow on 3G, so the pencils open a single editor with all the contact
fields. Same affordance, one save.

Two smaller ones, both from the responsive audit: filter chips went from 36px to the 44px DESIGN.md
requires, and the reports centre's separate download icon became a single row action — it opened
the same document the view icon did, and a second button that silently does the first button's job
is a false affordance.

---

## Runtime differences

The rendered result matches; how it gets there does not.

Stitch loaded `cdn.tailwindcss.com` — a JIT compiler shipped to the browser on every page load —
plus the full Material Symbols variable font and Inter from Google Fonts. That is roughly 400 KB
of render-blocking overhead before any content, on phones where that is the whole budget.

Now: Tailwind compiles at build time from the identical config, Inter is self-hosted by
`next/font`, and the icon font is subsetted to the glyphs actually used
([`src/lib/icons.ts`](../src/lib/icons.ts)) — about 15 KB instead of ~350 KB.

Same pixels. Considerably less to download.
