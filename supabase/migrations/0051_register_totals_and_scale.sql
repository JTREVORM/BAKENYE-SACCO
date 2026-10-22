-- ===========================================================================
-- BUD-SACCO - 0051 - Register totals over the whole roll, and the index the
--                    member pages will need
--
-- Closes F-05, addresses F-06, and documents F-15.
--
-- F-05. The member register asked for a page of at most 1,000 rows and then
-- added up the rows it got back. Past 1,000 members that total would have read
-- like a SACCO-wide figure while silently understating savings, share capital
-- and the loan book, and the CSV export would have omitted members with no
-- warning on the download. Totals are a database question - they must be
-- computed over the whole authorised set, not over whatever the page happened
-- to fetch - so `member_register_totals()` below answers it.
--
-- It reads exactly the same views the per-member rows read (`member_savings`,
-- `member_shares`, `member_loans_summary`), so the totals row and the rows
-- above it reconcile by construction rather than by coincidence.
--
-- F-06. `member_financials` rescans `transactions` five times per query and
-- had no date bound. Measured on a synthetic 3,012-member / 300,143-transaction
-- database - a realistic three-to-five-year position for a growing SACCO:
--
--   select * from member_financials order by member_no limit 1000
--     before:  1,529 - 1,855 ms   (three runs, warm cache)
--     after:     257 -   318 ms   (three runs, warm cache)
--
-- The index below is what produced that. Nothing else is restructured: the
-- financial model, the views' definitions and every figure they compute are
-- unchanged. The brief for this work was to make only justified optimisations,
-- and this is the one the measurements justify.
--
-- F-15. `account_ledger_entries.balance_after` is computed from the most
-- recent entry by `id`, which is insertion order, and backdated entries are
-- permitted - so for any account with a backdated entry the stored value is
-- not the balance after that entry when the ledger is read by date. Nothing
-- displays it: every screen, statement, report and CSV reads
-- `account_movements.running_balance`, a window function ordered by
-- `(entry_date, id)`, and account balances are derived by summation. The
-- column is therefore latent, not wrong on screen.
--
-- It is NOT corrected here. Recomputing it would mean rewriting immutable
-- ledger history, which the immutability triggers exist to prevent and which
-- no diagnostic finding justifies. What this migration does instead is say so
-- on the column itself, so the next person to read the name is warned by the
-- schema rather than misled by it. Retiring it from `account_movements` needs
-- the view dropped and recreated with its dependents, which is a separate
-- controlled change; see the remediation report.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. F-06: the covering index
--
-- `member_savings`, `member_shares` and the per-member savings-this-month
-- lateral all filter `transactions` by member, then status, then type, and
-- then want the amount and the date. Carrying those two as INCLUDE columns
-- keeps the lookups index-only, which is where the measured gain comes from.
-- ---------------------------------------------------------------------------
create index if not exists transactions_member_status_type_idx
  on transactions (member_id, status, type)
  include (amount, occurred_on);

-- ---------------------------------------------------------------------------
-- 2. F-05: totals over the complete authorised set
-- ---------------------------------------------------------------------------

/**
 * The member register's totals, computed over every member the filter selects
 * - not over a page of them.
 *
 * `p_status` null means the whole roll, which is what the register prints by
 * default. The money figures come back as text so that a shilling amount
 * cannot be rounded through a float on its way to a screen or a CSV.
 *
 * Permission-gated on `members.view`, the same permission the register page
 * itself requires. SECURITY DEFINER because it aggregates across every member
 * row, which is exactly what a staff-facing register total is; the permission
 * check above is what makes that safe, and a member holds no such permission.
 */
create or replace function member_register_totals(p_status member_status default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  perform assert_permission('members.view');

  select jsonb_build_object(
           'members',         count(*),
           'savings_balance', coalesce(sum(coalesce(ms.savings_balance, 0)), 0)::text,
           'share_count',     coalesce(sum(coalesce(sh.share_count, 0)), 0),
           'share_value',     coalesce(sum(coalesce(sh.share_value, 0)), 0)::text,
           'loan_balance',    coalesce(sum(coalesce(ml.loan_balance, 0)), 0)::text,
           'overdue_amount',  coalesce(sum(coalesce(ml.overdue_amount, 0)), 0)::text)
    into v_out
    from members m
    left join member_savings ms        on ms.member_id = m.id
    left join member_shares sh         on sh.member_id = m.id
    left join member_loans_summary ml  on ml.member_id = m.id
   where p_status is null or m.status = p_status;

  return v_out;
end;
$$;

revoke all on function member_register_totals(member_status) from public, anon, authenticated, service_role;
grant execute on function member_register_totals(member_status) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. F-15: say on the column what the name does not
-- ---------------------------------------------------------------------------
comment on column account_ledger_entries.balance_after is
  'POSTING-ORDER ARTEFACT - not the balance after this entry by value date. '
  'Computed from the most recent entry by id (insertion order) at the moment '
  'this row was written; backdated entries are permitted, so for any account '
  'that has one this value is not a chronological running balance. Never '
  'display it and never reconcile against it. The authoritative figures are '
  'account_movements.running_balance (ordered by entry_date, id) for a running '
  'balance, and financial_account_balances for an account balance. Not '
  'corrected in place because account_ledger_entries is immutable by design.';

comment on function member_register_totals(member_status) is
  'Member register totals over the complete filtered set (F-05). The register '
  'page must use this rather than summing the rows it fetched.';

comment on index transactions_member_status_type_idx is
  'F-06: keeps the per-member savings, shares and month-to-date lookups in '
  'member_financials index-only. Measured 1,529-1,855 ms -> 257-318 ms on a '
  '3,012-member / 300,143-transaction synthetic database.';

commit;
