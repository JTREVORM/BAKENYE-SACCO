begin;

create temp table t_result (n serial, step text, ok boolean, detail text);
create temp table t_ctx (key text primary key, id uuid);

-- ===========================================================================
-- Regression checks for the findings raised by the documentation QA
-- (0039, 0040, 0041, 0042).
--
--   V-1  a savings payment can be reversed at all, and the period it belonged
--        to is recomputed with the right status
--   V-8  a member statement accounts for reversals, so it agrees with the
--        dashboard and the ledger
--   V-6  no money-posting function accepts a value date in the future
--   V-5  a guarantor can see the borrower they guarantee, and nobody else
--
-- Brings its own members, logins and money. Rolled back.
-- ===========================================================================

reset role;

do $fixture$
declare
  v_a_user uuid := gen_random_uuid();
  v_b_user uuid := gen_random_uuid();
  v_c_user uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_c uuid;
  v_share uuid := (select id from share_categories where status = 'active' order by sort_order limit 1);
begin
  v_a := (register_member(jsonb_build_object(
            'full_name', 'QA Borrower Test', 'phone', '+256779300001',
            'share_category_id', v_share,
            'savings_category_id', (select id from savings_categories where code = 'GOLD_SAVER')))
          ->> 'member_id')::uuid;
  v_b := (register_member(jsonb_build_object(
            'full_name', 'QA Guarantor Test', 'phone', '+256779300002',
            'share_category_id', v_share,
            'savings_category_id', (select id from savings_categories where code = 'SILVER_SAVER')))
          ->> 'member_id')::uuid;
  v_c := (register_member(jsonb_build_object(
            'full_name', 'QA Stranger Test', 'phone', '+256779300003',
            'share_category_id', v_share,
            'savings_category_id', (select id from savings_categories where code = 'GOLD_SAVER')))
          ->> 'member_id')::uuid;

  perform waive_member_fee(mf.id, 'automated test fixture')
     from member_fees mf where mf.member_id in (v_a, v_b, v_c) and mf.status = 'unpaid';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_a_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'qa.borrower@test.invalid', '', now(), jsonb_build_object('member_id', v_a), '{}'::jsonb, now(), now()),
         (v_b_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'qa.guarantor@test.invalid', '', now(), jsonb_build_object('member_id', v_b), '{}'::jsonb, now(), now()),
         (v_c_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'qa.stranger@test.invalid', '', now(), jsonb_build_object('member_id', v_c), '{}'::jsonb, now(), now());
  update app_users set must_change_password = false
   where id in (v_a_user, v_b_user, v_c_user);

  insert into t_ctx values ('a', v_a), ('b', v_b), ('c', v_c),
                           ('a_user', v_a_user), ('b_user', v_b_user), ('c_user', v_c_user);
end;
$fixture$;

set role authenticated;

do $$
declare
  v_a uuid := (select id from t_ctx where key = 'a');
  v_b uuid := (select id from t_ctx where key = 'b');
  v_sched uuid;
  v_txn   uuid;
  v_period uuid;
  v_paid  numeric;
  v_status savings_status;
  v_bal0 numeric; v_bal1 numeric;
  v_stmt jsonb; v_close numeric;
  v_err text;
  v_fn  text;
  v_blocked integer := 0;
  v_total   integer := 0;
