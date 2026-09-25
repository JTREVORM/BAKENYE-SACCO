begin;

create temp table t_result (n serial, step text, ok boolean, detail text);
create temp table t_ctx (key text primary key, id uuid);

-- ===========================================================================
-- The Membership Fees module (0045), as executable checks.
--
-- What it proves:
--   * a fee paid in full reads Paid with nothing outstanding;
--   * a fee part paid reads Partial, with the balance measured against what
--     the member was charged;
--   * a member who has paid nothing reads Unpaid and owes the whole fee;
--   * several part payments accumulate, and the last one closes the charge;
--   * the counter refuses to take more than is outstanding;
--   * a retried submission does not take the money twice;
--   * activation waits for the whole fee, and part payment does not trigger it;
--   * reversing a payment unwinds only that payment;
--   * receipts, ledger and income all stay consistent with the charges;
--   * nothing historical is duplicated or rewritten;
--   * RLS still scopes a member to their own fee records.
--
-- Brings its own members, logins and money. Rolled back.
-- ===========================================================================

create temp table t_before as
  select id, member_id, type, status, amount, occurred_on from transactions;
create temp table t_fees_before as
  select id, member_id, amount, status, paid_transaction_id from member_fees;
create temp table t_lines_before as
  select id, transaction_id, member_fee_id, amount from fee_payment_lines;
create temp table t_receipts_before as
  select id, receipt_no, transaction_id from receipts;

reset role;

do $fixture$
declare
  v_full uuid; v_part uuid; v_none uuid; v_many uuid;
  v_user uuid := gen_random_uuid();
begin
  v_full := (register_member(jsonb_build_object(
               'full_name', 'Fee Full Test', 'phone', '+256779500001')) ->> 'member_id')::uuid;
  v_part := (register_member(jsonb_build_object(
               'full_name', 'Fee Part Test', 'phone', '+256779500002')) ->> 'member_id')::uuid;
  v_none := (register_member(jsonb_build_object(
               'full_name', 'Fee None Test', 'phone', '+256779500003')) ->> 'member_id')::uuid;
  v_many := (register_member(jsonb_build_object(
               'full_name', 'Fee Many Test', 'phone', '+256779500004')) ->> 'member_id')::uuid;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'fee.part@test.invalid', '', now(), jsonb_build_object('member_id', v_part),
          '{}'::jsonb, now(), now());
  update app_users set must_change_password = false where id = v_user;

  insert into t_ctx values ('full', v_full), ('part', v_part), ('none', v_none),
                           ('many', v_many), ('part_user', v_user);
end;
$fixture$;

set role authenticated;

do $$
declare
  v_full uuid := (select id from t_ctx where key = 'full');
  v_part uuid := (select id from t_ctx where key = 'part');
  v_none uuid := (select id from t_ctx where key = 'none');
  v_many uuid := (select id from t_ctx where key = 'many');
  v_cash uuid := (select id from financial_accounts
                   where account_type = 'cash' and status = 'active' and is_default);
  v_fee   numeric;
  v_row   record;
  v_res   jsonb;
  v_txn   uuid;
  v_num   numeric;
  v_n     integer;
  v_err   text;
