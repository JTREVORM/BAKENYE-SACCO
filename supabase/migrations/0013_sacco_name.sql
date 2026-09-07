-- ===========================================================================
-- BUD-SACCO - 0013 - Organisation name correction
--
-- The registered name is BAKENYE UNITY AND DEVELOPMENT SACCO. It was carried
-- as BAKENYE NATIONAL DEVELOPMENT SACCO, which is wrong.
--
-- The name is stored in exactly one place in the database: the payload
-- `receipt_for_transaction()` returns, which is what a printed receipt puts on
-- its letterhead. There is no organisation-settings table and no seeded copy of
-- the name anywhere else, so this one function is the whole change.
--
-- 0006 and 0011 have been corrected in place as well, so a database built from
-- scratch is right at every step. This migration exists because those two are
-- already applied to the live project, where only a fresh `create or replace`
-- takes effect.
--
-- Nothing else is touched: no schema, no policies, no role checks, no document
-- reference prefixes. The body below is 0011's, with one string changed.
-- ===========================================================================

create or replace function receipt_for_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_txn transaction_feed;
begin
  select * into v_txn from transaction_feed where id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found.' using errcode = 'no_data_found';
  end if;

  if not (can_view_operations() or v_txn.member_id = current_member_id()) then
    raise exception 'You may only view your own receipts.' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'transaction',   to_jsonb(v_txn),
    'sacco_name',    'BAKENYE UNITY AND DEVELOPMENT SACCO',
    'receipt_no',    replace(v_txn.reference, 'BND-TX-', 'BND-RCP-'),
    'loan', (
      select jsonb_build_object('loan_no', l.loan_no, 'outstanding', lb.outstanding,
                                'total_payable', l.total_payable, 'next_due_on', lb.next_due_on)
        from loans l join loan_balances lb on lb.loan_id = l.id
       where l.id = v_txn.loan_id
    ),
    'shares', (
      select jsonb_build_object('quantity', sl.quantity, 'unit_price', sl.unit_price,
                                'total_value', sl.total_value)
        from share_lots sl where sl.transaction_id = v_txn.id
    ),
    'balance_after', (
      select coalesce(sum(case when t2.type in ('weekly_savings', 'monthly_savings', 'deposit')
                               then t2.amount else -t2.amount end), 0)
        from transactions t2
       where t2.member_id = v_txn.member_id
         and t2.status = 'posted'
         and t2.type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')
         and (t2.occurred_on, t2.created_at) <= (v_txn.occurred_on, v_txn.created_at)
    )
  );
end;
$$;
