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
  v_row     text[];
  v_id      uuid;
  v_i       integer := 0;
  v_charges uuid[];
  v_cash    uuid;
  v_fee     fees;
begin
  -- The registration fee is only charged to a member whose join date falls on
  -- or after the fee takes effect. The demo register is backdated by design,
  -- so the fee is backdated with it; otherwise no demo member is ever charged
  -- and the Membership Fees module has nothing to show.
  for v_fee in
    select * from fees
     where charged_when = 'registration' and status = 'active'
       and effective_from > current_date - 700
  loop
    perform update_fee(v_fee.id,
      to_jsonb(v_fee) || jsonb_build_object('effective_from', (current_date - 700)::text),
      'Demo data: the register is backdated, so the fee is backdated with it.');
  end loop;

  select id into v_cash from financial_accounts
   where account_type = 'cash' and status = 'active' order by created_at limit 1;

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
      'joined_on',            current_date - (v_i * 47)
    )) ->> 'member_id')::uuid;

    -- The membership fee, collected the way the counter collects it. The demo
    -- register deliberately shows all three states the module has to display:
    -- most members have settled, one has part paid, one has not paid at all.
    -- A member who has not settled stays Pending, which is the rule working.
    select array_agg(mf.id) into v_charges
      from member_fees mf
     where mf.member_id = v_id and mf.status in ('unpaid', 'partial');

    if v_charges is not null then
      if v_i <= 9 then
        perform pay_member_fees(v_id, v_charges, v_cash, 'cash',
                                (current_date - (v_i * 47) + 1)::date, null, null, null);
      elsif v_i = 10 then
        -- Part paid: the balance is what is left of what they were charged.
        perform pay_member_fees(v_id, v_charges, v_cash, 'cash',
                                (current_date - (v_i * 47) + 1)::date, null, 5000, null);
      elsif v_i = 11 then
        perform pay_member_fees(v_id, v_charges, v_cash, 'cash',
                                (current_date - (v_i * 47) + 1)::date, null, 12000, null);
      end if;
      -- v_i = 12 pays nothing, and stays Pending owing the whole fee.
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
    -- Any whole number of shares: there is no tier and no ceiling, so the demo
    -- register shows a spread from one share to a hundred.
    v_qty := case v_i % 5
               when 0 then 1
               when 1 then 5
               when 2 then 20
               when 3 then 47
               else        100
             end;

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
-- Monthly savings for the last ten months.
--
-- Savings are open: a member saves what they choose, when they choose. The
-- demo data is deliberately uneven - some months carry several deposits, some
-- carry one, some carry none at all - because that is what open savings look
-- like, and a month with nothing in it must not read as a debt anywhere in the
-- system.
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  v_month  integer;
  v_paid_on date;
  v_amount numeric;
  v_i      integer := 0;
