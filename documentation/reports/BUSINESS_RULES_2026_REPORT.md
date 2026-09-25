# Business-rule change, September 2026

**Prepared:** 25 September 2026
**Revised:** 25 September 2026, after your decisions of the same day (section 10).
**Status:** Complete on the branch `claude/quirky-babbage-i3cjwz`. **Not applied to production.**
**Approval required before:** running migrations `0043` and `0044` against the live database, and
before merge.

The SACCO has replaced the rules the system was built around. This report records what the old
rules were, everything that was changed to carry out the new ones, what was done to protect the
existing production data, and what was tested.

---

## 1. The old business rules, as the system actually implemented them

An audit of the whole repository — schema, migrations, functions, views, RLS, reports, forms,
settings, both portals, the scheduler, the tests, the seed data, the TypeScript types and the two
manuals — found the old model in these places.

### Savings tiers

| Where | What it held |
| --- | --- |
| `savings_categories` (table, seeded in `0021`) | **Diamond Saver** UGX 100,000 monthly, **Gold Saver** UGX 50,000 monthly, **Silver Saver** UGX 5,000 weekly |
| `members.savings_category_id` | Which tier each member was placed in |
| `savings_periods.expected_amount` | What the tier demanded of that member for that week or month |
| `savings_periods.savings_category_id`, `savings_payments.savings_category_id` | The tier a period or payment was raised under |
| `savings_plans` | A per-member override target, written by `set_savings_plan()` |
| `ensure_savings_period()` | Read the member's plan, then their tier, to stamp an expectation on every new period |
| `open_savings_schedules()`, `open_savings_periods()` | Raised a demand row for every categorised member, on a schedule |
| `run_daily_maintenance()` | Swept unpaid periods into `missed` every night |
| `next_savings_due_date()`, `savings_due_date()`, `member_savings_category()` | Due dates derived from the tier's cadence |
| `savings_schedules`, `savings_category_summary`, `savings_category_analytics()`, `savings_performance()`, `savings_dashboard()`, `dashboard_metrics()` | Expected against collected, outstanding, arrears, collection rate, per-tier breakdowns |
| `member_financials` | `savings_expected_amount`, `savings_outstanding`, `savings_next_due_on`, `savings_next_expected`, the tier's name and code |
| Settings | `categories.share_matches_savings`, `members.registration_requires_categories`, `savings.allow_partial_payment` |

### Share tiers

| Where | What it held |
| --- | --- |
| `share_categories` (table, seeded in `0021`) | **Diamond** 50 shares, **Gold** 25 shares, **Silver** 1 share, each with a qualification window in months |
| `members.share_category_id` | Which tier each member was placed in |
| `share_categories_priced` (view) | The tier's total, derived from the one share price |
| `member_share_progress` | Shares remaining, amount remaining, percent complete, `qualifies_by`, `qualified`, `qualification_lapsed` |
| `share_category_summary` | Take-up and qualification rate per tier |
| `share_settings.unit_price` | **UGX 20,000** a share |

### Registration

`fees` held the registration fee as a row. In the production configuration the mandatory
registration fee was the amount carried over from the old `members.registration_fee` setting.

### Screens, forms and reports

The Categories administration screen; the categories step of the registration wizard; the member
category control on the member's page; the savings-plan control; the savings-target prefill on the
Record Savings form; the category filter on the member register; the tier badges on the collection
search, the collection panel and the members browser; the savings tier card, share-progress card and
tier badge in the member portal; the tier rows on the staff dashboard, the savings dashboard and the
savings performance report; the schedules register and its arrears filter; the category columns on
the member ledger and profile.

---

## 2. Files and functions affected

**Two new migrations** — `supabase/migrations/0043_flexible_savings_and_flat_shares.sql` and
`supabase/migrations/0044_retire_savings_waivers.sql`, the second added to carry out your decision
to remove the waiver. Migrations `0001`–`0042` are untouched.

**Database objects restated by `0043`:**

