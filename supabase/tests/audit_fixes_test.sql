begin;

create temp table t_result (n serial, step text, ok boolean, detail text);
create temp table t_ctx (key text primary key, id uuid);

-- ===========================================================================
-- Regression checks for the production-readiness audit (0036, 0037).
--
--   - the database keeps Uganda time
--   - settings that used to do nothing now do what the Settings screen says
--   - savings plans change through one audited, atomic function
--   - reversing a loan disbursement undoes the loan, not just the money
--   - reopening a completed loan binds its guarantors again
--   - the dashboard's income and expenses agree with the cashbook
--
-- Brings its own members, login, account and loan product. Rolled back.
-- ===========================================================================

reset role;

do $fixture$
declare
  v_user uuid := gen_random_uuid();
  v_mid  uuid;
begin
  v_mid := (register_member(jsonb_build_object(
              'full_name', 'Audit Borrower Test', 'phone', '+256779200001'))
            ->> 'member_id')::uuid;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'audit.borrower@test.invalid', '', now(), jsonb_build_object('member_id', v_mid),
          '{}'::jsonb, now(), now());
  update app_users set must_change_password = false where id = v_user;

  insert into t_ctx values ('borrower', v_mid), ('borrower_user', v_user);
end;
$fixture$;

set role authenticated;

do $$
declare
  v_a      uuid := (select id from t_ctx where key = 'borrower');
  v_a_user uuid := (select id from t_ctx where key = 'borrower_user');
  v_b      uuid;
  v_c      uuid;
  v_cash   uuid;
  v_prod   uuid;
  v_loan   uuid;
  v_txn    uuid;
  v_sched  uuid;
  v_res    jsonb;
  v_n      integer;
  v_bal0   numeric;
  v_bal1   numeric;
  v_dm     jsonb;
  v_cb     jsonb;
  v_err    text;
