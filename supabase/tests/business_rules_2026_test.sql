begin;

create temp table t_result (n serial, step text, ok boolean, detail text);
create temp table t_ctx (key text primary key, id uuid);

-- ===========================================================================
-- The business rules approved in 2026, as executable checks (0043).
--
--   1. The registration fee is UGX 20,000.
--   2. Monthly savings are open: any positive amount, as often as a member
--      likes, with no target and no arrears for a month they skip.
--   3. One share costs UGX 10,000, and a member may buy any whole number of
--      them. There are no savings or share categories left to classify anyone.
--
-- It also proves the things that must NOT have changed: historical rows are
-- untouched, balances still reconcile with the ledger, reversals still work,
-- statements still read correctly, and RLS still scopes a member to their own
-- records.
--
-- Brings its own members, logins, account and money. Rolled back.
-- ===========================================================================

-- A snapshot of the historical record, taken before this suite writes
-- anything, so the "nothing was restated" checks below have something to
-- compare against.
create temp table t_history_before as
  select id, member_id, type, status, amount, occurred_on from transactions;
create temp table t_lots_before as
  select id, member_id, quantity, unit_price, total_value, purchased_on from share_lots;
create temp table t_periods_before as
  select id, member_id, kind, period_start, expected_amount, paid_amount, status
    from savings_periods;

reset role;

do $fixture$
declare
  v_a uuid; v_b uuid;
  v_user uuid := gen_random_uuid();
begin
  v_a := (register_member(jsonb_build_object(
            'full_name', 'Rules Saver Test', 'phone', '+256779400001')) ->> 'member_id')::uuid;
  v_b := (register_member(jsonb_build_object(
            'full_name', 'Rules Buyer Test', 'phone', '+256779400002')) ->> 'member_id')::uuid;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rules.saver@test.invalid', '', now(), jsonb_build_object('member_id', v_a),
          '{}'::jsonb, now(), now());
  update app_users set must_change_password = false where id = v_user;

  insert into t_ctx values ('a', v_a), ('b', v_b), ('a_user', v_user);
end;
$fixture$;

set role authenticated;

do $$
declare
  v_a      uuid := (select id from t_ctx where key = 'a');
  v_b      uuid := (select id from t_ctx where key = 'b');
  v_a_user uuid := (select id from t_ctx where key = 'a_user');
  v_fee    numeric;
  v_charge uuid;
  v_price  numeric;
  v_period uuid;
  v_last   uuid;
  v_txn    uuid;
  v_res    jsonb;
  v_n      integer;
  v_num    numeric;
  v_err    text;
  v_stmt   jsonb;
  v_month  date := date_trunc('month', current_date)::date;
