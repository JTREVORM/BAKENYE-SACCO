begin;

create temp table t_result (n serial, step text, ok boolean, detail text);
create temp table t_ctx (key text primary key, id uuid);

-- ===========================================================================
-- Cash at Merchant, Cash at Bank, Cash at Hand - end to end.
--
-- Walks the worked scenario from the brief with its own accounts and members,
-- then every control around it: duplicate references, idempotent replays,
-- the zero-balance rule, reversals, immutability, the approval workflow for a
-- cashier, four eyes, reconciliation, the reports, and what a member can see.
-- Everything is rolled back at the end.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Fixtures that need more than the `authenticated` role: a cashier login and
-- a member login.
-- ---------------------------------------------------------------------------
reset role;

do $fixture$
declare
  v_cashier uuid := gen_random_uuid();
  v_member_user uuid := gen_random_uuid();
  v_mid uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values
    (v_cashier, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'treasury.cashier@test.invalid', '', now(), jsonb_build_object('role', 'cashier'),
     jsonb_build_object('full_name', 'Test Cashier'), now(), now());

  v_mid := (register_member(jsonb_build_object(
              'full_name', 'Treasury Test Member', 'phone', '+256779100009',
              'share_category_id', (select id from share_categories where status = 'active' order by sort_order limit 1),
              'savings_category_id', (select id from savings_categories where status = 'active' order by sort_order limit 1)))
            ->> 'member_id')::uuid;

  -- The member's login names the member; the trigger links them.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values
    (v_member_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'treasury.member@test.invalid', '', now(), jsonb_build_object('member_id', v_mid),
     '{}'::jsonb, now(), now());

  -- Both logins stand for people who have already changed their temporary
  -- password; until then an account can do nothing.
  update app_users set must_change_password = false where id in (v_cashier, v_member_user);

  insert into t_ctx values ('cashier', v_cashier), ('member_user', v_member_user);
end;
$fixture$;

set role authenticated;

do $$
declare
  v_admin   uuid := auth.uid();
  v_cashier uuid := (select id from t_ctx where key = 'cashier');
  v_muser   uuid := (select id from t_ctx where key = 'member_user');
  v_mer     uuid;
  v_bank    uuid;
  v_cash    uuid;
  v_a       uuid;
  v_b       uuid;
  v_res     jsonb;
  v_txn     transactions;
  v_total0  numeric;
  v_income0 numeric;
  v_exp0    numeric;
  v_sav0    numeric;
  v_n       integer;
  v_cat     uuid;
  v_pcat    uuid;
  v_exp     uuid;
  v_trf     uuid;
  v_report  jsonb;
  v_ok      boolean;
  r         record;
