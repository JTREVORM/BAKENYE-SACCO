# Responsive audit

Every page is checked at the nine widths the brief lists, with an automated script rather than by
eye. The current result is **45/45 clean**.

```bash
npm run dev
node scripts/responsive-check.mjs
```

Screenshots land in `screenshots/`, and a machine-readable result in `screenshots/report.json`.

---

## What is checked

The script ([`scripts/responsive-check.mjs`](../scripts/responsive-check.mjs)) loads each page in
Chromium at each width — with touch emulation and a mid-range Android user agent below 768px —
and reports:

| Check | Fails when |
| --- | --- |
| Page overflow | `document.scrollWidth` exceeds the viewport — a horizontal scrollbar |
| Element overflow | An element extends past either edge, and no ancestor clips it |
| Tap targets | An interactive element is under 40px tall or 24px wide |
| Clipped text | A leaf element's content is taller than its box, with no scroll and no ellipsis |
| Broken images | `naturalWidth === 0` after load |
| Tiny text | Rendered font size below 10px |

Elements inside a deliberately scrollable container (`.scroll-x`, `.no-scrollbar`, a table's
`overflow-x-auto`) are exempt from the overflow checks — a wide table scrolling inside its own box
is the intended behaviour. `.sr-only` content is exempt from the clipping check, since clipping is
how the technique works.

---

## Widths

| Width | Represents |
| --- | --- |
| 320 | The narrowest Android still in use |
| 360 | The most common Android width in East Africa |
| 375, 390, 430 | iPhone SE / 14 / Pro Max |
| 768 | Tablet, and where cards become tables |
| 1024 | Small laptop, where the staff sidebar becomes permanent |
| 1440, 1920 | Desktop at the branch office |

---

## Coverage

Pages reachable without a session are audited directly. The authenticated screens are audited
through **`/dev/preview`**, a development-only harness that renders the real components against
[`src/lib/fixtures.ts`](../src/lib/fixtures.ts).

That is the harness's whole purpose: it means the member dashboard, the staff member register, the
group register, the collection sheet, the loan portfolio, the loan card, the receipt, the dashboard
stats and every state component are measured as they actually render, without needing a seeded
database. It returns a 404 outside development.

The fixtures are deliberately awkward — a member named *Nakabugo Christine Ssemakula*, an
eight-figure balance, an overdue loan, a reversed transaction. Layouts break on long names and
large numbers, not on tidy ones.

---

## Findings, and what was changed

The audit found four real defects on its first run. All are fixed.

**1 · Horizontal scrollbar on the login screen at every width.**
The decorative blur in the brand band is positioned outside its box, and its parent had no
`overflow-hidden`, so the document widened by 40px. Clipping the parent fixed it. The comment on
that element now says the class is load-bearing, so nobody removes it as decoration.

**2 · "Forgot your password?" was a 16px-tall tap target.**
A bare text link. Now padded to the 44px minimum, with a hover surface so the target is visible.

**3 · Filter chips and sort controls were 36px tall.**
Status filters, transaction-type filters, audit module filters, quick-amount chips and the sort
select were all `h-9`. DESIGN.md sets 44px as the minimum for interactive elements, so they are now
`h-touch-target-min`. This is the change most likely to matter in practice — those chips are what a
cashier taps repeatedly, one-handed, while serving a queue.

**4 · Table action buttons and row links were 26–36px tall.**
The *Review* / *View* buttons in the loans and dashboard tables, and the member-name links in the
register. Raised to 44px. Table rows were already taller than that, so nothing grew.

Two categories of false positive were fixed in the audit itself rather than in the product: an
element positioned outside a clipping ancestor is not an overflow, and `.sr-only` text is not
clipped text.

### Phase One — groups and collections

Adding the group register and the collection sheet to the harness caught two more, both since
fixed and both the same mistake in new code:

**5 · Member-name links on the mobile cards were 24px tall.**
On a card that also carries action buttons, the whole card cannot be one link, so the name was a
bare line of text. The name and the member number are now wrapped in a single
`min-h-touch-target-min` link — one 44px target instead of two small ones. The same pattern was
applied to the savings register, the schedules browser, the group report and the group cards on
*Today's Collections*.

**6 · Collection-sheet table actions were 36px.**
*Record* and the waive control used `size="sm"`. Staff work a collection sheet on a tablet as often
as on a laptop, so both are now the default 44px control.

### Wide desktop

The audit measures overflow and tap targets, which are mobile failure modes. It cannot see that a
layout is *stretched* — a 1,580px search field passes every check it runs. So the back office was
also inspected as a signed-in user at 1280 / 1440 / 1920 through
[`scripts/desktop-shots.mjs`](../scripts/desktop-shots.mjs), which screenshots the real
authenticated screens rather than the fixture harness. Three defects, all fixed.

**7 · Nothing capped the content width.**
Stitch designed at 1440px. On a 1920px monitor the staff area ran the full 1,664px beside the
sidebar: stat cards became 400px of empty space around a single number, the member search field ran
1,580px, and the eye had to cross the whole screen from a page title on the left to its action
button on the right. `max-w-content` (1440px, in `tailwind.config.ts`) now caps and centres the
content, and the header bar shares the same container so the account block lines up with the right
edge of the page instead of floating at the edge of the glass. Below ~1740px nothing changes.

**8 · The sticky action bar covered form fields on desktop.**
`.sticky-actions` pins the primary action to the bottom of the viewport — right for a thumb, wrong
for a mouse. On the group form it parked itself mid-page over *Weekly target per member*. From
`md` up it is now static and simply ends the form.

**9 · The collection-date controls wrapped onto three rows.**
The date input carries `w-full` from `CONTROL_BASE`, which beat the `w-auto` passed to it, so it
filled the row and pushed the arrows either side of it onto lines of their own. It is now sized by
a wrapper instead of by fighting that class.

---

## Layout decisions this verified

**Tables become cards below `md`.** The member register, loan portfolio, savings performance,
pending applications, users, audit log and statement each render as a card list on a phone and as
the full Stitch table on a wider screen. Both are in the markup; neither is a squashed version of
the other.

**The member app works on desktop.** Stitch exported the member screens with `md:hidden` on
`<body>` — they were mobile-only previews. Hiding the member app above 768px would have been a
functional regression, so those screens keep their exact mobile composition and gain a left rail
above `md`, following the transition DESIGN.md describes for the staff sidebar.

**Zoom is not locked.** Stitch exported `maximum-scale=1, user-scalable=no`. That fails WCAG 1.4.4
and the SACCO membership includes older members who rely on pinch-zoom, so the viewport in
[`layout.tsx`](../src/app/layout.tsx) allows scaling to 5×.
