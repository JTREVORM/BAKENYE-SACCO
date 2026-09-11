-- ===========================================================================
-- BND-SACCO - DEMO DATA
--
-- Optional. Run this only on a development or demo project, never on the
-- SACCO's live database. It creates members, savings history, share purchases
-- and a loan at each stage of its life so every screen has something real to
-- show.
--
-- It calls the same SECURITY DEFINER functions the application does, so the
-- resulting data is indistinguishable from data entered through the UI:
-- correct references, correct audit entries, correct derived balances.
--
--   psql "$DATABASE_URL" -f supabase/seed.sql
--
-- Prerequisites: migrations 0001-0006 applied, and at least one staff user
-- created through the app (Supabase Auth) whose id you paste below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Run everything as a specific staff member, so `auth.uid()` resolves and the
-- role checks inside the RPCs behave exactly as they do in the application.
--
-- Replace this with the id of a real super_admin from `app_users`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid;
begin
  select id into v_admin from app_users where role = 'super_admin' and is_active order by created_at limit 1;

  if v_admin is null then
    raise exception
      'No active super_admin found. Create a staff account through the app first, then re-run this seed.';
  end if;

  -- Impersonate for the rest of the session. `auth.uid()` reads this JWT claim.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);

  raise notice 'Seeding as %', v_admin;
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo accounts (0027). Mobile money lands in a merchant account and bank
-- transfers in a bank account, so a demo database needs one of each. Both are
-- labelled as demo accounts, and the opening balances exist only so the demo
-- loans below have cash to be disbursed from.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cash uuid;
begin
  if not exists (select 1 from financial_accounts where account_type = 'merchant') then
    perform create_financial_account('merchant', 'Demo Merchant Account', 'MTN Mobile Money',
                                     null, null, null, null, null, 0, current_date - 120,
                                     'Demo data only.', true);
  end if;
  if not exists (select 1 from financial_accounts where account_type = 'bank') then
    perform create_financial_account('bank', 'Demo Bank Account', null, null, null,
                                     'Demo Bank', null, '0000000000', 50000000, current_date - 120,
                                     'Demo data only.', true);
  end if;

  select id into v_cash from financial_accounts where account_type = 'cash' and is_default;
  if v_cash is not null
     and not exists (select 1 from account_ledger_entries where account_id = v_cash) then
    perform update_financial_account(v_cash, 'Cash at Hand', null, null, null, null, null, null,
                                     50000000, current_date - 120, 'Demo opening balance.', true,
                                     'Demo seed');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
do $$
declare
  v_names text[][] := array[
    ['Nakabugo Christine',  '+256772100001', 'Fish trader',     'female'],
    ['Wanyama Peter',       '+256772100002', 'Boda boda rider', 'male'],
    ['Namutebi Sarah',      '+256772100003', 'Teacher',         'female'],
    ['Kato Emmanuel',       '+256772100004', 'Carpenter',       'male'],
    ['Aisha Namatovu',      '+256772100005', 'Shopkeeper',      'female'],
    ['Musoke John',         '+256772100006', 'Farmer',          'male'],
    ['Kizza Robert',        '+256772100007', 'Mechanic',        'male'],
    ['Auma Grace',          '+256772100008', 'Tailor',          'female'],
    ['Ouma Peter',          '+256772100009', 'Fishmonger',      'male'],
    ['Nabirye Joyce',       '+256772100010', 'Poultry farmer',  'female'],
    ['Mugisha Alex',        '+256772100011', 'Welder',          'male'],
    ['Nassuna Betty',       '+256772100012', 'Hairdresser',     'female']
  ];
  v_row  text[];
  v_id   uuid;
  v_i    integer := 0;