- `ensure_savings_period`, `ensure_member_schedule`, `next_savings_due_date`,
  `open_savings_schedules`, `open_savings_periods`, `set_savings_plan`, `record_scheduled_savings`,
  `record_savings_payment`, `record_member_collection`, `run_daily_maintenance`,
  `savings_payment_minimum_gate`
- `buy_shares` (new signature, with server-side total validation)
- `register_member` (restated from `0038` without the categories step)
- `search_members`, `savings_performance`, `savings_dashboard`, `member_savings_overview`,
  `member_collection_view`, `dashboard_metrics`
- Views rebuilt: `member_share_progress`, `member_financials`, `savings_schedules`,
  `savings_transactions`
- Views dropped: `share_categories_priced`, `share_category_summary`, `savings_category_summary`
- Functions dropped: `savings_category_analytics`, `member_savings_category`,
  `create_share_category`, `update_share_category`, `set_share_category_status`,
  `create_savings_category`, `update_savings_category`, `set_savings_category_status`,
  `set_member_categories`

**Database objects changed by `0044`:**

- Function dropped: `waive_savings_schedule`
- Comments restated on the `savings_status` type and `savings_periods.status`, recording that
  `partial`, `missed` and `waived` now describe history only
- One audit entry, `savings.waivers_retired`. It counts the waived months and writes nothing to
  any financial table.

**Application:** 6 files added, 12 removed, 1 renamed and 60 modified. The whole list is in the
branch's diff; the substantive ones are the member savings, shares, profile and dashboard screens;
the collection panel and its dialogs; the registration wizard; the share purchase form; the savings
dashboard, records and activity screens; the members browser and member page; the reports index;
`src/lib/savings.ts` (which replaces `src/lib/categories.ts`); `src/lib/queries.ts`;
`src/lib/settings.ts`; `src/lib/rbac.ts`; and `src/types/db.ts`. The waiver removal takes out
`src/components/collections/WaiveScheduleDialog.tsx` and the `waiveSchedule` action in
`src/app/actions/collections.ts`.

**Routes:** `/staff/categories` is removed. `/staff/savings/schedules` becomes
`/staff/savings/records`. Every link, navigation entry and capture script that pointed at either was
updated.

---

## 3. The new rules, and where each one lives

| Rule | Where it is enforced | Configurable? |
| --- | --- | --- |
| Registration fee is **UGX 20,000** | A row in `fees` with `charged_when = 'registration'`, charged by `register_member()` | Yes — Settings → Fees. `0043` sets the amount; it does not hard-code it |
| Monthly savings are **open** | `ensure_savings_period()` opens every period with `expected_amount = 0`; nothing derives a target | n/a — there is no target to configure |
| **No** savings categories | Every row in `savings_categories` marked `inactive`; nothing reads them | n/a |
| A month without a deposit raises **no arrears** | `run_daily_maintenance()` no longer sweeps; `recompute_savings_period()` already returned `pending`, not `missed`, for a period expecting nothing | n/a |
| **No** savings target may be set | `set_savings_plan()` refuses, by name | n/a |
| One share costs **UGX 10,000** | `share_settings.unit_price`, read by `share_unit_price()` and charged by `buy_shares()` | Yes — Settings → Shares, through the audited `update_share_settings()` |
| **Any whole number** of shares | `buy_shares()` requires an integer ≥ 1; no category, no ceiling | n/a |
| `Total = quantity × price`, computed by the server | `buy_shares()` multiplies, and refuses when the client's `p_expected_total` disagrees | n/a |

The share price and the registration fee were already configuration in this system. `0043`
preserved that architecture and set the values; neither is written into logic.

---

## 4. How the existing production data was protected

Nothing was deleted, reset or restated. Specifically:

- **No member, transaction, savings payment, share lot, fee charge, receipt, ledger entry or audit
  row is deleted or altered.** `0043` contains no `DELETE` against any of them.