begin
  ------------------------------------------------------------------ V-1
  -- A savings payment, recorded then reversed.
  perform record_savings_payment(v_a, 'monthly', 60000, current_date, 'cash', 'test:qa:a-save');
  select t.id into v_txn from transactions t
   where t.member_id = v_a and t.type = 'monthly_savings' and t.status = 'posted'
   order by t.created_at desc limit 1;
  select sp.period_id into v_period from savings_payments sp
   where sp.transaction_id = v_txn;

  select savings_balance into v_bal0 from member_financials where id = v_a;

  begin
    perform reverse_transaction(v_txn, 'Automated test: recorded against the wrong member.');
    insert into t_result (step, ok, detail)
    values ('V-1a a savings payment can be reversed', true, 'no error');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('V-1a a savings payment can be reversed', false, v_err);
  end;

  select savings_balance into v_bal1 from member_financials where id = v_a;
  insert into t_result (step, ok, detail)
  values ('V-1b the balance falls by the reversed amount', v_bal1 = v_bal0 - 60000,
          format('%s -> %s', v_bal0, v_bal1));

  select paid_amount, status into v_paid, v_status from savings_periods where id = v_period;
  insert into t_result (step, ok, detail)
  values ('V-1c the period is recomputed and correctly typed',
          v_paid = 0 and v_status in ('pending', 'missed'),
          format('paid %s, status %s', v_paid, v_status));

  insert into t_result (step, ok, detail)
  values ('V-1d the original is marked reversed',
          (select status from transactions where id = v_txn) = 'reversed',
          (select status::text from transactions where id = v_txn));

  insert into t_result (step, ok, detail)
  values ('V-1e the reversal is audited',
          exists (select 1 from audit_logs where action = 'transaction.reversed'
                    and record_id = v_txn::text),
          'audit_logs');

  -- Reversing the same transaction twice is refused.
  begin
    perform reverse_transaction(v_txn, 'Automated test: second attempt.');
    insert into t_result (step, ok, detail)
    values ('V-1f a second reversal is refused', false, 'accepted');
  exception when check_violation then
    insert into t_result (step, ok, detail)
    values ('V-1f a second reversal is refused', true, 'refused');
  end;

  -- The recompute helper is internal: a signed-in member or member of staff
  -- must not be able to call it directly and rewrite a period's status.
  begin
    perform recompute_savings_period(v_period);
    insert into t_result (step, ok, detail)
    values ('V-1g the recompute helper is not callable from the API', false, 'accepted');
  exception when insufficient_privilege then
    insert into t_result (step, ok, detail)
    values ('V-1g the recompute helper is not callable from the API', true, 'refused');
  end;

  ------------------------------------------------------------------ V-8
  v_stmt := member_statement(v_a, '1900-01-01'::date, '2100-01-01'::date);
  select (x->>'running_balance')::numeric into v_close
    from jsonb_array_elements(v_stmt->'rows') with ordinality t(x, i)
   order by i desc limit 1;
  v_close := coalesce(v_close, (v_stmt->>'opening_balance')::numeric);
  insert into t_result (step, ok, detail)
  values ('V-8 the statement agrees with the dashboard after a reversal',
          v_close = v_bal1, format('statement %s, dashboard %s', v_close, v_bal1));

  ------------------------------------------------------------------ V-6
  -- No money-posting function may accept a value date in the future.
  v_total := v_total + 1;
  begin
    perform record_savings_payment(v_a, 'monthly', 1000, current_date + 1, 'cash', 'test:qa:future1');
  exception when check_violation then v_blocked := v_blocked + 1;
           when others then null;
  end;

  v_total := v_total + 1;
  begin
    perform record_cash_movement(v_a, 'deposit', 1000, 'cash', current_date + 1, null, 'test:qa:future2');
  exception when check_violation then v_blocked := v_blocked + 1;
           when others then null;
  end;

  v_total := v_total + 1;
  begin
    perform buy_shares(v_a, 1, 'cash', current_date + 1, null, 'test:qa:future3');
  exception when check_violation then v_blocked := v_blocked + 1;
           when others then null;
  end;

  insert into t_result (step, ok, detail)
  values ('V-6 a value date in the future is refused', v_blocked = v_total,
          format('%s of %s refused', v_blocked, v_total));
end;
$$;

-- ---------------------------------------------------------------------------
-- Run as the owner, the way the nightly job and the money functions do, to
-- check the one rule that only the helper itself can enforce.
-- ---------------------------------------------------------------------------
reset role;

do $$
declare
  v_a uuid := (select id from t_ctx where key = 'a');
  v_sched uuid;
begin
  select id into v_sched from savings_periods
   where member_id = v_a and status <> 'waived' and paid_amount = 0 limit 1;

  if v_sched is null then
    insert into t_result (step, ok, detail)
    values ('V-1h a waived period stays waived', true, 'no waivable period in this fixture');
  else
    perform waive_savings_schedule(v_sched, 'Automated test: waiver must survive a recompute.');
    perform recompute_savings_period(v_sched);
    insert into t_result (step, ok, detail)
    values ('V-1h a waived period stays waived',
            (select status from savings_periods where id = v_sched) = 'waived',
            (select status::text from savings_periods where id = v_sched));
  end if;
end;
$$;

select step, ok, detail from t_result order by n;

rollback;