begin
  v_fee := registration_fee_amount();

  -- =====================================================================
  -- 1. The required amount comes from configuration
  -- =====================================================================
  insert into t_result (step, ok, detail)
  values ('1a the membership fee is read from the fees table, not hard-coded',
          v_fee = (select sum(amount) from fees
                    where charged_when = 'registration' and status = 'active'
                      and is_mandatory and effective_from <= current_date),
          to_char(v_fee, 'FM999,999,999'));

  insert into t_result (step, ok, detail)
  values ('1b a new member is charged the current fee at registration',
          (select coalesce(sum(amount), 0) from member_fees
            where member_id = v_full and is_mandatory and charged_at_registration) = v_fee,
          to_char(v_fee, 'FM999,999,999'));

  -- =====================================================================
  -- 2. Paid in full
  -- =====================================================================
  v_res := collect_membership_fee(v_full, v_fee, v_cash, 'cash', current_date);
  select * into v_row from member_membership_fee where member_id = v_full;
  insert into t_result (step, ok, detail)
  values ('2a a fee paid in full reads Paid with nothing outstanding',
          v_row.status = 'paid' and v_row.paid_amount = v_fee and v_row.outstanding_amount = 0,
          format('%s paid, %s outstanding, status %s', to_char(v_row.paid_amount, 'FM999,999,999'),
                 to_char(v_row.outstanding_amount, 'FM999,999,999'), v_row.status));

  insert into t_result (step, ok, detail)
  values ('2b paying the whole fee activates the member',
          (select status from members where id = v_full) = 'active',
          (select status::text from members where id = v_full));

  insert into t_result (step, ok, detail)
  values ('2c the payment produced a receipt',
          v_row.last_receipt_no is not null, coalesce(v_row.last_receipt_no, '(none)'));

  -- =====================================================================
  -- 3. Part paid - the production shape: 5,000 against a 20,000 fee
  -- =====================================================================
  v_res := collect_membership_fee(v_part, 5000, v_cash, 'cash', current_date);
  select * into v_row from member_membership_fee where member_id = v_part;
  insert into t_result (step, ok, detail)
  values ('3a paying 5,000 of the fee reads Partial',
          v_row.status = 'partial', v_row.status);
  insert into t_result (step, ok, detail)
  values ('3b the balance is measured against what the member was charged',
          v_row.outstanding_amount = v_fee - 5000,
          format('%s charged, %s paid, %s outstanding',
                 to_char(v_row.required_amount, 'FM999,999,999'),
                 to_char(v_row.paid_amount, 'FM999,999,999'),
                 to_char(v_row.outstanding_amount, 'FM999,999,999')));
  insert into t_result (step, ok, detail)
  values ('3c a part payment does not activate the member',
          (select status from members where id = v_part) = 'pending',
          (select status::text from members where id = v_part));
  insert into t_result (step, ok, detail)
  values ('3d the charge itself reads partial, and names no settling payment',
          exists (select 1 from member_fees where member_id = v_part
                    and status = 'partial' and paid_transaction_id is null),
          'partial, paid_transaction_id null');

  -- =====================================================================
  -- 4. Nothing paid
  -- =====================================================================
  select * into v_row from member_membership_fee where member_id = v_none;
  insert into t_result (step, ok, detail)
  values ('4a a member who has paid nothing reads Unpaid, owing the whole fee',
          v_row.status = 'unpaid' and v_row.paid_amount = 0 and v_row.outstanding_amount = v_fee,
          format('%s outstanding', to_char(v_row.outstanding_amount, 'FM999,999,999')));
  insert into t_result (step, ok, detail)
  values ('4b and is not active',
          (select status from members where id = v_none) = 'pending',
          (select status::text from members where id = v_none));

  -- =====================================================================
  -- 5. Several part payments accumulate, and the last one closes the charge
  -- =====================================================================
  perform collect_membership_fee(v_many, 4000, v_cash, 'cash', current_date);
  perform collect_membership_fee(v_many, 6000, v_cash, 'cash', current_date);
  select * into v_row from member_membership_fee where member_id = v_many;
  insert into t_result (step, ok, detail)
  values ('5a two part payments accumulate',
          v_row.paid_amount = 10000 and v_row.status = 'partial',
          format('%s paid, status %s', to_char(v_row.paid_amount, 'FM999,999,999'), v_row.status));

  perform collect_membership_fee(v_many, v_fee - 10000, v_cash, 'cash', current_date);
  select * into v_row from member_membership_fee where member_id = v_many;
  insert into t_result (step, ok, detail)
  values ('5b the payment that closes the balance turns the fee to Paid',
          v_row.status = 'paid' and v_row.outstanding_amount = 0,
          format('%s paid, %s outstanding', to_char(v_row.paid_amount, 'FM999,999,999'),
                 to_char(v_row.outstanding_amount, 'FM999,999,999')));
  insert into t_result (step, ok, detail)
  values ('5c settling the last of it activates the member',
          (select status from members where id = v_many) = 'active',
          (select status::text from members where id = v_many));
  insert into t_result (step, ok, detail)
  values ('5d the closed charge names the payment that closed it',
          exists (select 1 from member_fees where member_id = v_many
                    and status = 'paid' and paid_transaction_id is not null),
          'paid_transaction_id set');
  select count(*) into v_n from membership_fee_payments where member_id = v_many;
  insert into t_result (step, ok, detail)
  values ('5e every part payment is kept in the payment history',
          v_n = 3, v_n || ' payment(s) recorded');

  -- =====================================================================
  -- 6. Overpayment and duplicate collection are refused
  -- =====================================================================
  begin
    perform collect_membership_fee(v_part, v_fee, v_cash, 'cash', current_date);
    v_err := '(accepted - WRONG)';
  exception when others then v_err := sqlerrm; end;
  insert into t_result (step, ok, detail)
  values ('6a the counter refuses more than the outstanding balance',
          v_err like '%more than is owed%', v_err);

  begin
    perform collect_membership_fee(v_full, 1000, v_cash, 'cash', current_date);
    v_err := '(accepted - WRONG)';
  exception when others then v_err := sqlerrm; end;
  insert into t_result (step, ok, detail)
  values ('6b a fee already settled cannot be collected again',
          v_err like '%already settled%', v_err);

  begin
    perform collect_membership_fee(v_none, 0, v_cash, 'cash', current_date);
    v_err := '(accepted - WRONG)';
  exception when others then v_err := sqlerrm; end;
  insert into t_result (step, ok, detail)
  values ('6c zero is not a payment', v_err like '%greater than zero%', v_err);

  -- The same submission twice takes the money once.
  select count(*) into v_n from transactions where member_id = v_none and type = 'fee';
  perform collect_membership_fee(v_none, 3000, v_cash, 'cash', current_date, null, null, 'dup-key-test');
  perform collect_membership_fee(v_none, 3000, v_cash, 'cash', current_date, null, null, 'dup-key-test');
  select count(*) into v_num from transactions where member_id = v_none and type = 'fee';
  insert into t_result (step, ok, detail)
  values ('6d a retried submission does not take the money twice',
          v_num = v_n + 1, format('%s fee payment(s) before, %s after', v_n, v_num));
  select paid_amount into v_num from member_membership_fee where member_id = v_none;
  insert into t_result (step, ok, detail)
  values ('6e and the member is credited once',
          v_num = 3000, to_char(v_num, 'FM999,999,999') || ' credited');

  -- =====================================================================
  -- 7. The money is the existing architecture's, not a parallel one
  -- =====================================================================
  select count(*) into v_n from transactions t
   where t.member_id = v_many and t.type = 'fee' and t.status = 'posted';
  insert into t_result (step, ok, detail)
  values ('7a each collection posted one ledger transaction',
          v_n = 3, v_n || ' posted fee transaction(s)');

  insert into t_result (step, ok, detail)
  values ('7b every collection produced a receipt',
          not exists (select 1 from transactions t
                       where t.member_id = v_many and t.type = 'fee' and t.status = 'posted'
                         and not exists (select 1 from receipts r where r.transaction_id = t.id)),
          'a receipt for every fee payment');

  select coalesce(sum(ie.amount), 0) into v_num
    from income_entries ie join transactions t on t.id = ie.transaction_id
   where t.member_id = v_many and t.status = 'posted';
  insert into t_result (step, ok, detail)
  values ('7c the income recognised equals the money received',
          v_num = v_fee, to_char(v_num, 'FM999,999,999') || ' recognised as income');

  select coalesce(sum(fpl.amount), 0) into v_num
    from fee_payment_lines fpl join transactions t on t.id = fpl.transaction_id
   where t.member_id = v_many and t.status = 'posted';
  insert into t_result (step, ok, detail)
  values ('7d the allocations add up to the ledger amount',
          v_num = (select coalesce(sum(amount), 0) from transactions
                    where member_id = v_many and type = 'fee' and status = 'posted'),
          to_char(v_num, 'FM999,999,999') || ' allocated');

  insert into t_result (step, ok, detail)
  values ('7e no member owes a negative amount',
          not exists (select 1 from member_membership_fee where outstanding_amount < 0),
          'no negative balances');

  insert into t_result (step, ok, detail)
  values ('7f no member has paid more than they were charged',
          not exists (select 1 from member_membership_fee
                       where paid_amount > required_amount and status <> 'waived'),
          'no overpaid members');

  -- =====================================================================
  -- 8. Reversing one payment unwinds only that payment
  -- =====================================================================
  select t.id into v_txn from transactions t
    join fee_payment_lines fpl on fpl.transaction_id = t.id
    join member_fees mf on mf.id = fpl.member_fee_id
   where mf.member_id = v_many and t.status = 'posted'
     and t.amount = v_fee - 10000
   limit 1;
  perform reverse_transaction(v_txn, 'Automated test: reversing the closing payment');

  select * into v_row from member_membership_fee where member_id = v_many;
  insert into t_result (step, ok, detail)
  values ('8a reversing the closing payment leaves the earlier ones standing',
          v_row.paid_amount = 10000 and v_row.status = 'partial',
          format('%s still paid, status %s', to_char(v_row.paid_amount, 'FM999,999,999'), v_row.status));
  insert into t_result (step, ok, detail)
  values ('8b and returns the member to pending',
          (select status from members where id = v_many) = 'pending',
          (select status::text from members where id = v_many));
  insert into t_result (step, ok, detail)
  values ('8c the reversed payment is kept in the history, marked reversed',
          exists (select 1 from membership_fee_payments
                   where member_id = v_many and transaction_status = 'reversed'),
          'the reversal is visible, not erased');

  -- =====================================================================
  -- 9. The module's own read models
  -- =====================================================================
  v_res := membership_fee_dashboard();
  insert into t_result (step, ok, detail)
  values ('9a the dashboard reports the configured fee',
          (v_res ->> 'fee_amount')::numeric = v_fee,
          to_char((v_res ->> 'fee_amount')::numeric, 'FM999,999,999'));
  insert into t_result (step, ok, detail)
  values ('9b the dashboard counts paid, partial and unpaid members',
          (v_res ->> 'members_paid')::int = (select count(*) from member_membership_fee where status = 'paid')
      and (v_res ->> 'members_partial')::int = (select count(*) from member_membership_fee where status = 'partial')
      and (v_res ->> 'members_unpaid')::int = (select count(*) from member_membership_fee where status = 'unpaid'),
          format('%s paid, %s partial, %s unpaid', v_res ->> 'members_paid',
                 v_res ->> 'members_partial', v_res ->> 'members_unpaid'));
  insert into t_result (step, ok, detail)
  values ('9c collected today never exceeds collected in total',
          (v_res ->> 'collected_today')::numeric <= (v_res ->> 'collected_total')::numeric,
          format('%s today of %s in total', v_res ->> 'collected_today', v_res ->> 'collected_total'));

  select count(*) into v_n from search_membership_fees(null, 'partial', 100, 0);
  insert into t_result (step, ok, detail)
  values ('9d the table can be filtered to the members who owe part of the fee',
          v_n = (select count(*) from member_membership_fee where status = 'partial'),
          v_n || ' partial member(s)');

  select count(*) into v_n from search_membership_fees('Fee Part Test', null, 100, 0);
  insert into t_result (step, ok, detail)
  values ('9e the table can be searched by name', v_n = 1, v_n || ' match(es)');

  v_res := member_membership_fee_detail(v_part);
  insert into t_result (step, ok, detail)
  values ('9f the member profile card shows required, paid, outstanding and the history',
          (v_res ->> 'required_amount')::numeric = v_fee
      and (v_res ->> 'paid_amount')::numeric = 5000
      and (v_res ->> 'outstanding_amount')::numeric = v_fee - 5000
      and jsonb_array_length(v_res -> 'payments') = 1,
          format('%s required, %s paid, %s payment(s) listed',
                 v_res ->> 'required_amount', v_res ->> 'paid_amount',
                 jsonb_array_length(v_res -> 'payments')));

  -- =====================================================================
  -- 10. Nothing historical was duplicated or rewritten
  -- =====================================================================
  insert into t_result (step, ok, detail)
  values ('10a no pre-existing transaction changed amount, date or status',
          not exists (
            select 1 from t_before b join transactions t on t.id = b.id
             where t.amount <> b.amount or t.occurred_on <> b.occurred_on
                or t.status::text <> b.status::text),
          'every pre-existing ledger row is as it was');

  insert into t_result (step, ok, detail)
  values ('10b no pre-existing transaction was deleted',
          (select count(*) from t_before b
            where not exists (select 1 from transactions t where t.id = b.id)) = 0,
          'none deleted');

  insert into t_result (step, ok, detail)
  values ('10c no pre-existing fee charge was re-priced',
          not exists (select 1 from t_fees_before b join member_fees mf on mf.id = b.id
                       where mf.amount <> b.amount),
          'every charge keeps the amount it was raised with');

  insert into t_result (step, ok, detail)
  values ('10d no pre-existing allocation line was altered',
          not exists (select 1 from t_lines_before b join fee_payment_lines l on l.id = b.id
                       where l.amount <> b.amount or l.member_fee_id <> b.member_fee_id),
          'allocation history intact');

  insert into t_result (step, ok, detail)
  values ('10e no receipt was re-numbered or re-pointed',
          not exists (select 1 from t_receipts_before b join receipts r on r.id = b.id
                       where r.receipt_no <> b.receipt_no or r.transaction_id <> b.transaction_id),
          'receipts intact');

  insert into t_result (step, ok, detail)
  values ('10f no duplicate receipt number exists',
          (select count(*) from (select receipt_no from receipts
                                  group by receipt_no having count(*) > 1) d) = 0,
          'receipt numbers unique');

  insert into t_result (step, ok, detail)
  values ('10g a charge is never settled by more money than it asked for',
          not exists (select 1 from member_fees mf
                       where member_fee_paid(mf.id) > mf.amount),
          'no charge over-allocated');