- **`savings_periods` rows keep the `expected_amount` they were raised with.** A period raised
  under Gold Saver still says UGX 50,000 was asked for at the time. New periods are raised with
  zero. A comment on the column records the change and the date.
- **`share_lots` keep the price they were bought at.** Moving the price to UGX 10,000 changes what
  the next purchase costs and nothing that has already happened.
- **`member_fees` keep the amount copied at the moment of charging.** Members charged a different
  registration fee before today keep that figure on their record and on their receipt.
- **The two category registers are retired, not dropped.** Every row in `share_categories` and
  `savings_categories` is set to `inactive` and kept. `members.share_category_id` and
  `members.savings_category_id` keep their values, so the register can still say what tier a member
  joined under. Both tables keep their read policies. Table and column comments record that they
  are historical.
- **`savings_plans` rows are kept** as the record of targets that were once in force. Nothing reads
  them; `set_savings_plan()` refuses to write another.
- Every change `0043` makes to a configured value — the share price, the fee amount, the retirement
  of the categories — writes an `audit_logs` entry naming `system (migration 0043)` as the actor,
  with the old value, the new value and the reason.

**Automated proof.** `supabase/tests/business_rules_2026_test.sql` snapshots every transaction,
share lot and savings period before it writes anything, and asserts at the end that not one of them
was deleted, restated or repriced (checks 8a–8d).

---

## 5. Tests

**New suite:** `supabase/tests/business_rules_2026_test.sql` — 63 checks, covering all seventeen
points the client asked for and several more:

| Asked for | Check |
| --- | --- |
| Registration fee is UGX 20,000 | 1a–1d |
| Member can save UGX 5,000 / 20,000 / 73,500 | 2b, 2c, 2d |
| Multiple deposits in the same month | 2e (three deposits, one month, totals correctly) |
| No deposit in a month creates no overdue obligation | 2g, 2h, 2i, 2j |
| 1 / 10 / 100 shares cost 10,000 / 100,000 / 1,000,000 | 3b, 3c, 3d |
| Invalid, fractional, negative share quantities rejected | 3g, 3h, 3i |
| Historical transactions unchanged | 8a, 8b, 8c, 8d |
| Savings and share balances reconcile with the ledger | 5a, 5b, 5c, 5d |
| Reversals still work | 6a, 6b, 6c, 6d |
| Statements display the new transactions correctly | 7a, 7b, 7c |
| Reports no longer depend on the tiers | 4e, 4f |
| Dashboards contain no obsolete category information | 4c, 4d |
| RLS and role permissions intact | 9a–9h |
| No new waiver can be created, and no historical one was disturbed | 8e, 8f, 8g, 8h, 8i |

It also proves the worked example from the brief (25 shares = UGX 250,000, computed by the
database, 3k) and that a client-supplied total which is not quantity × price is refused (3j).

**Existing suites updated** to the new rules: `audit_fixes_test.sql`, `members_access_test.sql`,
`qa_findings_test.sql`, `rls_isolation_test.sql`.

---

## 6. Regression results

Run against a database built from nothing — the Supabase-compatible bootstrap, all 43 migrations in
order, the first administrator, then the seed.