begin
  -- The rules this suite asserts against, set explicitly so the result does
  -- not depend on how the live SACCO is configured.
  perform update_settings(jsonb_build_object(
    'treasury.require_approval', true,
    'treasury.approval_threshold', 0,
    'treasury.four_eyes', false,
    'treasury.allow_negative_balances', false), 'treasury test');

  -- ---- Accounts ------------------------------------------------------------
  v_mer  := (create_financial_account('merchant', 'TEST Merchant', 'MTN Mobile Money', 'TEST-MC-1',
                                      '0770000000') ->> 'id')::uuid;
  v_bank := (create_financial_account('bank', 'TEST Bank', null, null, null, 'Test Bank Uganda',
                                      'Kampala', '000111222') ->> 'id')::uuid;
  v_cash := (create_financial_account('cash', 'TEST Till') ->> 'id')::uuid;

  insert into t_result (step, ok, detail)
  values ('accounts start at their opening balance of zero',
          finance_account_balance_at(v_mer) = 0 and finance_account_balance_at(v_bank) = 0 and finance_account_balance_at(v_cash) = 0,
          null);

  v_a := (register_member(jsonb_build_object(
            'full_name', 'Treasury Member A', 'phone', '+256779100001',
            'share_category_id', (select id from share_categories where status = 'active' order by sort_order limit 1),
            'savings_category_id', (select id from savings_categories where status = 'active' and frequency = 'monthly' order by sort_order limit 1)))
          ->> 'member_id')::uuid;
  v_b := (register_member(jsonb_build_object(
            'full_name', 'Treasury Member B', 'phone', '+256779100002',
            'share_category_id', (select id from share_categories where status = 'active' order by sort_order limit 1),
            'savings_category_id', (select id from savings_categories where status = 'active' and frequency = 'monthly' order by sort_order limit 1)))
          ->> 'member_id')::uuid;
  -- Registration fees, if this SACCO charges any, are waived so both members
  -- are active; the fee path has its own suite.
  perform waive_member_fee(mf.id, 'automated test fixture')
     from member_fees mf where mf.member_id in (v_a, v_b) and mf.status = 'unpaid';

  -- ---- Step 1: Member A pays UGX 100,000 savings through the merchant code -
  v_res := record_member_collection(v_a, 'savings', 100000, v_mer, current_date, null,
                                    'MTN-TEST-0001', null, 'Paid on phone', 'monthly', null, null,
                                    'test:treasury:1');
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;

  insert into t_result (step, ok, detail)
  values ('step 1: Cash at Merchant is UGX 100,000', finance_account_balance_at(v_mer) = 100000,
          finance_account_balance_at(v_mer)::text);
  insert into t_result (step, ok, detail)
  values ('step 1: member A savings is UGX 100,000',
          (select savings_balance from member_financials where id = v_a) = 100000, null);
  insert into t_result (step, ok, detail)
  values ('step 1: the ledger row names the merchant account and carries the provider reference',
          v_txn.destination_account_id = v_mer and v_txn.source_account_id is null
          and v_txn.external_ref = 'MTN-TEST-0001' and v_txn.method = 'mobile_money', v_txn.reference);
  insert into t_result (step, ok, detail)
  values ('step 1: one account entry, a debit of UGX 100,000',
          (select count(*) = 1 and sum(debit) = 100000 and sum(credit) = 0
             from account_ledger_entries where transaction_id = v_txn.id), null);
  insert into t_result (step, ok, detail)
  values ('step 1: an RCT receipt number is issued',
          (v_res ->> 'receipt_no') like 'RCT' || to_char(current_date, 'YYMMDD') || '%',
          v_res ->> 'receipt_no');
  insert into t_result (step, ok, detail)
  values ('step 1: the collection is in the audit log',
          exists (select 1 from audit_logs where action = 'treasury.collection'
                    and record_id = v_txn.id::text), null);

  -- ---- Step 2: Member B pays UGX 50,000 ------------------------------------
  perform record_member_collection(v_b, 'savings', 50000, v_mer, current_date, null,
                                   'MTN-TEST-0002', null, null, 'monthly', null, null,
                                   'test:treasury:2');
  insert into t_result (step, ok, detail)
  values ('step 2: Cash at Merchant is UGX 150,000', finance_account_balance_at(v_mer) = 150000,
          finance_account_balance_at(v_mer)::text);

  -- A double tap: same idempotency key, nothing new.
  select count(*) into v_n from account_ledger_entries;
  perform record_member_collection(v_a, 'savings', 100000, v_mer, current_date, null,
                                   'MTN-TEST-0001', null, null, 'monthly', null, null,
                                   'test:treasury:1');
  insert into t_result (step, ok, detail)
  values ('a replayed submission posts nothing new',
          (select count(*) from account_ledger_entries) = v_n and finance_account_balance_at(v_mer) = 150000,
          null);

  -- The same provider reference under a new key is a second banking of one payment.
  begin
    perform record_member_collection(v_b, 'savings', 5000, v_mer, current_date, null,
                                     'mtn-test-0001', null, null, 'monthly', null, null,
                                     'test:treasury:dup');
    insert into t_result (step, ok, detail) values ('a duplicate provider reference is refused', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('a duplicate provider reference is refused', sqlerrm ilike '%already been recorded%', sqlerrm);
  end;

  -- Mobile money cannot land in a cash till.
  begin
    perform record_member_collection(v_a, 'savings', 1000, v_cash, current_date, 'mobile_money',
                                     'MTN-TEST-0003', null, null, 'monthly', null, null,
                                     'test:treasury:mismatch');
    insert into t_result (step, ok, detail) values ('mobile money into a cash account is refused', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('mobile money into a cash account is refused', sqlerrm ilike '%cannot handle%', sqlerrm);
  end;

  -- A merchant collection needs its reference.
  begin
    perform record_member_collection(v_a, 'savings', 1000, v_mer, current_date, null,
                                     null, null, null, 'monthly', null, null, 'test:treasury:noref');
    insert into t_result (step, ok, detail) values ('a merchant collection without a reference is refused', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('a merchant collection without a reference is refused', sqlerrm ilike '%reference%', sqlerrm);
  end;

  -- ---- Step 3: SACCO transfers UGX 120,000 from Merchant to Bank ----------
  v_total0  := (treasury_summary() -> 'totals' ->> 'total')::numeric;
  v_income0 := (cashbook(current_date, current_date) ->> 'total_income')::numeric;
  v_exp0    := (cashbook(current_date, current_date) ->> 'total_expenses')::numeric;
  v_sav0    := (select sum(savings_balance) from member_financials where id in (v_a, v_b));

  v_res := create_internal_transfer(v_mer, v_bank, 120000, current_date, 'MTN-WD-0001', 'SLIP-0001',
                                    null, null, 'Test Cashier', null, true, 'test:treasury:trf1');
  v_trf := (v_res ->> 'id')::uuid;

  insert into t_result (step, ok, detail)
  values ('step 3: a manager''s transfer completes without waiting',
          v_res ->> 'status' = 'completed' and (v_res ->> 'transfer_no') like 'TRF%', v_res::text);
  insert into t_result (step, ok, detail)
  values ('step 3: Cash at Merchant UGX 30,000, Cash at Bank UGX 120,000',
          finance_account_balance_at(v_mer) = 30000 and finance_account_balance_at(v_bank) = 120000,
          finance_account_balance_at(v_mer)::text || ' / ' || finance_account_balance_at(v_bank)::text);
  insert into t_result (step, ok, detail)
  values ('step 3: total SACCO funds unchanged',
          (treasury_summary() -> 'totals' ->> 'total')::numeric = v_total0, null);
  insert into t_result (step, ok, detail)
  values ('step 3: the transfer is not income, not expense, not savings',
          (cashbook(current_date, current_date) ->> 'total_income')::numeric = v_income0
          and (cashbook(current_date, current_date) ->> 'total_expenses')::numeric = v_exp0
          and (select sum(savings_balance) from member_financials where id in (v_a, v_b)) = v_sav0, null);
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('step 3: ONE linked ledger row carries both accounts',
          v_txn.type = 'transfer' and v_txn.source_account_id = v_mer
          and v_txn.destination_account_id = v_bank and v_txn.reference = v_res ->> 'transfer_no'
          and (select count(*) from account_ledger_entries where transaction_id = v_txn.id) = 2, null);

  -- Sending more than the merchant wallet holds.
  begin
    perform create_internal_transfer(v_mer, v_bank, 50000, current_date, 'MTN-WD-0002', 'SLIP-0002',
                                     null, null, null, null, true, 'test:treasury:over');
    insert into t_result (step, ok, detail) values ('a transfer larger than the balance is refused', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('a transfer larger than the balance is refused', sqlerrm ilike '%cannot send%', sqlerrm);
  end;

  -- The same deposit slip twice.
  begin
    perform create_internal_transfer(v_mer, v_bank, 1000, current_date, 'MTN-WD-0003', 'slip-0001',
                                     null, null, null, null, true, 'test:treasury:slip');
    insert into t_result (step, ok, detail) values ('a deposit slip cannot be banked twice', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('a deposit slip cannot be banked twice', sqlerrm ilike '%already been recorded%', sqlerrm);
  end;

  -- ---- Step 4: SACCO withdraws UGX 30,000 from the bank --------------------
  v_res := create_internal_transfer(v_bank, v_cash, 30000, current_date, 'CHQ-0001', null,
                                    null, 'Petty cash', 'Test Cashier', null, true, 'test:treasury:wd1');
  insert into t_result (step, ok, detail)
  values ('step 4: bank UGX 90,000, cash UGX 30,000, total unchanged',
          finance_account_balance_at(v_bank) = 90000 and finance_account_balance_at(v_cash) = 30000
          and (treasury_summary() -> 'totals' ->> 'total')::numeric = v_total0
          and (v_res ->> 'transfer_no') like 'WDL%', v_res ->> 'transfer_no');

  -- ---- Step 5: UGX 10,000 spent on stationery ------------------------------
  select id into v_cat from expense_categories where name = 'Office supplies';
  v_res := record_expense(v_cat, 10000, 'Stationery', current_date, null, null, 'test:treasury:exp1',
                          v_cash, 'Stationery shop', null, null);
  v_exp := (v_res ->> 'expense_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('step 5: an expense request moves no money until approved, and is numbered EXP',
          finance_account_balance_at(v_cash) = 30000
          and (v_res ->> 'payment_no') like 'EXP' || to_char(current_date, 'YYMMDD') || '%',
          v_res ->> 'payment_no');

  perform approve_expense(v_exp, true, null);
  insert into t_result (step, ok, detail)
  values ('step 5: approved, Cash at Hand falls to UGX 20,000', finance_account_balance_at(v_cash) = 20000,
          finance_account_balance_at(v_cash)::text);
  insert into t_result (step, ok, detail)
  values ('step 5: total funds fall by UGX 10,000 and expenses rise by UGX 10,000',
          (treasury_summary() -> 'totals' ->> 'total')::numeric = v_total0 - 10000
          and (cashbook(current_date, current_date) ->> 'total_expenses')::numeric = v_exp0 + 10000, null);

  -- ---- Reversal ------------------------------------------------------------
  -- Reversing the first transfer would pull UGX 120,000 out of a bank account
  -- holding UGX 90,000. Refused, by name.
  begin
    perform reverse_transaction(v_txn.id, 'Test: this should not be allowed', current_date);
    insert into t_result (step, ok, detail) values ('a reversal cannot overdraw an account', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('a reversal cannot overdraw an account', sqlerrm ilike '%below zero%', sqlerrm);
  end;

  v_res := create_internal_transfer(v_mer, v_bank, 10000, current_date, 'MTN-WD-0004', 'SLIP-0004',
                                    null, null, null, null, true, 'test:treasury:trf2');
  perform reverse_transaction((v_res ->> 'transaction_id')::uuid, 'Test: recorded against the wrong bank', current_date);

  insert into t_result (step, ok, detail)
  values ('a reversed transfer puts both accounts back',
          finance_account_balance_at(v_mer) = 30000 and finance_account_balance_at(v_bank) = 90000, null);
  insert into t_result (step, ok, detail)
  values ('the transfer document is marked reversed and linked to the reversal',
          exists (select 1 from internal_transfers x
                    join transactions rt on rt.id = x.reversal_transaction_id
                   where x.id = (v_res ->> 'id')::uuid and x.status = 'reversed'
                     and rt.status = 'reversal' and rt.source_account_id = v_bank
                     and rt.destination_account_id = v_mer), null);
  insert into t_result (step, ok, detail)
  values ('the original stays visible, marked reversed',
          (select status from transactions where id = (v_res ->> 'transaction_id')::uuid) = 'reversed', null);

  -- ---- Immutability ----------------------------------------------------------
  begin
    update account_ledger_entries set debit = debit + 1 where account_id = v_mer;
    insert into t_result (step, ok, detail) values ('account entries cannot be edited', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail) values ('account entries cannot be edited', true, sqlerrm);
  end;
  begin
    delete from transactions where id = v_txn.id;
    get diagnostics v_n = row_count;
    insert into t_result (step, ok, detail) values ('transactions cannot be deleted', v_n = 0, 'rows: ' || v_n);
  exception when others then
    insert into t_result (step, ok, detail) values ('transactions cannot be deleted', true, sqlerrm);
  end;
  begin
    perform update_financial_account(v_mer, 'TEST Merchant', 'MTN Mobile Money', 'TEST-MC-1', null,
                                     null, null, null, 999999, null, null, null, 'test');
    insert into t_result (step, ok, detail) values ('an opening balance is fixed once money has moved', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('an opening balance is fixed once money has moved', sqlerrm ilike '%cannot change%', sqlerrm);
  end;

  -- ---- A cashier's transfer waits for approval -------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_cashier, 'role', 'authenticated')::text, true);

  v_res := create_internal_transfer(v_mer, v_bank, 5000, current_date, 'MTN-WD-0005', 'SLIP-0005',
                                    null, null, 'Test Cashier', null, true, 'test:treasury:cashier');
  v_trf := (v_res ->> 'id')::uuid;
  insert into t_result (step, ok, detail)
  values ('a cashier''s transfer is submitted, and no money moves yet',
          v_res ->> 'status' = 'submitted' and finance_account_balance_at(v_mer) = 30000, v_res ->> 'status');

  begin
    perform decide_internal_transfer(v_trf, true, null);
    insert into t_result (step, ok, detail) values ('a cashier cannot approve', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail) values ('a cashier cannot approve', sqlerrm ilike '%permission%', sqlerrm);
  end;

  select id into v_pcat from payment_categories where name = 'Member refunds';
  v_res := create_payment('Treasury Member A', v_pcat, 2000, v_cash, current_date, v_a, null, null,
                          'Refund of an overpayment', null, true, 'test:treasury:pay1');
  insert into t_result (step, ok, detail)
  values ('a cashier''s payment is submitted with a PAY number',
          v_res ->> 'status' = 'submitted' and (v_res ->> 'payment_no') like 'PAY%', null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  perform decide_internal_transfer(v_trf, true, null);
  insert into t_result (step, ok, detail)
  values ('a manager approves it and the money moves',
          (select status = 'completed' and approved_by = v_admin from internal_transfers where id = v_trf)
          and finance_account_balance_at(v_mer) = 25000 and finance_account_balance_at(v_bank) = 95000, null);

  perform decide_payment((v_res ->> 'id')::uuid, true, null);
  insert into t_result (step, ok, detail)
  values ('an approved payment leaves the chosen account',
          finance_account_balance_at(v_cash) = 18000
          and exists (select 1 from payment_register where id = (v_res ->> 'id')::uuid and status = 'completed'),
          finance_account_balance_at(v_cash)::text);

  -- ---- Four eyes --------------------------------------------------------------
  perform update_settings(jsonb_build_object('treasury.four_eyes', true), 'treasury test');
  v_res := create_internal_transfer(v_mer, v_bank, 1000, current_date, 'MTN-WD-0006', 'SLIP-0006',
                                    null, null, null, null, true, 'test:treasury:4eyes');
  insert into t_result (step, ok, detail)
  values ('under four eyes a manager''s own transfer waits too', v_res ->> 'status' = 'submitted', null);
  begin
    perform decide_internal_transfer((v_res ->> 'id')::uuid, true, null);
    insert into t_result (step, ok, detail) values ('nobody approves their own entry under four eyes', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('nobody approves their own entry under four eyes', sqlerrm ilike '%different person%', sqlerrm);
  end;
  perform cancel_internal_transfer((v_res ->> 'id')::uuid, 'Test: cancelled');
  insert into t_result (step, ok, detail)
  values ('a waiting transfer can be cancelled, and no money moved',
          (select status from internal_transfers where id = (v_res ->> 'id')::uuid) = 'cancelled'
          and finance_account_balance_at(v_mer) = 25000, null);
  perform update_settings(jsonb_build_object('treasury.four_eyes', false), 'treasury test');

  -- ---- Reconciliation ------------------------------------------------------------
  begin
    perform record_reconciliation(v_cash, current_date, 17000, null, null, null);
    insert into t_result (step, ok, detail) values ('a variance must be explained', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail) values ('a variance must be explained', sqlerrm ilike '%variance%', sqlerrm);
  end;
  v_res := record_reconciliation(v_cash, current_date, 17000, 'UGX 1,000 short in the count', null, 'counted twice');
  insert into t_result (step, ok, detail)
  values ('a variance is recorded, and the system balance is not adjusted',
          (v_res ->> 'variance')::numeric = -1000 and v_res ->> 'outcome' = 'variance'
          and finance_account_balance_at(v_cash) = 18000, v_res::text);
  insert into t_result (step, ok, detail)
  values ('the dashboard flags the variance',
          exists (select 1 from jsonb_array_elements(treasury_summary() -> 'variances') v
                   where (v ->> 'id')::uuid = v_cash), null);
  v_res := record_reconciliation(v_bank, current_date, 95000, null, 'STMT-1', null);
  insert into t_result (step, ok, detail)
  values ('a matching balance reconciles cleanly', v_res ->> 'outcome' = 'reconciled', null);

  -- ---- The reports agree with the ledger ------------------------------------
  v_report := cash_bank_report(current_date, current_date);
  v_ok := true;
  for r in select * from jsonb_to_recordset(v_report -> 'accounts')
             as x(id uuid, opening numeric, money_in numeric, money_out numeric, closing numeric)
  loop
    if r.opening + r.money_in - r.money_out <> r.closing or r.closing <> finance_account_balance_at(r.id) then
      v_ok := false;
    end if;
  end loop;
  insert into t_result (step, ok, detail)
  values ('Cash & Bank report: opening + in - out = closing = ledger balance, for every account', v_ok, null);

  insert into t_result (step, ok, detail)
  values ('Cash & Bank report: merchant collections today are UGX 150,000',
          (select sum((m ->> 'money_in')::numeric) from jsonb_array_elements(v_report -> 'movements') m
            where (m ->> 'account_id')::uuid = v_mer and m ->> 'movement_class' = 'collection') = 150000, null);

  v_report := receipts_and_payments(current_date, current_date);
  insert into t_result (step, ok, detail)
  values ('Receipts & Payments: internal transfers are not receipts or payments',
          not exists (select 1 from jsonb_array_elements(v_report -> 'receipts') x
                       where x ->> 'category' = 'Internal transfer')
          and not exists (select 1 from jsonb_array_elements(v_report -> 'payments') x
                           where x ->> 'category' = 'Internal transfer'), null);

  insert into t_result (step, ok, detail)
  values ('the account statement runs by date and ends at the balance',
          (select running_balance from account_movements where account_id = v_mer
            order by entry_date desc, entry_id desc limit 1) = finance_account_balance_at(v_mer), null);

  -- ---- Paths written before this module land in the right account ----------
  v_res := record_savings_payment(v_a, 'monthly', 2000, current_date, 'cash', 'test:treasury:legacy');
  insert into t_result (step, ok, detail)
  values ('an existing cash collection lands in the default Cash at Hand',
          (select destination_account_id from transactions where id = (v_res ->> 'transaction_id')::uuid)
          = default_financial_account('cash'), null);

  -- ---- What a member can see -------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_muser, 'role', 'authenticated')::text, true);
  select count(*) into v_n from financial_accounts;
  insert into t_result (step, ok, detail) values ('a member cannot read the SACCO accounts', v_n = 0, v_n::text);
  select count(*) into v_n from account_ledger_entries;
  insert into t_result (step, ok, detail) values ('a member cannot read the account ledger', v_n = 0, v_n::text);
  begin
    perform treasury_summary();
    insert into t_result (step, ok, detail) values ('a member cannot open the finance dashboard', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail) values ('a member cannot open the finance dashboard', true, sqlerrm);
  end;
  begin
    perform create_internal_transfer(v_mer, v_bank, 100, current_date, 'X', 'Y', null, null, null, null, true, null);
    insert into t_result (step, ok, detail) values ('a member cannot move SACCO money', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail) values ('a member cannot move SACCO money', sqlerrm ilike '%permission%', sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
end;
$$;

select step, ok, detail from t_result order by n;

rollback;