end;
$$;

-- ===========================================================================
-- 11. Security: the module widens nothing
-- ===========================================================================
do $$
declare
  v_part uuid := (select id from t_ctx where key = 'part');
  v_full uuid := (select id from t_ctx where key = 'full');
  v_user uuid := (select id from t_ctx where key = 'part_user');
  v_n    integer;
  v_err  text;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  select count(*) into v_n from member_membership_fee;
  insert into t_result (step, ok, detail)
  values ('11a a member sees only their own membership fee row', v_n = 1, v_n || ' row(s) visible');

  select count(*) into v_n from membership_fee_payments where member_id = v_full;
  insert into t_result (step, ok, detail)
  values ('11b a member cannot see another member''s fee payments', v_n = 0, v_n || ' row(s) visible');

  begin
    perform collect_membership_fee(v_full, 1000,
              (select id from financial_accounts where account_type = 'cash' limit 1));
    v_err := '(allowed - WRONG)';
  exception when others then v_err := sqlerrm; end;
  insert into t_result (step, ok, detail)
  values ('11c a member cannot collect a fee', v_err like '%permission%', v_err);

  begin
    perform membership_fee_dashboard();
    v_err := '(allowed - WRONG)';
  exception when others then v_err := sqlerrm; end;
  insert into t_result (step, ok, detail)
  values ('11d a member cannot open the membership fees dashboard',
          v_err like '%permission%', v_err);
end;
$$;

reset role;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('collect_membership_fee', 'membership_fee_dashboard',
                       'search_membership_fees', 'member_membership_fee_detail',
                       'recompute_member_fee', 'member_fee_paid', 'registration_fee_amount')
     and has_function_privilege('anon', p.oid, 'execute');
  insert into t_result (step, ok, detail)
  values ('11e no membership fee function is reachable by a signed-out caller',
          v_n = 0, v_n || ' reachable by anon');

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and table_name in ('member_membership_fee', 'membership_fee_payments');
  insert into t_result (step, ok, detail)
  values ('11f no membership fee view is readable by a signed-out caller',
          v_n = 0, v_n || ' grant(s) to anon');
end;
$$;

select step, ok, detail from t_result order by n;

rollback;