begin
  for m in select id, member_no from members where status = 'active' order by member_no loop
    v_i := v_i + 1;

    for v_month in reverse 10 .. 1 loop
      v_paid_on := (date_trunc('month', current_date) - (v_month || ' months')::interval
                    + interval '9 days')::date;

      -- A repeatable but uneven pattern, in amounts a member would actually
      -- choose rather than amounts a tier would have dictated.
      v_amount := case (v_i + v_month) % 6
        when 0 then 0        -- a month they did not save
        when 1 then 5000
        when 2 then 12000
        when 3 then 30000
        when 4 then 73500
        else        100000
      end;

      if v_amount > 0 then
        perform record_savings_payment(
          p_member_id => m.id,
          p_kind      => 'monthly',
          p_amount    => v_amount,
          p_paid_on   => v_paid_on,
          p_method    => case when (v_i + v_month) % 3 = 0 then 'mobile_money'::payment_method
                              else 'cash'::payment_method end,
          p_idempotency_key => 'seed:mo:' || m.member_no || ':' || v_month
        );

        -- Some members save twice in a month. Nothing stops them, and the two
        -- deposits simply add up.
        if (v_i + v_month) % 4 = 0 then
          perform record_savings_payment(
            p_member_id => m.id,
            p_kind      => 'monthly',
            p_amount    => 20000,
            p_paid_on   => v_paid_on + 11,
            p_method    => 'cash',
            p_idempotency_key => 'seed:mo2:' || m.member_no || ':' || v_month
          );
        end if;
      end if;
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
  -- Created through save_loan_product(), the function the Loans -> Products
  -- screen calls. 0037 stopped shipping invented products in the migrations,
  -- so a demo database defines its own here, the same way a SACCO would.
  if not exists (select 1 from loan_products where code = 'BIZ') then
    perform save_loan_product(null, jsonb_build_object(
      'name', 'Business Loan', 'code', 'BIZ', 'interest_rate', 18.0,
      'interest_method', 'flat', 'min_amount', 200000, 'max_amount', 20000000,
      'min_period_months', 3, 'max_period_months', 24, 'processing_fee_pct', 1.0,
      'min_guarantors', 2, 'description', 'Demo product.'), 'Demo data');
  end if;
  if not exists (select 1 from loan_products where code = 'EMG') then
    perform save_loan_product(null, jsonb_build_object(
      'name', 'Emergency Loan', 'code', 'EMG', 'interest_rate', 12.0,
      'interest_method', 'flat', 'min_amount', 50000, 'max_amount', 3000000,
      'min_period_months', 1, 'max_period_months', 6, 'processing_fee_pct', 0.5,
      'min_guarantors', 1, 'description', 'Demo product.'), 'Demo data');
  end if;
  if not exists (select 1 from loan_products where code = 'SCH') then
    perform save_loan_product(null, jsonb_build_object(
      'name', 'School Fees Loan', 'code', 'SCH', 'interest_rate', 15.0,
      'interest_method', 'flat', 'min_amount', 100000, 'max_amount', 5000000,
      'min_period_months', 3, 'max_period_months', 12, 'processing_fee_pct', 1.0,
      'min_guarantors', 2, 'description', 'Demo product.'), 'Demo data');
  end if;

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
    -- The guarantors accept. RLS gives `authenticated` no write here, so this
    -- seed-only shortcut runs as the owner.
    set local role postgres;
    update loan_guarantors set status = 'accepted', responded_on = current_date
     where loan_id = v_loan;
    set local role authenticated;

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
        'Repayment capacity is not yet demonstrated by the savings record.');

    else
      -- Disbursed and being repaid.
      perform set_loan_status(v_loan, 'under_review', 'Standard assessment.');
      perform set_loan_status(v_loan, 'approved', 'Approved by the credit committee.');

      perform disburse_loan(
        p_loan_id      => v_loan,
        p_method       => 'cash',
        p_disbursed_on => (current_date - interval '5 months')::date,
        p_idempotency_key => 'seed:disb:' || m.member_no
      );

      -- Backdate the schedule so some installments are genuinely due. There is
      -- no application operation for this - a real loan's dates are whatever
      -- actually happened - so the seed borrows the owner role for it.
      set local role postgres;
      update loans set disbursed_on = (current_date - interval '5 months')::date
       where id = v_loan;
      update loan_schedule s
         set due_on = (select l.disbursed_on from loans l where l.id = v_loan)
                      + (s.installment_no || ' months')::interval
       where s.loan_id = v_loan;
      set local role authenticated;

      -- Repay a different number of installments per member: member 6 is up to
      -- date, 7 is behind (so it shows as overdue), 8 clears the loan.
      declare
        v_installments integer := case v_i when 6 then 5 when 7 then 2 else 12 end;
        v_n integer;
        v_amt numeric;
        v_out numeric;
        v_on  date;
      begin
        for v_n in 1 .. v_installments loop
          select outstanding into v_out from loan_balances where loan_id = v_loan;
          exit when v_out <= 0;

          select installment_amount into v_amt from loans where id = v_loan;
          v_amt := least(v_amt, v_out);

          -- One installment a month from disbursement, but never later than
          -- today: money is recorded when it has actually been received, and
          -- 0041 refuses a value date in the future. The old seed walked past
          -- today and left two repayments dated a month and two months ahead,
          -- which made every report drawn up "as at" a date disagree with the
          -- account's live balance.
          v_on := least((current_date - interval '5 months'
                          + (v_n || ' months')::interval)::date, current_date);

          perform record_loan_repayment(
            p_loan_id => v_loan,
            p_amount  => v_amt,
            p_paid_on => v_on,
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
   where type = 'monthly_savings' and status = 'posted'
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
--
-- run_daily_maintenance() is the nightly job. It is owned by the database and
-- is not granted to `authenticated`, because no person runs it: pg_cron or an
-- external scheduler does, as the owner. The seed does the same, keeping the
-- administrator's claim so the audit entries name a real person.
-- ---------------------------------------------------------------------------
reset role;
select run_daily_maintenance();
set role authenticated;

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
