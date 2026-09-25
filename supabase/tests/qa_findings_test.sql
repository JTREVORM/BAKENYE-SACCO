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
begin
  v_a := (register_member(jsonb_build_object(
            'full_name', 'QA Borrower Test', 'phone', '+256779300001'))
          ->> 'member_id')::uuid;
  v_b := (register_member(jsonb_build_object(
            'full_name', 'QA Guarantor Test', 'phone', '+256779300002'))
          ->> 'member_id')::uuid;
  v_c := (register_member(jsonb_build_object(
            'full_name', 'QA Stranger Test', 'phone', '+256779300003'))
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
-- V-5 — a guarantor sees the borrower, and nobody else does.
--
-- Member B guarantees member A's loan. Member C guarantees nothing.
-- ---------------------------------------------------------------------------
reset role;

do $$
declare
  v_a uuid := (select id from t_ctx where key = 'a');
  v_b uuid := (select id from t_ctx where key = 'b');
  v_prod uuid;
  v_loan uuid;
begin
  -- Its own product, so the fixture does not depend on how many guarantors the
  -- SACCO's real products happen to require.
  if not exists (select 1 from loan_products where code = 'QAT') then
    perform save_loan_product(null, jsonb_build_object(
      'name', 'QA Test Product', 'code', 'QAT', 'interest_rate', 12.0,
      'interest_method', 'flat', 'min_amount', 50000, 'max_amount', 5000000,
      'min_period_months', 1, 'max_period_months', 12, 'processing_fee_pct', 0,
      'min_guarantors', 1), 'automated test fixture');
  end if;
  select id into v_prod from loan_products where code = 'QAT';

  v_loan := (apply_for_loan(v_a, v_prod, 300000, 6, 'Automated test loan', null,
               jsonb_build_array(jsonb_build_object('member_id', v_b, 'amount', 300000)),
               'test:qa:loan') ->> 'loan_id')::uuid;
  insert into t_ctx values ('loan', v_loan);
end;
$$;

set role authenticated;

do $$
declare
  v_a uuid := (select id from t_ctx where key = 'a');
  v_b_user uuid := (select id from t_ctx where key = 'b_user');
  v_c_user uuid := (select id from t_ctx where key = 'c_user');
  v_n integer;
  v_name text;
begin
  ------------------------------------------------------- A: the guarantor sees
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_b_user, 'role', 'authenticated')::text, false);
  select count(*), max(borrower_name) into v_n, v_name from my_guarantees();
  insert into t_result (step, ok, detail)
  values ('V-5a a guarantor sees the borrower they guarantee',
          v_n = 1 and v_name = 'QA Borrower Test', format('%s row(s), borrower %s', v_n, v_name));

  ------------------------------- B: the parameter cannot be used to look wider
  select count(*) into v_n from my_guarantees(v_a);
  insert into t_result (step, ok, detail)
  values ('V-5b a member cannot ask about another member''s guarantees',
          v_n = 1, format('%s row(s) — still their own', v_n));

  ------------------------------------- C: a non-guarantor enumerates nothing
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_c_user, 'role', 'authenticated')::text, false);
  select count(*) into v_n from my_guarantees();
  insert into t_result (step, ok, detail)
  values ('V-5c a member who guarantees nothing sees nothing', v_n = 0, v_n || ' row(s)');

  select count(*) into v_n from my_guarantees(v_a);
  insert into t_result (step, ok, detail)
  values ('V-5d and cannot enumerate through the parameter', v_n = 0, v_n || ' row(s)');

  ------------------------------------------- E: RLS on members is unchanged
  select count(*) into v_n from members;
  insert into t_result (step, ok, detail)
  values ('V-5e row-level security on members is unchanged', v_n = 1,
          v_n || ' member row(s) visible');

  ------------------------------------- H: no member record, nothing returned
  perform set_config('request.jwt.claims', '{}', false);
  select count(*) into v_n from my_guarantees();
  insert into t_result (step, ok, detail)
  values ('V-5f a caller with no member record sees nothing', v_n = 0, v_n || ' row(s)');
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
  -- The V-5 checks above left the session claiming to be somebody else, or
  -- nobody. Put the administrator back, so the waiver is attributed properly.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from app_users
                               where role = 'super_admin' and is_active
                               order by created_at limit 1),
                      'role', 'authenticated')::text, false);

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