begin
  foreach v_row slice 1 in array v_names loop
    v_i := v_i + 1;

    -- Skip if this demo member already exists, so the seed can be re-run.
    if exists (select 1 from members where phone = v_row[2]) then
      continue;
    end if;

    -- Registered through the same function the registration wizard calls, with
    -- the join backdated so the register does not look like everyone arrived
    -- on the same day. Any registration fees the SACCO has configured are
    -- waived: this is demo data, and inventing payments would not be.
    v_id := (register_member(jsonb_build_object(
      'full_name',            v_row[1],
      'phone',                v_row[2],
      'national_id',          'CM' || lpad((90000000 + v_i)::text, 8, '0') || 'XY',
      'address',              'Bugungumale Trading Centre, Mayuge District',
      'date_of_birth',        (date '1985-01-01' + (v_i * 137))::date,
      'gender',               v_row[4],
      'occupation',           v_row[3],
      'next_of_kin_name',     'Next of Kin ' || v_i,
      'next_of_kin_phone',    '+25678210' || lpad(v_i::text, 4, '0'),
      'next_of_kin_relation', case when v_i % 2 = 0 then 'Spouse' else 'Sibling' end,
      'joined_on',            current_date - (v_i * 47),
      'share_category_id',    (select id from share_categories where status = 'active' order by sort_order limit 1),
      'savings_category_id',  (select id from savings_categories where status = 'active' order by sort_order limit 1)
    )) ->> 'member_id')::uuid;

    perform waive_member_fee(mf.id, 'Demo data: fee not collected')
       from member_fees mf where mf.member_id = v_id and mf.status = 'unpaid';

    -- Savings plans: a weekly target for everyone, monthly for most.
    insert into savings_plans (member_id, kind, target_amount, active_from)
    values (v_id, 'weekly', 20000, current_date - (v_i * 47));

    if v_i % 4 <> 0 then
      insert into savings_plans (member_id, kind, target_amount, active_from)
      values (v_id, 'monthly', 100000, current_date - (v_i * 47));
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Share purchases
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  v_qty integer;
  v_i integer := 0;