begin
  -------------------------------------------------------------- Uganda time
  insert into t_result (step, ok, detail)
  values ('1 the database keeps Uganda time', current_setting('TimeZone') = 'Africa/Kampala',
          current_setting('TimeZone'));

  ------------------------------------------------------------------ fixtures
  v_b := (register_member(jsonb_build_object('full_name', 'Audit Guarantor Test', 'phone', '+256779200002'))
          ->> 'member_id')::uuid;
  v_c := (register_member(jsonb_build_object('full_name', 'Audit Saver Test', 'phone', '+256779200003'))
          ->> 'member_id')::uuid;
  perform waive_member_fee(mf.id, 'automated test fixture')
     from member_fees mf where mf.member_id in (v_a, v_b, v_c) and mf.status = 'unpaid';

  select id into v_cash from financial_accounts where account_type = 'cash' and status = 'active' and is_default;

  -- Savings in cash give the till something to lend from.
  perform record_savings_payment(v_b, 'weekly', 600000, current_date, 'cash', 'test:audit:b-save');
  perform record_savings_payment(v_a, 'monthly', 50000, current_date, 'cash', 'test:audit:a-save');

  ---------------------------------------------------- minimum savings balance
  perform update_settings(jsonb_build_object('members.min_savings_balance', 20000), 'automated test');
  begin
    perform record_cash_movement(v_a, 'withdrawal', 40000, 'cash', current_date, null, 'test:audit:wd1');
    insert into t_result (step, ok, detail) values ('2a a withdrawal below the minimum balance is refused', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail) values ('2a a withdrawal below the minimum balance is refused', sqlerrm ilike '%keep at least%', sqlerrm);
  end;
  v_res := record_cash_movement(v_a, 'withdrawal', 30000, 'cash', current_date, null, 'test:audit:wd2');
  insert into t_result (step, ok, detail) values ('2b a withdrawal that keeps the minimum goes through', v_res ? 'reference', v_res ->> 'reference');
  perform update_settings(jsonb_build_object('members.min_savings_balance', 0), 'automated test');

  -------------------------------------------------- open monthly savings
  --
  -- Since 0043 there is no monthly target, so there is no such thing as a
  -- part payment: any positive amount is a saving in its own right, and
  -- several in one month simply add up.
  perform open_savings_schedules(current_date);
  perform record_savings_payment(v_c, 'monthly', 10000, current_date, 'cash', 'test:audit:part1');
  select id into v_sched from savings_periods
   where member_id = v_c and kind = 'monthly'
     and period_start = date_trunc('month', current_date)::date;
  perform record_scheduled_savings(v_sched, 63500, current_date, 'cash', null, null, 'test:audit:part2');
  insert into t_result (step, ok, detail)
  values ('3a two deposits in one month add up, and neither is a part payment',
          (select paid_amount from savings_periods where id = v_sched) = 73500,
          (select paid_amount::text from savings_periods where id = v_sched));
  insert into t_result (step, ok, detail)
  values ('3b a month with savings in it expects nothing and owes nothing',
          (select expected_amount from savings_periods where id = v_sched) = 0
          and (select status from savings_periods where id = v_sched) = 'paid',
          (select status::text from savings_periods where id = v_sched));

  ------------------------------------------------- savings targets are gone
  begin
    perform set_savings_plan(v_a, 'monthly', 150000, null);
    insert into t_result (step, ok, detail) values ('4a a savings target cannot be set', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('4a a savings target cannot be set', sqlerrm ilike '%no savings target%', sqlerrm);
  end;
  select count(*) into v_n from savings_plans where member_id = v_a;
  insert into t_result (step, ok, detail)
  values ('4b no plan was written', v_n = 0, v_n || ' plan(s)');

  ---------------------------------------------------------- loan decisions
  v_res := save_loan_product(null, jsonb_build_object(
             'name', 'TEST Audit Loan', 'code', 'TESTAUD', 'interest_rate', 12,
             'interest_method', 'flat', 'min_amount', 100000, 'max_amount', 1000000,
             'min_period_months', 1, 'max_period_months', 12, 'repayment_frequency', 'monthly',
             'processing_fee_pct', 1, 'insurance_fee_pct', 0, 'application_fee', 0,
             'late_penalty_pct', 0, 'penalty_basis', 'overdue', 'grace_period_days', 0,
             'min_savings_balance', 0, 'min_savings_multiple', 0, 'min_membership_months', 0,
             'required_shares', 0, 'requires_guarantors', true, 'min_guarantors', 1,
             'requires_collateral', false, 'is_active', true, 'sort_order', 999),
             'automated test fixture');
  v_prod := (v_res ->> 'id')::uuid;
  v_loan := (apply_for_loan(v_a, v_prod, 200000, 2, 'Audit test loan', null,
             jsonb_build_array(jsonb_build_object('member_id', v_b, 'amount', 200000)),
             'test:audit:loan') ->> 'loan_id')::uuid;

  perform update_settings(jsonb_build_object('notifications.notify_on_loan_decision', false), 'automated test');
  perform set_loan_status(v_loan, 'approved', 'automated test');
  select count(*) into v_n from notifications where user_id = v_a_user and title ilike 'Loan approved%';
  insert into t_result (step, ok, detail)
  values ('5 with decision notices off, approving a loan notifies nobody', v_n = 0, v_n || ' notice(s)');
  perform update_settings(jsonb_build_object('notifications.notify_on_loan_decision', true), 'automated test');

  -------------------------------------------------- disbursement reversal
  v_bal0 := finance_account_balance_at(v_cash, null);
  perform disburse_loan(v_loan, 'cash', current_date, 'test:audit:dis1');
  v_bal1 := finance_account_balance_at(v_cash, null);
  insert into t_result (step, ok, detail)
  values ('6a the till pays out the loan less its fee', v_bal0 - v_bal1 = 198000, (v_bal0 - v_bal1)::text);

  perform record_loan_repayment(v_loan, 10000, current_date, 'cash', 'test:audit:rep1');
  select id into v_txn from transactions where loan_id = v_loan and type = 'loan_disbursement' and status = 'posted';
  begin
    perform reverse_transaction(v_txn, 'automated test', null);
    insert into t_result (step, ok, detail) values ('6b a disbursement with repayments on it cannot be reversed', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail) values ('6b a disbursement with repayments on it cannot be reversed', sqlerrm ilike '%reverse those first%', sqlerrm);
  end;

  perform reverse_transaction(r.transaction_id, 'automated test', null)
     from loan_repayments r join transactions t on t.id = r.transaction_id
    where r.loan_id = v_loan and t.status = 'posted';
  perform reverse_transaction(v_txn, 'automated test: paid to the wrong member', null);

  insert into t_result (step, ok, detail)
  values ('6c reversing the disbursement puts the till back exactly', finance_account_balance_at(v_cash, null) = v_bal0,
          finance_account_balance_at(v_cash, null)::text || ' vs ' || v_bal0::text);
  insert into t_result (step, ok, detail)
  values ('6d the loan is Approved again', (select status from loans where id = v_loan) = 'approved',
          (select status::text from loans where id = v_loan));
  select count(*) into v_n from loan_schedule where loan_id = v_loan;
  insert into t_result (step, ok, detail) values ('6e its repayment schedule is gone', v_n = 0, v_n || ' row(s)');
  select count(*) into v_n from transactions where loan_id = v_loan and type = 'fee' and status = 'posted';
  insert into t_result (step, ok, detail) values ('6f the fee taken at disbursement is reversed with it', v_n = 0, v_n || ' standing fee(s)');

  ----------------------------------------------- reopening binds guarantors
  perform disburse_loan(v_loan, 'cash', current_date, 'test:audit:dis2');
  perform record_loan_repayment(v_loan, (select total_payable from loans where id = v_loan),
                                current_date, 'cash', 'test:audit:rep-all');
  insert into t_result (step, ok, detail)
  values ('7a paid in full, the guarantor is released',
          (select status from loan_guarantors where loan_id = v_loan) = 'released',
          (select status::text from loan_guarantors where loan_id = v_loan));
  select r.transaction_id into v_txn from loan_repayments r join transactions t on t.id = r.transaction_id
   where r.loan_id = v_loan and t.status = 'posted' order by r.created_at desc limit 1;
  perform reverse_transaction(v_txn, 'automated test: bounced payment', null);
  insert into t_result (step, ok, detail)
  -- The guarantor never answered, so reopening binds them back to pending -
  -- not to an acceptance they never gave.
  values ('7b reversing the final payment reopens the loan and restores the guarantor''s real standing',
          (select status from loans where id = v_loan) = 'active'
          and (select status from loan_guarantors where loan_id = v_loan) = 'pending',
          (select status::text from loans where id = v_loan) || ' / ' ||
          (select status::text from loan_guarantors where loan_id = v_loan));

  ---------------------------------------------- dashboard agrees with books
  v_dm := dashboard_metrics();
  v_cb := cashbook(date_trunc('month', current_date)::date, current_date);
  insert into t_result (step, ok, detail)
  values ('8 dashboard income and expenses equal the cashbook, reversals excluded',
          (v_dm ->> 'income_mtd')::numeric = (v_cb ->> 'total_income')::numeric
          and (v_dm ->> 'expenses_mtd')::numeric = (v_cb ->> 'total_expenses')::numeric,
          format('dashboard %s / %s, cashbook %s / %s', v_dm ->> 'income_mtd', v_dm ->> 'expenses_mtd',
                 v_cb ->> 'total_income', v_cb ->> 'total_expenses'));

  ------------------------------------------------------ nothing is dead
  select count(*) into v_n from system_settings
   where key in ('system.business_days', 'financial.withdrawal_fee', 'loans.auto_approve_limit',
                 'savings.missed_period_penalty', 'notifications.collection_reminder_days');
  insert into t_result (step, ok, detail)
  values ('9 settings nothing enforces are no longer offered', v_n = 0, v_n || ' left');
end;
$$;

select step, ok, detail from t_result order by n;

rollback;
