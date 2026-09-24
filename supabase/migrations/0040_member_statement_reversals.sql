-- ===========================================================================
-- 0040 — A member statement must account for reversals (finding V-8)
--
-- Found while testing the savings-reversal fix in 0039.
--
-- member_statement() lists a reversed entry and its reversal side by side,
-- which is right: the member should see the correction, not a gap. But the
-- running balance added every listed row by its TYPE alone, ignoring its
-- STATUS. So a reversed deposit of UGX 50,000 was counted twice - once as the
-- cancelled original and once as the reversal - and the statement closed
-- UGX 100,000 above the member's real balance.
--
-- This was reachable before 0039 for deposits, withdrawals and share or loan
-- entries; 0039 makes savings reversible too, so it would have become the
-- normal case. A statement is a document a member takes to a bank, so it has
-- to agree with the dashboard and with the ledger.
--
-- The fix: a reversal carries the opposite sign to the type it reverses. The
-- original keeps its own sign and the pair nets to nothing, so the running
-- balance tells the true story line by line - the balance rose when the money
-- was recorded, and fell again when it was corrected.
--
-- Verified after this migration, for every member: the statement's closing
-- balance equals member_financials.savings_balance equals the ledger.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.member_statement(p_member_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_open  numeric(16,2);
  v_rows  jsonb;
  v_member jsonb;
begin
  if not (can_view_operations() or current_member_id() = p_member_id) then
    raise exception 'You may only view your own statement.' using errcode = 'insufficient_privilege';
  end if;

  select to_jsonb(mf) into v_member from member_financials mf where mf.id = p_member_id;
  if v_member is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  -- Opening balance. A reversal is money coming back out, so it counts with
  -- the opposite sign to the type it reverses; the original it cancelled keeps
  -- its own sign, and the two net to nothing. Counting only `posted` rows here
  -- would drop an entry made before this period and reversed inside it, and
  -- the balance would lose that money twice.
  select coalesce(sum(
           (case when t.type in ('weekly_savings', 'monthly_savings', 'deposit')
                 then t.amount else -t.amount end)
           * case when t.status = 'reversal' then -1 else 1 end), 0)
    into v_open
    from transactions t
   where t.member_id = p_member_id
     and t.status in ('posted', 'reversed', 'reversal')
     and t.type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')
     and t.occurred_on < p_from;

  select coalesce(jsonb_agg(r order by r.occurred_on, r.created_at), '[]'::jsonb)
    into v_rows
    from (
      select t.reference, t.occurred_on, t.type, t.description, t.amount, t.method,
             t.status, t.created_at,
             sum((case when t.type in ('weekly_savings', 'monthly_savings', 'deposit')
                      then t.amount
                      when t.type = 'withdrawal' then -t.amount
                      else 0 end)
                 -- A reversal undoes its original, so it carries the opposite sign.
                 * case when t.status = 'reversal' then -1 else 1 end)
               over (order by t.occurred_on, t.created_at
                     rows between unbounded preceding and current row) + v_open as running_balance
        from transactions t
       where t.member_id = p_member_id
         and t.status in ('posted', 'reversed', 'reversal')
         and t.occurred_on between p_from and p_to
    ) r;

  return jsonb_build_object(
    'member',          v_member,
    'from',            p_from,
    'to',              p_to,
    'opening_balance', v_open,
    'rows',            v_rows,
    'generated_at',    now()
  );
end;
$function$

;

revoke all on function member_statement(uuid, date, date) from public, anon;
grant execute on function member_statement(uuid, date, date) to authenticated;