begin
  for m in select id, member_no from members where status = 'active' order by member_no loop
    v_i := v_i + 1;
    v_qty := 1 + (v_i * 3) % 20;

    perform buy_shares(
      p_member_id => m.id,
      p_quantity  => v_qty,
      p_method    => 'cash',
      p_purchased_on => current_date - (v_i * 11),
      p_note      => 'Initial share subscription',
      p_idempotency_key => 'seed:shares:' || m.member_no
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Weekly savings for the last 10 weeks.
--
-- Deliberately imperfect: some members pay in full, some pay part, some miss
-- weeks entirely. A demo where everyone is compliant tells you nothing about
-- whether the arrears reporting works.
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  v_week integer;
  v_paid_on date;
  v_amount numeric;
  v_i integer := 0;
begin
  for m in select id, member_no from members where status = 'active' order by member_no loop
    v_i := v_i + 1;

    for v_week in reverse 10 .. 1 loop
      v_paid_on := (date_trunc('week', current_date) - (v_week || ' weeks')::interval + interval '3 days')::date;

      -- A repeatable but uneven pattern.
      v_amount := case (v_i + v_week) % 5
        when 0 then 0            -- missed
        when 1 then 10000        -- partial
        else 20000               -- on target
      end;

      if v_amount > 0 then
        perform record_savings_payment(
          p_member_id => m.id,
          p_kind      => 'weekly',
          p_amount    => v_amount,
          p_paid_on   => v_paid_on,
          p_method    => case when (v_i + v_week) % 3 = 0 then 'mobile_money'::payment_method else 'cash'::payment_method end,
          p_idempotency_key => 'seed:wk:' || m.member_no || ':' || v_week
        );
      else
        -- Open the period anyway so the shortfall is measurable.
        perform ensure_savings_period(m.id, 'weekly', v_paid_on);
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Monthly savings for the last 4 months.
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  v_month integer;
  v_paid_on date;
  v_i integer := 0;
begin
  for m in
    select distinct mem.id, mem.member_no
      from members mem
      join savings_plans sp on sp.member_id = mem.id and sp.kind = 'monthly'
     where mem.status = 'active'
     order by mem.member_no
  loop
    v_i := v_i + 1;

    for v_month in reverse 4 .. 1 loop
      v_paid_on := (date_trunc('month', current_date) - (v_month || ' months')::interval + interval '9 days')::date;

      perform record_savings_payment(
        p_member_id => m.id,
        p_kind      => 'monthly',
        p_amount    => case when (v_i + v_month) % 4 = 0 then 60000 else 100000 end,
        p_paid_on   => v_paid_on,
        p_method    => 'cash',
        p_idempotency_key => 'seed:mo:' || m.member_no || ':' || v_month
      );
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Loans at every stage: applied, under review, approved, active (some
-- overdue), and completed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_biz uuid;
  v_emg uuid;
  v_sch uuid;
  m record;
  v_loan uuid;
  v_res jsonb;
  v_i integer := 0;
  v_guarantors jsonb;
  v_g1 uuid;
  v_g2 uuid;
begin
  -- Demo products. A real SACCO defines its own under Loans -> Products; the
  -- migrations ship none (0037).
  insert into loan_products
    (name, code, interest_rate, interest_method, min_amount, max_amount,
     min_period_months, max_period_months, processing_fee_pct, min_guarantors, description)
  values
    ('Business Loan',    'BIZ', 18.0, 'flat', 200000, 20000000, 3, 24, 1.0, 2, 'Demo product.'),
    ('Emergency Loan',   'EMG', 12.0, 'flat',  50000,  3000000, 1,  6, 0.5, 1, 'Demo product.'),
    ('School Fees Loan', 'SCH', 15.0, 'flat', 100000,  5000000, 3, 12, 1.0, 2, 'Demo product.')
  on conflict (code) do nothing;

  select id into v_biz from loan_products where code = 'BIZ';
  select id into v_emg from loan_products where code = 'EMG';
  select id into v_sch from loan_products where code = 'SCH';

  for m in select id, member_no from members where status = 'active' order by member_no limit 8 loop
    v_i := v_i + 1;

    -- Two other members back each loan.
    select id into v_g1 from members where id <> m.id and status = 'active' order by member_no limit 1;
    select id into v_g2 from members where id <> m.id and id <> v_g1 and status = 'active'
     order by member_no limit 1;

    -- Emergency loans need one guarantor; the others need two. Build the list
    -- to match, so the minimum-guarantor check inside apply_for_loan() passes
    -- for the right reason rather than by luck.
    if v_i % 3 = 2 then
      v_guarantors := jsonb_build_array(
        jsonb_build_object('member_id', v_g1, 'amount', 500000)
      );
    else
      v_guarantors := jsonb_build_array(
        jsonb_build_object('member_id', v_g1, 'amount',
          case v_i % 3 when 0 then 400000 else 1000000 end),
        jsonb_build_object('member_id', v_g2, 'amount',
          case v_i % 3 when 0 then 400000 else 1000000 end)
      );
    end if;

    v_res := apply_for_loan(
      p_member_id     => m.id,
      p_product_id    => case v_i % 3 when 0 then v_sch when 1 then v_biz else v_emg end,
      p_principal     => case v_i % 3 when 0 then 800000 when 1 then 2000000 else 500000 end,
      p_period_months => case v_i % 3 when 0 then 12 when 1 then 12 else 6 end,
      p_purpose       => case v_i % 3
                           when 0 then 'School fees for two children in Senior Three'
                           when 1 then 'Restocking the shop ahead of the school term'
                           else 'Medical treatment for a family member' end,
      p_purpose_category => case v_i % 3
                              when 0 then 'School Fees'
                              when 1 then 'Business Expansion'
                              else 'Emergency / Medical' end,
      p_guarantors    => v_guarantors,
      p_idempotency_key => 'seed:loan:' || m.member_no
    );

    v_loan := (v_res ->> 'loan_id')::uuid;
    continue when v_loan is null;

    -- Guarantors accept.
    update loan_guarantors set status = 'accepted', responded_on = current_date
     where loan_id = v_loan;

    -- Walk each loan a different distance along its lifecycle.
    if v_i <= 2 then
      -- Leave as 'applied' so the dashboard has a review queue.
      null;

    elsif v_i = 3 then
      perform set_loan_status(v_loan, 'under_review', 'Verifying the applicant''s stock records.');

    elsif v_i = 4 then
      perform set_loan_status(v_loan, 'under_review', 'Committee review scheduled.');
      perform set_loan_status(v_loan, 'approved', 'Approved by the credit committee.');

    elsif v_i = 5 then
      -- Rejected, so the declined path is visible too.
      perform set_loan_status(v_loan, 'under_review', 'Assessing repayment capacity.');
      perform set_loan_status(v_loan, 'rejected',
        'Existing weekly savings arrears must be cleared before a new loan can be considered.');

    else
      -- Disbursed and being repaid.
      perform set_loan_status(v_loan, 'under_review', 'Standard assessment.');
      perform set_loan_status(v_loan, 'approved', 'Approved by the credit committee.');

      perform disburse_loan(
        p_loan_id      => v_loan,
        p_method       => 'cash',
        p_disbursed_on => current_date - interval '5 months',
        p_idempotency_key => 'seed:disb:' || m.member_no
      );

      -- Backdate the schedule so some installments are genuinely due.
      update loans set disbursed_on = current_date - interval '5 months' where id = v_loan;
      update loan_schedule s
         set due_on = (select l.disbursed_on from loans l where l.id = v_loan)
                      + (s.installment_no || ' months')::interval
       where s.loan_id = v_loan;

      -- Repay a different number of installments per member: member 6 is up to
      -- date, 7 is behind (so it shows as overdue), 8 clears the loan.
      declare
        v_installments integer := case v_i when 6 then 5 when 7 then 2 else 12 end;
        v_n integer;
        v_amt numeric;
        v_out numeric;
      begin
        for v_n in 1 .. v_installments loop
          select outstanding into v_out from loan_balances where loan_id = v_loan;
          exit when v_out <= 0;

          select installment_amount into v_amt from loans where id = v_loan;
          v_amt := least(v_amt, v_out);

          perform record_loan_repayment(
            p_loan_id => v_loan,
            p_amount  => v_amt,
            p_paid_on => (current_date - interval '5 months' + (v_n || ' months')::interval)::date,
            p_method  => case when v_n % 2 = 0 then 'mobile_money'::payment_method else 'cash'::payment_method end,
            p_idempotency_key => 'seed:rep:' || m.member_no || ':' || v_n
          );
        end loop;
      end;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- A few deposits and one withdrawal.
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  v_i integer := 0;
begin
  for m in select id, member_no from members where status = 'active' order by member_no limit 5 loop
    v_i := v_i + 1;

    perform record_cash_movement(
      p_member_id => m.id,
      p_type      => 'deposit',
      p_amount    => 50000 * v_i,
      p_method    => 'mobile_money',
      p_occurred_on => current_date - (v_i * 9),
      p_description => 'Ad-hoc savings top-up',
      p_idempotency_key => 'seed:dep:' || m.member_no
    );

    if v_i = 2 then
      perform record_cash_movement(
        p_member_id => m.id,
        p_type      => 'withdrawal',
        p_amount    => 40000,
        p_method    => 'cash',
        p_occurred_on => current_date - 4,
        p_description => 'School requirements',
        p_idempotency_key => 'seed:wdr:' || m.member_no
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Income and expenses, so the cashbook is not empty.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cat uuid;
  v_exp uuid;
  v_i integer;
begin
  select id into v_cat from income_categories where name = 'Membership fees';
  for v_i in 1 .. 3 loop
    perform record_income(
      p_category_id => v_cat,
      p_amount      => 240000,
      p_description => 'Annual membership fees, batch ' || v_i,
      p_received_on => (date_trunc('month', current_date) - ((v_i - 1) || ' months')::interval + interval '4 days')::date,
      p_method      => 'cash',
      p_idempotency_key => 'seed:inc:mf:' || v_i
    );
  end loop;

  select id into v_cat from income_categories where name = 'Registration fees';
  perform record_income(
    p_category_id => v_cat,
    p_amount      => 360000,
    p_description => 'Registration fees for 12 new members',
    p_received_on => current_date - 20,
    p_method      => 'cash',
    p_idempotency_key => 'seed:inc:reg'
  );

  -- Expenses: some approved, one left pending so the approval queue is live.
  for v_i in 1 .. 4 loop
    select id into v_exp from expense_categories
     where name = (array['Rent', 'Salaries', 'Internet', 'Transport'])[v_i];

    declare
      v_res jsonb;
      v_expense uuid;
    begin
      v_res := record_expense(
        p_category_id => v_exp,
        p_amount      => (array[600000, 1800000, 150000, 90000])[v_i],
        p_description => (array[
          'Office rent for the current month',
          'Staff salaries',
          'Office internet subscription',
          'Field visits to Bukatuube and Bugungumale'
        ])[v_i],
        p_spent_on    => current_date - (v_i * 5),
        p_method      => case when v_i = 2 then 'bank_transfer'::payment_method else 'cash'::payment_method end,
        p_idempotency_key => 'seed:exp:' || v_i
      );

      v_expense := (v_res ->> 'expense_id')::uuid;

      -- Leave the last one awaiting approval.
      if v_i < 4 and v_expense is not null then
        perform approve_expense(v_expense, true, null);
      end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- One reversed transaction, so the correction workflow is visible.
-- ---------------------------------------------------------------------------
do $$
declare
  v_txn uuid;
begin
  select id into v_txn
    from transactions
   where type = 'weekly_savings' and status = 'posted'
   order by created_at
   limit 1;

  if v_txn is not null then
    perform reverse_transaction(
      v_txn,
      'Recorded against the wrong member during the Tuesday collection round; corrected on the same day.'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bring the derived savings statuses up to date.
-- ---------------------------------------------------------------------------
select run_daily_maintenance();

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  select jsonb_build_object(
    'members',      (select count(*) from members),
    'transactions', (select count(*) from transactions),
    'loans',        (select count(*) from loans),
    'share_value',  (select coalesce(sum(total_value), 0) from share_lots),
    'savings',      (select coalesce(sum(case when type in ('weekly_savings','monthly_savings','deposit')
                                               then amount else -amount end), 0)
                       from transactions
                      where status = 'posted'
                        and type in ('weekly_savings','monthly_savings','deposit','withdrawal'))
  ) into v;

  raise notice 'Seed complete: %', v;
end;
$$;
