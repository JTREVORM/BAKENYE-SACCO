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
| `savings_mobile` | [`(member)/savings`](../src/app/(member)/savings/page.tsx) | The Stitch composition, with the invented yield rate and the savings-target cards replaced — see below |
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

**The savings target cards are gone.** The Stitch design paired a *Monthly Target* tile with a
progress bar against it. Monthly savings are open: there is no target, so a bar measuring progress
towards one would be measuring nothing. The bento pair keeps its position and treatment and now
shows what the member has saved this month and what they hold in shares — two figures that are
true.

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

---

## The 2026 dashboard redesign

Two approved reference images — the Super Admin overview and the administration dashboard — replace
the Stitch dashboards as the visual source of truth for every role's landing screen. They are a
specification, not inspiration: the navy-and-gold rail, the scenic hero banner, the stat tiles with
their small bar charts, the Recent Transactions register and the Monthly Financial Activity panel
are reproduced as drawn.

### What changed, and where

| Piece | Where it lives |
| --- | --- |
| Surfaces, elevation, gold gradient | [`tailwind.config.ts`](../tailwind.config.ts), [`globals.css`](../src/app/globals.css) |
| Navigation rail (staff + member) | [`Sidebar.tsx`](../src/components/layout/Sidebar.tsx), [`MemberDesktopRail.tsx`](../src/components/layout/MemberDesktopRail.tsx), [`RailBackdrop.tsx`](../src/components/layout/RailBackdrop.tsx) |
| Command bar | [`StaffShell.tsx`](../src/components/layout/StaffShell.tsx) |
| Hero banners | [`Hero.tsx`](../src/components/layout/Hero.tsx) |
| Stat tiles, panels, tables | [`primitives.tsx`](../src/components/ui/primitives.tsx) |
| Recent Transactions | [`RecentTransactions.tsx`](../src/components/staff/RecentTransactions.tsx) |
| Monthly Financial Activity | [`FinancialActivity.tsx`](../src/components/staff/FinancialActivity.tsx) |

The token *names* did not change, so the ~270 files that reference `shadow-neu`, `bg-surface` and
their neighbours were not touched. What changed is what those tokens mean: `surface` is now white
on a cool grey page, and every raised shadow carries a hairline ring that draws the card's edge
without adding a pixel to its box.

### Where the figures come from

Nothing on a dashboard is decoration pretending to be data.

**The small bar charts on the stat tiles are measured series.** `KpiCard` draws one only when the
caller passes `series`, and the only callers that do are the ones with a real history behind the
figure: savings and share purchases, from `collections_trend()`. Active members has no series,
because nothing counts members month by month. Active loans has none either — the figure is a
balance, and a chart of repayments under it would be a chart of something else.

**The funds cards carry no growth percentage.** The references show "+12% from last month" under
each balance. `treasury_summary()` returns a position, not a comparison, so the caption is the date
the balance was computed at, which is a fact the function does return.

**Monthly Financial Activity is `treasury_monthly_flow()`** — money in, money out and the net
between them, the same function the finance screens chart, with internal transfers excluded. It is
labelled as what it is rather than as "Income / Expenses", which is the cashbook's narrower
question.

**The "6 months" control is a real control.** It is a `<details>` disclosure holding two links that
set `?flow=`, not a decorative dropdown.

### Layout by container, not by viewport

The Recent Transactions panel is two-thirds of a dashboard grid on one screen and the whole width
of a phone on another, so the viewport says very little about how much room its columns have — at
1280px, with the grid in three columns, there is *less* room for it than at 1100px. It uses a
container query (`@[45rem]`) to choose between the table and the card list, and another
(`@[64rem]`) to decide whether the description column fits.

### One fix the redesign surfaced

A scroller measured in the fallback font before Inter swapped in, and nothing asked it again
afterwards, because the element's own box never changed size. On a table that fitted exactly, the
"scroll right" arrow sat over the header row forever. `useScrollEdges` now re-measures on
`document.fonts.ready`.

### Checking it

`/dev/preview/dashboard` renders the real chrome and the real dashboard components against
[`fixtures.ts`](../src/lib/fixtures.ts) — no database, no sign-in — and
[`scripts/preview-shots.mjs`](../scripts/preview-shots.mjs) screenshots it at 320, 390, 834, 1440
and 1920, failing on any width that scrolls sideways. `?variant=admin` renders the administration
banner. Both 404 outside development.