begin
  -- =====================================================================
  -- 1. Registration fee
  -- =====================================================================
  select coalesce(sum((f ->> 'amount')::numeric), 0) into v_fee
    from jsonb_array_elements(registration_fee_schedule()) f
   where (f ->> 'is_mandatory')::boolean;
  insert into t_result (step, ok, detail)
  values ('1a the mandatory registration fee is UGX 20,000', v_fee = 20000, to_char(v_fee, 'FM999,999,999'));

  select coalesce(sum(amount), 0) into v_num
    from member_fees where member_id = v_a and charged_at_registration and is_mandatory;
  insert into t_result (step, ok, detail)
  values ('1b a new member is charged UGX 20,000 at registration', v_num = 20000, to_char(v_num, 'FM999,999,999'));

  insert into t_result (step, ok, detail)
  values ('1c the fee is configuration, not a constant in code',
          exists (select 1 from fees where charged_when = 'registration'
                    and is_mandatory and status = 'active' and amount = 20000),
          'fees row, editable under Settings -> Fees');

  -- Paying it activates the member, through the ordinary fee path.
  select id into v_charge from member_fees where member_id = v_a and status = 'unpaid' limit 1;
  perform pay_member_fees(v_a, array[v_charge],
                          (select id from financial_accounts
                            where account_type = 'cash' and status = 'active' and is_default),
                          null, current_date, null, 20000);
  perform waive_member_fee(mf.id, 'automated test fixture')
     from member_fees mf where mf.member_id = v_b and mf.status = 'unpaid';
  insert into t_result (step, ok, detail)
  values ('1d paying UGX 20,000 activates the member',
          (select status from members where id = v_a) = 'active',
          (select status::text from members where id = v_a));

  -- =====================================================================
  -- 2. Open monthly savings
  -- =====================================================================
  -- The month's bucket is opened by the first deposit; nothing opens it in
  -- advance, because nothing is owed in advance.
  perform record_savings_payment(v_a, 'monthly', 5000, current_date, 'cash', 'test:rules:s5000');
  select id into v_period from savings_periods
   where member_id = v_a and kind = 'monthly' and period_start = v_month;

  insert into t_result (step, ok, detail)
  values ('2a a month expects nothing of a member',
          (select expected_amount from savings_periods where id = v_period) = 0, '0');
  insert into t_result (step, ok, detail)
  values ('2b a member can save UGX 5,000',
          (select paid_amount from savings_periods where id = v_period) = 5000,
          (select paid_amount::text from savings_periods where id = v_period));

  perform record_savings_payment(v_a, 'monthly', 20000, current_date, 'cash', 'test:rules:s20000');
  insert into t_result (step, ok, detail)
  values ('2c a member can save UGX 20,000',
          (select paid_amount from savings_periods where id = v_period) = 25000,
          (select paid_amount::text from savings_periods where id = v_period));

  perform record_savings_payment(v_a, 'monthly', 73500, current_date, 'cash', 'test:rules:s73500');
  insert into t_result (step, ok, detail)
  values ('2d a member can save UGX 73,500 - no amount is rounded or refused',
          (select paid_amount from savings_periods where id = v_period) = 98500,
          (select paid_amount::text from savings_periods where id = v_period));

  select count(*) into v_n from savings_payments sp
    join transactions t on t.id = sp.transaction_id
   where sp.period_id = v_period and t.status = 'posted';
  insert into t_result (step, ok, detail)
  values ('2e three deposits in one month are three transactions in one period',
          v_n = 3, v_n || ' deposit(s)');

  insert into t_result (step, ok, detail)
  values ('2f every deposit is recorded by member, date, amount and reference',
          not exists (select 1 from savings_transactions st
                       where st.member_id = v_a
                         and (st.amount is null or st.transaction_date is null
                              or st.reference is null)),
          (select string_agg(st.reference || ' ' || to_char(st.amount, 'FM999,999,999'), ', ' order by st.reference)
             from savings_transactions st where st.member_id = v_a));

  -- A month with nothing in it. Member B has saved nothing at all; that must
  -- not have become a debt. (`run_daily_maintenance()` is the scheduled job and
  -- runs as the service role, so it is exercised in its own block below.)
  perform open_savings_schedules(current_date);
  select count(*) into v_n from savings_periods
   where member_id = v_b and status in ('missed', 'partial');
  insert into t_result (step, ok, detail)
  values ('2g a member who saved nothing has no missed or partial period',
          v_n = 0, v_n || ' row(s)');

  select count(*) into v_n from savings_periods
   where member_id in (v_a, v_b) and expected_amount > 0;
  insert into t_result (step, ok, detail)
  values ('2h no arrears, penalty or outstanding savings is raised against anyone',
          v_n = 0, v_n || ' period(s) expecting money');

  begin
    perform set_savings_plan(v_a, 'monthly', 50000, null);
    insert into t_result (step, ok, detail)
    values ('2m a monthly savings target cannot be set', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('2m a monthly savings target cannot be set', v_err ilike '%no savings target%', v_err);
  end;

  begin
    perform record_savings_payment(v_a, 'monthly', 0, current_date, 'cash', 'test:rules:zero');
    insert into t_result (step, ok, detail) values ('2n a zero saving is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('2n a zero saving is refused', true, v_err);
  end;

  begin
    perform record_savings_payment(v_a, 'monthly', -5000, current_date, 'cash', 'test:rules:neg');
    insert into t_result (step, ok, detail) values ('2o a negative saving is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('2o a negative saving is refused', true, v_err);
  end;

  -- =====================================================================
  -- 3. Shares: one price, any whole number
  -- =====================================================================
  v_price := share_unit_price();
  insert into t_result (step, ok, detail)
  values ('3a one share costs UGX 10,000', v_price = 10000, to_char(v_price, 'FM999,999,999'));

  v_res := buy_shares(v_b, 1, 'cash', current_date, null, 'test:rules:sh1', 10000);
  insert into t_result (step, ok, detail)
  values ('3b 1 share costs UGX 10,000', (v_res ->> 'total_value')::numeric = 10000,
          to_char((v_res ->> 'total_value')::numeric, 'FM999,999,999'));

  v_res := buy_shares(v_b, 10, 'cash', current_date, null, 'test:rules:sh10', 100000);
  insert into t_result (step, ok, detail)
  values ('3c 10 shares cost UGX 100,000', (v_res ->> 'total_value')::numeric = 100000,
          to_char((v_res ->> 'total_value')::numeric, 'FM999,999,999'));

  v_res := buy_shares(v_b, 100, 'cash', current_date, null, 'test:rules:sh100', 1000000);
  insert into t_result (step, ok, detail)
  values ('3d 100 shares cost UGX 1,000,000', (v_res ->> 'total_value')::numeric = 1000000,
          to_char((v_res ->> 'total_value')::numeric, 'FM999,999,999'));

  insert into t_result (step, ok, detail)
  values ('3e total share value is the number of shares times the one price',
          (select shares_owned * share_price = share_value from member_share_progress
            where member_id = v_b)
          and (select shares_owned from member_share_progress where member_id = v_b) = 111,
          (select shares_owned || ' shares worth ' || to_char(share_value, 'FM999,999,999')
             from member_share_progress where member_id = v_b));

  insert into t_result (step, ok, detail)
  values ('3f there is no category limit on how many shares may be bought',
          (select share_count from member_shares where member_id = v_b) = 111,
          'no tier, no ceiling');

  begin
    perform buy_shares(v_b, 0, 'cash', current_date, null, 'test:rules:sh0');
    insert into t_result (step, ok, detail) values ('3g zero shares is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('3g zero shares is refused', true, v_err);
  end;

  begin
    perform buy_shares(v_b, -5, 'cash', current_date, null, 'test:rules:shneg');
    insert into t_result (step, ok, detail) values ('3h a negative quantity is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('3h a negative quantity is refused', true, v_err);
  end;

  -- A fractional quantity cannot even be expressed: the argument is an
  -- integer, so 2.5 is rejected by the type system before any money moves.
  begin
    execute 'select buy_shares($1, 2.5, ''cash'', current_date, null, ''test:rules:shfrac'')'
      using v_b;
    insert into t_result (step, ok, detail) values ('3i a fractional quantity is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail) values ('3i a fractional quantity is refused', true, v_err);
  end;

  -- The server prices the sale. A total the client made up is refused.
  begin
    perform buy_shares(v_b, 25, 'cash', current_date, null, 'test:rules:shlie', 1);
    insert into t_result (step, ok, detail)
    values ('3j a client-supplied total that is not quantity x price is refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('3j a client-supplied total that is not quantity x price is refused', true, v_err);
  end;

  v_res := buy_shares(v_b, 25, 'cash', current_date, null, 'test:rules:sh25', 250000);
  insert into t_result (step, ok, detail)
  values ('3k 25 shares at UGX 10,000 total UGX 250,000, computed by the database',
          (v_res ->> 'total_value')::numeric = 250000
          and (v_res ->> 'unit_price')::numeric = 10000,
          to_char((v_res ->> 'total_value')::numeric, 'FM999,999,999'));

  -- =====================================================================
  -- 4. Nothing classifies a member any more
  -- =====================================================================
  insert into t_result (step, ok, detail)
  values ('4a no active savings or share category remains',
          not exists (select 1 from savings_categories where status = 'active')
          and not exists (select 1 from share_categories where status = 'active'),
          'all retired, none deleted');

  insert into t_result (step, ok, detail)
  values ('4b members registered now carry no category',
          (select count(*) from members
            where id in (v_a, v_b)
              and (savings_category_id is not null or share_category_id is not null)) = 0,
          null);

  insert into t_result (step, ok, detail)
  values ('4c no read model exposes a savings or share category column',
          not exists (
            select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name in ('member_financials', 'savings_schedules',
                                  'savings_transactions', 'member_share_progress')
               and column_name in ('savings_category_id', 'savings_category_name',
                                   'share_category_id', 'share_category_name',
                                   'expected_amount', 'outstanding', 'target_shares')),
          null);

  insert into t_result (step, ok, detail)
  values ('4d the dashboard reports no category and no savings arrears',
          not (dashboard_metrics() ? 'savings_categories')
          and not (dashboard_metrics() ? 'savings_arrears')
          and not (dashboard_metrics() ? 'members_uncategorised'),
          null);

  insert into t_result (step, ok, detail)
  values ('4e the savings dashboard reports what came in, not what was owed',
          not (savings_dashboard(v_month, current_date) ? 'outstanding_savings')
          and not (savings_dashboard(v_month, current_date) ? 'total_arrears')
          and (savings_dashboard(v_month, current_date) ->> 'collected_savings')::numeric >= 98500,
          savings_dashboard(v_month, current_date) ->> 'collected_savings');

  insert into t_result (step, ok, detail)
  values ('4f the savings performance report counts deposits, not compliance',
          (select total_saved from savings_performance(v_month, current_date)
            where member_id = v_a) = 98500
          and (select deposits from savings_performance(v_month, current_date)
                where member_id = v_a) = 3,
          null);

  -- =====================================================================
  -- 5. Reconciliation with the one ledger
  -- =====================================================================
  select savings_balance into v_num from member_financials where id = v_a;
  insert into t_result (step, ok, detail)
  values ('5a the savings balance equals the ledger',
          v_num = (select coalesce(sum(case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                                            then amount else -amount end), 0)
                     from transactions
                    where member_id = v_a and status = 'posted'
                      and type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')),
          to_char(v_num, 'FM999,999,999'));

  insert into t_result (step, ok, detail)
  values ('5b the period totals equal the posted savings payments',
          (select paid_amount from savings_periods where id = v_period)
            = (select coalesce(sum(sp.amount), 0) from savings_payments sp
                 join transactions t on t.id = sp.transaction_id
                where sp.period_id = v_period and t.status = 'posted'),
          null);

  select share_value into v_num from member_financials where id = v_b;
  insert into t_result (step, ok, detail)
  values ('5c the share value equals the posted share lots',
          v_num = (select coalesce(sum(sl.total_value), 0) from share_lots sl
                     join transactions t on t.id = sl.transaction_id
                    where sl.member_id = v_b and t.status = 'posted'),
          to_char(v_num, 'FM999,999,999'));

  insert into t_result (step, ok, detail)
  values ('5d savings this month is taken from the ledger',
          (select savings_this_month from member_financials where id = v_a) = 98500,
          (select to_char(savings_this_month, 'FM999,999,999') from member_financials where id = v_a));

  -- =====================================================================
  -- 6. Reversals still work
  -- =====================================================================
  select t.id into v_txn from transactions t
    join savings_payments sp on sp.transaction_id = t.id
   where sp.member_id = v_a and t.status = 'posted' and sp.amount = 73500
   limit 1;
  perform reverse_transaction(v_txn, 'Automated test: recorded against the wrong member.');
  insert into t_result (step, ok, detail)
  values ('6a a savings deposit can be reversed',
          (select status from transactions where id = v_txn) = 'reversed',
          (select status::text from transactions where id = v_txn));
  insert into t_result (step, ok, detail)
  values ('6b the period is recomputed from what is still posted',
          (select paid_amount from savings_periods where id = v_period) = 25000
          and (select status from savings_periods where id = v_period) = 'paid',
          (select paid_amount::text from savings_periods where id = v_period));
  insert into t_result (step, ok, detail)
  values ('6c the balance follows the reversal',
          (select savings_balance from member_financials where id = v_a) = 25000,
          (select to_char(savings_balance, 'FM999,999,999') from member_financials where id = v_a));

  select t.id into v_txn from transactions t
    join share_lots sl on sl.transaction_id = t.id
   where sl.member_id = v_b and t.status = 'posted' and sl.quantity = 1
   limit 1;
  perform reverse_transaction(v_txn, 'Automated test: share sale recorded twice.');
  insert into t_result (step, ok, detail)
  values ('6d a share purchase can be reversed and the holding follows',
          (select share_count from member_shares where member_id = v_b) = 135,
          (select share_count::text from member_shares where member_id = v_b));

  -- =====================================================================
  -- 7. Statements
  -- =====================================================================
  v_stmt := member_statement(v_a, v_month, current_date);
  insert into t_result (step, ok, detail)
  values ('7a the statement lists every deposit and its reversal',
          (select count(*) from jsonb_array_elements(v_stmt -> 'rows') r
            where r ->> 'type' in ('weekly_savings', 'monthly_savings')) >= 4,
          (select count(*)::text from jsonb_array_elements(v_stmt -> 'rows') r));
  insert into t_result (step, ok, detail)
  values ('7b the statement closes at the member''s real balance',
          (v_stmt -> 'rows' -> -1 ->> 'running_balance')::numeric
            = (select savings_balance from member_financials where id = v_a),
          null);
  insert into t_result (step, ok, detail)
  values ('7c the statement names no savings category or target',
          not (v_stmt -> 'member' ? 'savings_category_name')
          and not (v_stmt -> 'member' ? 'savings_expected_amount')
          and not (v_stmt -> 'member' ? 'savings_outstanding'),
          null);

  -- =====================================================================
  -- 8. History is untouched
  -- =====================================================================
  insert into t_result (step, ok, detail)
  values ('8a no historical transaction was deleted or restated',
          not exists (
            select 1 from t_history_before b
             left join transactions t on t.id = b.id
             where t.id is null or t.amount is distinct from b.amount
                or t.occurred_on is distinct from b.occurred_on
                or t.type is distinct from b.type
                or t.status is distinct from b.status),
          (select count(*)::text || ' row(s) checked' from t_history_before));

  insert into t_result (step, ok, detail)
  values ('8b no historical share lot was deleted or repriced',
          not exists (
            select 1 from t_lots_before b
             left join share_lots l on l.id = b.id
             where l.id is null or l.unit_price is distinct from b.unit_price
                or l.quantity is distinct from b.quantity
                or l.total_value is distinct from b.total_value),
          (select count(*)::text || ' lot(s) checked' from t_lots_before));

  insert into t_result (step, ok, detail)
  values ('8c no historical savings period was deleted or rewritten',
          not exists (
            select 1 from t_periods_before b
             left join savings_periods p on p.id = b.id
             where p.id is null or p.expected_amount is distinct from b.expected_amount
                or p.paid_amount is distinct from b.paid_amount
                or p.status is distinct from b.status),
          (select count(*)::text || ' period(s) checked' from t_periods_before));

  -- --- waivers, retired by 0044 ------------------------------------------
  insert into t_result (step, ok, detail)
  values ('8e a savings waiver can no longer be created',
          not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'waive_savings_schedule'),
          'waive_savings_schedule() no longer exists');

  insert into t_result (step, ok, detail)
  values ('8f the waived status survives, for the months already waived',
          exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                   where t.typname = 'savings_status' and e.enumlabel = 'waived'),
          'savings_status still carries waived');

  insert into t_result (step, ok, detail)
  values ('8g no month waived before the change was reopened',
          (select count(*) from savings_periods where status = 'waived')
            = (select count(*) from t_periods_before where status = 'waived'),
          (select count(*)::text || ' waived month(s), unchanged' from t_periods_before
            where status = 'waived'));

  insert into t_result (step, ok, detail)
  values ('8d the retired category rows are kept, not deleted',
          (select count(*) from savings_categories) = 3
          and (select count(*) from share_categories) = 3,
          (select count(*)::text from savings_categories) || ' savings + '
          || (select count(*)::text from share_categories) || ' share categor(ies) kept, all inactive');

  -- =====================================================================
  -- 9. Security is unchanged
  -- =====================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a_user, 'role', 'authenticated')::text, true);

  select count(*) into v_n from members;
  insert into t_result (step, ok, detail)
  values ('9a a member still sees only themselves', v_n = 1, v_n || ' row(s)');

  select count(*) into v_n from member_financials;
  insert into t_result (step, ok, detail)
  values ('9b a member still sees only their own financials', v_n = 1, v_n || ' row(s)');

  select count(*) into v_n from savings_transactions where member_id <> v_a;
  insert into t_result (step, ok, detail)
  values ('9c a member cannot see anybody else''s deposits', v_n = 0, v_n || ' row(s)');

  select count(*) into v_n from savings_schedules where member_id <> v_a;
  insert into t_result (step, ok, detail)
  values ('9d a member cannot see anybody else''s savings months', v_n = 0, v_n || ' row(s)');

  select count(*) into v_n from member_share_progress where member_id <> v_a;
  insert into t_result (step, ok, detail)
  values ('9e a member cannot see anybody else''s shareholding', v_n = 0, v_n || ' row(s)');

  begin
    perform record_savings_payment(v_a, 'monthly', 1000, current_date, 'cash', 'test:rules:self');
    insert into t_result (step, ok, detail)
    values ('9f a member cannot record their own savings', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('9f a member cannot record their own savings', true, v_err);
  end;

  begin
    perform buy_shares(v_a, 5, 'cash', current_date, null, 'test:rules:selfshare', 50000);
    insert into t_result (step, ok, detail)
    values ('9g a member cannot sell themselves shares', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('9g a member cannot sell themselves shares', true, v_err);
  end;

  begin
    perform update_share_settings(1, 1);
    insert into t_result (step, ok, detail)
    values ('9h a member cannot change the share price', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('9h a member cannot change the share price', true, v_err);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- A month waived before 0044 stays closed.
--
-- Nothing can create a waiver any more, so the historical one is stood up the
-- only way left - by writing the status as the owner does - and then the rule
-- that matters is proved: a waived month refuses further deposits, exactly as
-- it did before waivers were retired.
-- ---------------------------------------------------------------------------
reset role;

do $waived$
declare
  v_b      uuid := (select id from t_ctx where key = 'b');
  v_period uuid;
  v_err    text;
begin
  -- Section 9 left the session claiming to be the member. Put the
  -- administrator back, so the refusal below is the waiver's and not a
  -- permission check standing in front of it.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from app_users
                               where role = 'super_admin' and is_active
                               order by created_at limit 1),
                      'role', 'authenticated')::text, true);

  select id into v_period from savings_periods
   where member_id = v_b and status <> 'waived' limit 1;

  if v_period is null then
    v_period := (ensure_savings_period(v_b, 'monthly'::savings_kind,
                                       (current_date - 40)::date)).id;
  end if;

  update savings_periods set status = 'waived' where id = v_period;

  begin
    perform record_scheduled_savings(v_period, 1000, current_date, 'cash', null, null,
                                     'test:rules:intowaived');
    insert into t_result (step, ok, detail)
    values ('8h a month waived before the change stays closed', false, 'accepted');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into t_result (step, ok, detail)
    values ('8h a month waived before the change stays closed',
            v_err ilike '%waived%', v_err);
  end;

  perform recompute_savings_period(v_period);
  insert into t_result (step, ok, detail)
  values ('8i and a recompute leaves it waived',
          (select status from savings_periods where id = v_period) = 'waived',
          (select status::text from savings_periods where id = v_period));
end;
$waived$;

set role authenticated;

-- ---------------------------------------------------------------------------
-- The nightly job, as the scheduler runs it.
--
-- It used to sweep unpaid periods into 'missed' and open a schedule for every
-- member. It must now do neither: a month a member did not save in is not a
-- debt, and there is no schedule to raise.
-- ---------------------------------------------------------------------------
reset role;

do $maint$
declare
  v_res     jsonb;
  v_before  integer;
  v_after   integer;
begin
  -- On a database upgraded from the old rules, months raised under the old
  -- savings targets are still marked `missed`, and stay that way: they are the
  -- record of what was asked at the time. What must be true is that the job
  -- creates no new one.
  select count(*) into v_before from savings_periods where status = 'missed';

  v_res := run_daily_maintenance();
  insert into t_result (step, ok, detail)
  values ('2i the nightly job marks no period missed and opens no schedule',
          (v_res ->> 'periods_marked_missed')::integer = 0
          and (v_res ->> 'schedules_opened')::integer = 0,
          v_res::text);

  select count(*) into v_after from savings_periods where status = 'missed';
  insert into t_result (step, ok, detail)
  values ('2j the nightly job puts no member into arrears',
          v_after = v_before,
          format('%s missed month(s) before, %s after — all of them historical', v_before, v_after));

  insert into t_result (step, ok, detail)
  values ('2k no month raised under the new rules can be missed or partial',
          not exists (select 1 from savings_periods
                       where expected_amount = 0 and status in ('missed', 'partial')),
          'a month expecting nothing is never a shortfall');
end;
$maint$;

set role authenticated;

select step, ok, detail from t_result order by n;

rollback;