| Check | Result |
| --- | --- |
| Clean install, `0001` → `0044` | **44 migrations applied**, no error |
| `npm run test:db` (7 SQL suites) on the clean install | **274 passed, 0 failed** (baseline before this work: 210 passed, 0 failed) |
| `npm run test:db` on a database **upgraded** from `0001`–`0042` with the old seed, then `0043` and `0044` | **274 passed, 0 failed**. Check `2j` reads "23 missed month(s) before, 23 after — all of them historical" |
| `node scripts/numbering-check.mjs` | **7/7 passed** — 240 numbers from 24 concurrent connections, all unique and contiguous |
| `node scripts/access-check.mjs` | **0 problems** — staff and member sign-in, every role route, and every forbidden route |
| `node scripts/finance-check.mjs` | Every Finance screen returns 200. The 54 reported "problems" are all `ERR_CERT_AUTHORITY_INVALID` on Google Fonts, an artefact of this container's outbound proxy, not the application |
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm run build` | Compiled successfully |
| Browser smoke test, 19 routes as staff and as a member | Every page renders. `/staff/categories` returns 404, which is the intended outcome |
| Browser rule check, staff and member, 14 assertions | **14/14 passed** — no Waive control anywhere, nothing labelled outstanding, owed, overdue, a target or a collection rate on any screen, UGX 10,000 a share, 100 shares priced at UGX 1,000,000, no Categories step in registration |

---

## 7. RLS and permission comparison

Compared object by object between a database built from `0001`–`0042` and one built from
`0001`–`0044`:

| | Before | After | Difference |
| --- | --- | --- | --- |
| RLS policies in `public` | 59 | 59 | **None.** Every policy identical, name, command, `USING` and `WITH CHECK` |
| Tables with RLS enabled | 42 | 42 | **None** |
| Permission keys | 39 | 39 | **None** |
| Role → permission grants | 83 | 83 | **None** |
| Table grants to `anon` / `authenticated` | 61 | 58 | Only the three dropped views (`share_categories_priced`, `share_category_summary`, `savings_category_summary`) |
| Function grants | — | — | Only the intended removals (the nine category functions and `waive_savings_schedule`) and the three changed signatures. Every new signature carries exactly the grants its predecessor carried: `postgres`, `service_role`, `authenticated` |

Nothing was widened. The suites' own guards confirm it independently:
`members_access_test.sql` check **11a** ("no internal helper is executable by `anon` or
`authenticated`") and **11b** ("a signed-out caller can execute nothing but the public brand") both
pass — 11b caught the two new function signatures before they shipped, because a newly created
function is granted to `PUBLIC` by default; `0043` revokes both explicitly.

**Ledger reconciliation, run after `0044`:** 0 members whose savings balance disagrees with the
ledger, 0 whose share value disagrees with their share lots, 0 savings periods whose paid amount
disagrees with the payments posted into it, and 0 share lots where `total_value` is not
`quantity × unit_price`.

The `categories.view` and `categories.manage` permissions were **deliberately left in place**. See
section 10.

---

## 8. Screens changed

| Area | What changed |
| --- | --- |
| Member → Savings | Savings category card, "still owed", the cycle card with its progress bar against a target, and Recent Cycles are gone. Replaced with: total savings, a plain statement that savings are open, what was saved this month and over how many deposits, shares held with the current price, savings month by month, and recent deposits |
| Member → Save Money | No suggested amount and no target lines. Shows the balance, what was saved this month, and how to pay |
| Member → Shares, Buy Shares | Share category, progress and deadline gone. Shows shares held, price per share, total value, worked examples at 5 / 20 / 100 shares, and purchase history |
| Member → Home | "Next Savings" (category, expected amount, due date) replaced by "Saved this month" |
| Member → Profile | Share and savings category rows replaced by shares held at the current price, and "Monthly savings: open" |
| Staff → Savings | Expected, outstanding, collection rate, schedule status counts and the tier tiles are gone. Shows total held, saved this period, average and largest deposit, members who saved, deposits, and today's takings |
| Staff → Savings records (was Schedules) | Expected / outstanding / status columns replaced by month, deposits, saved, last deposit. The status chips are replaced by one filter: months with savings, months without |
| Staff → Savings activity (was Performance) | Compliance scoring and the per-category filter are gone. Shows deposits, total saved, first and last deposit, and the member's balance |
| Staff → Collect savings | The **Waive** control is removed, along with its dialog and server action. Tier badges and the outstanding figure are gone. The search result shows the balance and what was saved this month; the panel shows total savings, saved this month, shares, month-by-month history and deposits. The amount field starts empty, deliberately |
| Staff → Record savings | The weekly/monthly choice and the target prefill are gone. One empty amount field, any positive amount |
| Staff → Record share purchase | Category quick-pick and "N to reach Gold" are gone. Quick picks are 1/5/10/20/50/100, any whole number is allowed, and the total travels to the database to be checked against its own arithmetic |
| Staff → Register member | Five steps become four; the categories step is removed |
| Staff → Members | The "Saves as" category filter, the category sort and the category column are gone. The column now shows what the member saved this month |
| Staff → Member page | The two category panels are replaced by a savings summary (total, this month, last saved) and a shares summary (count, price, value, last purchase). The category control and the savings-target control are removed |
| Staff → Dashboard, Cashier desk | "Savings arrears" and "Savings due today" are gone; the category-performance panel becomes "Savings this month" |
| Staff → Reports | The "Categories & collections" group becomes "Savings": activity, records, dashboard |
| Staff → Categories | **Removed** |
| Staff → Settings | The Categories section is gone; the Savings section is described as a floor, not a target; "Allow part payments" is removed because nothing can enforce it any more |

Screenshots of every one of these are in `documentation/screenshots/`, recaptured from the running
application. Six screenshots of screens that no longer exist were deleted. The full list is in
`SCREENSHOT_INVENTORY.md`.

---

## 9. Manuals

Both were rewritten for the new rules and rebuilt from source.

| | Version | Pages |
| --- | --- | --- |
| `BAKENYE_SACCO_MEMBER_USER_MANUAL.pdf` | 2.0 | 37 |
| `BAKENYE_SACCO_STAFF_ADMIN_MANUAL.pdf` | 2.0 | 92 |

Both were checked after building: neither contains the words *Silver*, *Gold Saver* or *Diamond*,
nor the phrases *savings category* or *share category*, in any form other than the revision-history
entry that records their removal. The member manual gains four questions — how much must I save,
what if I save nothing, what does a share cost, what does it cost to join. The staff manual's
Categories section is replaced by a Shares section carrying the price table and the rule that the
system, not the form, computes the total.

`README.md`, `documentation/README.md`, `docs/DESIGN-FIDELITY.md`, `docs/RESPONSIVE.md` and
`SCREENSHOT_INVENTORY.md` were updated to match. The two historical reports
(`BAKENYE_SYSTEM_REMEDIATION_REPORT.md`, `DOCUMENTATION_VERIFICATION_REPORT.md`) were left
unaltered: they are the dated record of a different piece of work.

---

## 10. Your decisions, and how each was carried out

You reviewed the first version of this report and settled the six open points. Each is now
implemented; nothing in this section is still waiting on you.

1. **Keep the historical category data.** Done, and unchanged from the first version.
   `members.savings_category_id` and `members.share_category_id` are **not** cleared. Every row in
   `savings_categories` and `share_categories` is kept and marked `inactive`. Nothing reads them:
   no function, view, report, form or screen consults a category when savings or shares are
   recorded. Proven on the upgrade database below — 12 members still carry both tier columns, and
   3 savings plus 3 share category rows survive, inactive.

2. **Keep historical savings expectations unchanged.** Done. No `savings_periods` row was zeroed
   or rewritten; the 23 months recorded as `missed` and the 1 recorded as `waived` on the upgrade
   database are exactly as they were. What changed is only the presentation: no screen, report,
   dashboard, statement or receipt shows them as arrears, outstanding savings or money owed. The
   nightly job no longer marks any month missed (checks `2i`, `2j`), and a month raised under the
   new rules carries `expected_amount = 0` and can never be `missed` or `partial` (check `2k`).

3. **Remove the savings waiver.** Done, in `0044_retire_savings_waivers.sql`.
   - `waive_savings_schedule()` is **dropped**, so no new waiver can be created by anyone through
     any route (check `8e`).
   - The **Waive** button, its confirmation dialog (`WaiveScheduleDialog.tsx`) and the
     `waiveSchedule` server action are removed; the `waive_savings_schedule` RPC is gone from the
     TypeScript types.
   - Nothing historical was rewritten. Existing `waived` rows keep that status for ever:
     `recompute_savings_period()` still leaves a waived month waived (check `8i`), and
     `record_scheduled_savings()` still refuses to post into one (check `8h`). The `waived` value
     stays in the `savings_status` enum, and the audit entries that recorded each waiver stay
     (checks `8f`, `8g`).
   - The migration writes one audit entry, `savings.waivers_retired`, naming how many waived months
     were found and left untouched.

4. **Leave `categories.view` and `categories.manage` alone.** Done. Both permission rows and every
   role grant of them are untouched; no permission was widened anywhere (section 7). Note that
   `savings.waive` is likewise still a permission row — the function it guarded is gone, so it
   grants access to nothing, and removing it would have narrowed roles, which you asked not to do.
   It can be cleaned up with the two category permissions whenever you choose.

5. **Keep registration fee enforcement as implemented.** Done, unchanged. UGX 20,000, mandatory,
   charged by `register_member()`, and the member stays **Pending** until it is paid, because
   `members.activation_requires_fees` is on.

6. **"Allow part payments" was deleted as a setting.** With no target, a part payment is not a
   concept and the setting could no longer do anything. This follows the rule migration `0037`
   established here: a setting is enforced or it is removed.

7. **`savings_kind` still carries `weekly`.** No new weekly period is raised and the cadence is no
   longer a choice at the counter, but the enum value stays because periods raised before the
   change use it. Removing an enum value in place is not possible in PostgreSQL without rewriting
   history.

8. **The seed data was rewritten** to demonstrate open savings — uneven amounts (UGX 5,000 to
   100,000), some months with two deposits, some with none, and share purchases from 1 to 100
   shares. It is demonstration data only and is never run against production.

### Proof on a database upgraded from production's shape

To show the migrations do to real data exactly what this report says, a second database was built
from the bootstrap, migrations `0001`–`0042` and the **pre-change** seed (the tiers, the savings
plans, the weekly schedules, plus a planted waived month), snapshotted table by table, and then
upgraded with `0043` and `0044`:

| | Result |
| --- | --- |
| Transactions changed, deleted or repriced | **0** |
| Share lots changed | **0** |
| Savings periods changed | **0** |
| Member fee charges changed | **0** |
| `members` tier columns changed | **0** — 12 members still carry both |
| Category rows | 3 savings + 3 share, all kept, all now `inactive` |
| Savings plans | 21 kept |
| Historical months | 23 `missed` and 1 `waived`, all kept |
| Share price | 20,000 → **10,000** |
| Registration fee | **20,000**, mandatory, active |
| Audit entries written by the migrations | 4 |
| Full SQL suite on this database | **274 passed, 0 failed** |

### Risks

- **Migrations `0043` and `0044` are not reversible in one step.** Between them they drop three
  views and ten functions. They delete no member, savings, share, fee, transaction or audit row, so
  a rollback is a matter of replaying the earlier definitions, but it is not a single `DOWN`.
  **Take a database backup before applying them.**
- **A member registered from now on is Pending until the UGX 20,000 is paid**, because
  `members.activation_requires_fees` is on and the fee is mandatory. If your counter registers
  members who pay later, that is the correct behaviour; if not, either the setting or the fee's
  mandatory flag is the place to change it, not code.
- **The savings dashboard's "this period" figures will read zero** on a SACCO that has taken no
  savings this month. That is accurate, not a fault.

---

## 11. Deployment

Nothing has been deployed. The work is on `claude/quirky-babbage-i3cjwz` and was developed and
tested against a throwaway local PostgreSQL 16 with a Supabase-compatible gateway, never against
the SACCO's live system. Migrations `0043` and `0044` have **not** been applied to production and
will not be until you say so.

**Order on the day:** back up the database, apply `0043`, then `0044`, then deploy the application
build. The two migrations are forward-only and independent of the deployment order in only one
direction: the new application will not work against a database still at `0042`, so the migrations
go first.
