begin;

create temp table t_result (n serial, step text, ok boolean, detail text);
create temp table t_ctx (key text primary key, id uuid);

-- ===========================================================================
-- Dynamic receiving accounts (0046).
--
-- Proves the one thing the change is for: the accounts a person may receive
-- money into are the SACCO's own active `financial_accounts` rows, not a list
-- typed into the application, and the account chosen is the account the ledger
-- posts against.
--
-- Everything this suite creates is named with a `ZZTEST ` prefix, because the
-- live database already has whatever accounts the SACCO really runs and the
-- assertions must not depend on them. Where the suite says "no bank account
-- exists", it means no bank account of its own exists - and it also asserts the
-- general invariant that `collection_accounts()` is exactly the active rows of
-- `financial_accounts`, which is what makes the specific cases follow.
--
-- Everything is rolled back at the end.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A Loan Officer login. The role has `loans.repay` and neither
-- `savings.record` nor `finance.record`, which is precisely the case 0027's
-- blanket permission check locked out of the central collection path.
-- ---------------------------------------------------------------------------
reset role;

do $fixture$
declare
  v_officer uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values
    (v_officer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'accounts.officer@test.invalid', '', now(), jsonb_build_object('role', 'loan_officer'),
     jsonb_build_object('full_name', 'Test Loan Officer'), now(), now());
  update app_users set must_change_password = false where id = v_officer;
  insert into t_ctx values ('officer', v_officer);
end;
$fixture$;

set role authenticated;

do $$
declare
  v_admin    uuid := auth.uid();
  v_officer  uuid := (select id from t_ctx where key = 'officer');
  v_cash     uuid;
  v_airtel   uuid;
  v_airtel2  uuid;
  v_mtn      uuid;
  v_bank     uuid;
  v_a        uuid;
  v_b        uuid;
  v_prod     uuid;
  v_loan     uuid;
  v_res      jsonb;
  v_txn      transactions;
  v_hist     transactions;
  v_price    numeric;
  v_cat      uuid;
  v_n        integer;
  v_m        integer;
  v_t0       integer;
  v_r0       integer;
  v_i0       integer;
  v_e0       integer;
  v_bal      numeric;
begin
  perform update_settings(jsonb_build_object(
    'treasury.require_approval', false,
    'treasury.allow_negative_balances', false), 'receiving accounts test');

  -- =========================================================================
  -- 1. What the SACCO looks like today: cash, and one Airtel merchant code.
  --    No bank account. No MTN merchant code.
  -- =========================================================================
  v_cash   := (create_financial_account('cash', 'ZZTEST Cash at Hand') ->> 'id')::uuid;
  v_airtel := (create_financial_account('merchant', 'ZZTEST Airtel Collections', 'Airtel',
                                        'ZZ-AIRTEL-1', '0750000001') ->> 'id')::uuid;

  insert into t_result (step, ok, detail)
  values ('cash appears in the receiving-account list',
          exists (select 1 from collection_accounts() where id = v_cash), null);

  insert into t_result (step, ok, detail)
  values ('the configured Airtel merchant account appears, with its merchant code',
          exists (select 1 from collection_accounts()
                   where id = v_airtel and provider = 'Airtel' and merchant_code = 'ZZ-AIRTEL-1'),
          null);

  insert into t_result (step, ok, detail)
  values ('no bank account appears, because none is configured',
          not exists (select 1 from collection_accounts()
                       where account_type = 'bank' and name like 'ZZTEST %'), null);

  insert into t_result (step, ok, detail)
  values ('no MTN merchant account appears, because none is configured',
          not exists (select 1 from collection_accounts()
                       where account_type = 'merchant' and provider = 'MTN' and name like 'ZZTEST %'),
          null);

  -- The invariant the specific cases rest on: the list is the active accounts,
  -- nothing more and nothing less.
  insert into t_result (step, ok, detail)
  values ('the list is exactly the active financial accounts',
          (select count(*) from collection_accounts())
            = (select count(*) from financial_accounts where status = 'active')
          and not exists (select 1 from collection_accounts() c
                            join financial_accounts a on a.id = c.id
                           where a.status <> 'active'), null);

  -- =========================================================================
  -- 2. Configuring more accounts makes them available with no code change.
  -- =========================================================================
  -- Opened with a float, so the suite can disburse out of it later.
  v_bank := (create_financial_account('bank', 'ZZTEST Centenary Bank', null, null, null,
                                      'Centenary Bank', 'Kampala', '3100987654',
                                      500000) ->> 'id')::uuid;
  insert into t_result (step, ok, detail)
  values ('adding a bank account makes it appear automatically',
          exists (select 1 from collection_accounts()
                   where id = v_bank and bank_name = 'Centenary Bank'
                     and account_number = '3100987654'), null);

  v_mtn := (create_financial_account('merchant', 'ZZTEST MTN Collections', 'MTN',
                                     'ZZ-MTN-1', '0770000001') ->> 'id')::uuid;
  insert into t_result (step, ok, detail)
  values ('adding an MTN merchant account makes it appear automatically',
          exists (select 1 from collection_accounts() where id = v_mtn and provider = 'MTN'), null);

  v_airtel2 := (create_financial_account('merchant', 'ZZTEST Airtel Branch Two', 'Airtel',
                                         'ZZ-AIRTEL-2', '0750000002') ->> 'id')::uuid;
  insert into t_result (step, ok, detail)
  values ('a second Airtel merchant account appears individually, not merged into the first',
          (select count(*) from collection_accounts()
            where provider = 'Airtel' and name like 'ZZTEST %') = 2
          and exists (select 1 from collection_accounts()
                       where id = v_airtel2 and merchant_code = 'ZZ-AIRTEL-2'), null);

  -- The counter needs account names, not the books: the list carries no
  -- balance, and the function does not read one.
  insert into t_result (step, ok, detail)
  values ('the receiving-account list carries no balance',
          not exists (
            select 1 from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'collection_accounts'
               and (p.prosrc ilike '%balance%'
                    or array_to_string(p.proargnames, ',') ilike '%balance%')), null);

  -- =========================================================================
  -- 3. Members and the money they bring.
  -- =========================================================================
  v_a := (register_member(jsonb_build_object(
            'full_name', 'ZZTEST Receiving Member A', 'phone', '+256779200001',
            'share_category_id', (select id from share_categories where status = 'active' order by sort_order limit 1),
            'savings_category_id', (select id from savings_categories where status = 'active' and frequency = 'monthly' order by sort_order limit 1)))
          ->> 'member_id')::uuid;
  v_b := (register_member(jsonb_build_object(
            'full_name', 'ZZTEST Receiving Member B', 'phone', '+256779200002',
            'share_category_id', (select id from share_categories where status = 'active' order by sort_order limit 1),
            'savings_category_id', (select id from savings_categories where status = 'active' and frequency = 'monthly' order by sort_order limit 1)))
          ->> 'member_id')::uuid;
  perform waive_member_fee(mf.id, 'automated test fixture')
     from member_fees mf where mf.member_id in (v_a, v_b) and mf.status = 'unpaid';

  -- ---- Cash posts to cash -------------------------------------------------
  v_res := record_member_collection(v_a, 'savings', 40000, v_cash, current_date, null,
                                    null, null, null, 'monthly', null, null, 'test:recv:cash');
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('choosing cash posts the money into the cash account',
          v_txn.destination_account_id = v_cash and v_txn.method = 'cash'
          and v_txn.source_account_id is null, v_res ->> 'account_name');
  insert into t_result (step, ok, detail)
  values ('the cash account''s own entry is the amount received',
          (select sum(debit) - sum(credit) from account_ledger_entries
            where transaction_id = v_txn.id and account_id = v_cash) = 40000, null);

  -- ---- An Airtel merchant account posts to that exact account -------------
  v_res := record_member_collection(v_a, 'savings', 60000, v_airtel2, current_date, null,
                                    'ZZ-REF-AIRTEL-2', null, null, 'monthly', null, null,
                                    'test:recv:airtel2');
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('choosing the second Airtel account posts to that account, not the first or the default',
          v_txn.destination_account_id = v_airtel2
          and v_txn.destination_account_id <> v_airtel
          and v_txn.method = 'mobile_money', v_res ->> 'account_name');

  -- ---- A bank account posts to that exact account -------------------------
  v_res := record_member_collection(v_b, 'savings', 75000, v_bank, current_date, 'bank_transfer',
                                    'ZZ-SLIP-0001', null, null, 'monthly', null, null,
                                    'test:recv:bank');
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('choosing a bank account posts to that bank account',
          v_txn.destination_account_id = v_bank and v_txn.method = 'bank_transfer',
          v_res ->> 'account_name');

  -- =========================================================================
  -- 4. Every kind of money uses the same account source and the same function.
  -- =========================================================================
  v_price := share_unit_price();
  v_res := record_member_collection(v_a, 'shares', v_price * 3, v_mtn, current_date, null,
                                    'ZZ-REF-MTN-SHARES', null, null, null, null, null,
                                    'test:recv:shares', null, 3);
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('shares use the same account source as savings, and post to the chosen MTN account',
          v_txn.destination_account_id = v_mtn and v_txn.type = 'share_purchase'
          and (v_res ->> 'quantity')::integer = 3, v_res ->> 'account_name');

  begin
    perform record_member_collection(v_a, 'shares', v_price * 2, v_cash, current_date, null,
                                     null, null, null, null, null, null,
                                     'test:recv:shares:mismatch', null, 5);
    insert into t_result (step, ok, detail)
    values ('a stale share price is refused', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('a stale share price is refused', sqlerrm ilike '%share price changed%', sqlerrm);
  end;

  -- Membership and other member fees: the same function, the same accounts.
  select id into v_cat from income_categories where is_active and not is_system order by name limit 1;
  if v_cat is null then
    v_cat := (save_finance_category('income', null, 'ZZTEST Member Fee', null, true) ->> 'id')::uuid;
  end if;
  v_res := record_member_collection(v_a, 'fee', 5000, v_cash, current_date, null,
                                    null, 'ZZTEST fee', null, null, null, v_cat,
                                    'test:recv:fee');
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('a member fee uses the same account source and posts to the chosen account',
          v_txn.destination_account_id = v_cash and v_txn.type = 'income', v_res ->> 'account_name');

  -- Deposits.
  v_res := record_member_collection(v_b, 'deposit', 20000, v_airtel, current_date, null,
                                    'ZZ-REF-DEP-1', null, null, null, null, null,
                                    'test:recv:deposit');
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('a deposit uses the same account source and posts to the chosen account',
          v_txn.destination_account_id = v_airtel and v_txn.type = 'deposit', null);

  -- ---- A loan, so repayments can be tested the same way -------------------
  perform update_settings(jsonb_build_object('notifications.notify_on_loan_decision', false),
                          'receiving accounts test');
  v_prod := (save_loan_product(null, jsonb_build_object(
               'name', 'ZZTEST Receiving Loan', 'code', 'ZZRECV', 'interest_rate', 12,
               'interest_method', 'flat', 'min_amount', 100000, 'max_amount', 1000000,
               'min_period_months', 1, 'max_period_months', 12, 'repayment_frequency', 'monthly',
               'processing_fee_pct', 1, 'insurance_fee_pct', 0, 'application_fee', 0,
               'late_penalty_pct', 0, 'penalty_basis', 'overdue', 'grace_period_days', 0,
               'min_savings_balance', 0, 'min_savings_multiple', 0, 'min_membership_months', 0,
               'required_shares', 0, 'requires_guarantors', false, 'min_guarantors', 0,
               'requires_collateral', false, 'is_active', true, 'sort_order', 998),
               'automated test fixture') ->> 'id')::uuid;
  v_loan := (apply_for_loan(v_a, v_prod, 200000, 2, 'ZZTEST receiving accounts loan', null,
                            '[]'::jsonb, 'test:recv:loan') ->> 'loan_id')::uuid;
  perform set_loan_status(v_loan, 'approved', 'automated test');

  -- A disbursement names the account the money leaves, and it is that account
  -- that is debited.
  v_bal := finance_account_balance_at(v_bank, null);
  v_res := record_member_collection(v_a, 'loan_disbursement', 200000, v_bank, current_date,
                                    'bank_transfer', 'ZZ-SLIP-DISB-1', null, null, null, v_loan,
                                    null, 'test:recv:disburse');
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('a disbursement leaves the account that was chosen',
          v_txn.source_account_id = v_bank and v_txn.destination_account_id is null
          and v_txn.type = 'loan_disbursement', v_res ->> 'account_name');
  insert into t_result (step, ok, detail)
  values ('the chosen account is the one that falls by the principal less the withheld fee',
          v_bal - finance_account_balance_at(v_bank, null) = 198000,
          (v_bal - finance_account_balance_at(v_bank, null))::text);

  -- =========================================================================
  -- 5. One function, each branch gated by its own permission.
  --
  -- A Loan Officer has `loans.repay` and nothing else that records money. Under
  -- 0027's single blanket check they could not use this path at all.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_officer, 'role', 'authenticated')::text, true);

  insert into t_result (step, ok, detail)
  values ('a Loan Officer can read the receiving accounts',
          (select count(*) from collection_accounts()) > 0, null);

  v_res := record_member_collection(v_a, 'loan_repayment', 30000, v_airtel, current_date, null,
                                    'ZZ-REF-REPAY-1', null, null, null, v_loan, null,
                                    'test:recv:repay');
  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;
  insert into t_result (step, ok, detail)
  values ('loan repayments use the same account source and post to the chosen account',
          v_txn.destination_account_id = v_airtel and v_txn.type = 'loan_repayment',
          v_res ->> 'account_name');

  begin
    perform record_member_collection(v_a, 'savings', 1000, v_cash, current_date, null,
                                     null, null, null, 'monthly', null, null, 'test:recv:noperm');
    insert into t_result (step, ok, detail)
    values ('a Loan Officer still cannot record savings through the same function', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('a Loan Officer still cannot record savings through the same function',
            sqlerrm ilike '%permission%', sqlerrm);
  end;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 6. Nothing is posted twice.
  -- =========================================================================
  select count(*) into v_t0 from transactions;
  select count(*) into v_r0 from receipts;
  select count(*) into v_i0 from income_entries;
  select count(*) into v_e0 from account_ledger_entries;

  perform record_member_collection(v_a, 'fee', 5000, v_cash, current_date, null,
                                   null, 'ZZTEST fee', null, null, null, v_cat,
                                   'test:recv:fee');

  insert into t_result (step, ok, detail)
  values ('a replayed submission creates no second transaction, receipt, income entry or ledger entry',
          (select count(*) from transactions) = v_t0
          and (select count(*) from receipts) = v_r0
          and (select count(*) from income_entries) = v_i0
          and (select count(*) from account_ledger_entries) = v_e0, null);

  insert into t_result (step, ok, detail)
  values ('each collection wrote exactly one ledger row and one receipt',
          (select count(*) from transactions
            where idempotency_key = 'test:recv:cash') = 1
          and (select count(*) from receipts r
                 join transactions t on t.id = r.transaction_id
                where t.idempotency_key = 'test:recv:cash') = 1, null);

  insert into t_result (step, ok, detail)
  values ('a receipt into an account posts one entry against that account and no other',
          (select count(*) from account_ledger_entries e
             join transactions t on t.id = e.transaction_id
            where t.idempotency_key = 'test:recv:bank') = 1
          and (select account_id from account_ledger_entries e
                 join transactions t on t.id = e.transaction_id
                where t.idempotency_key = 'test:recv:bank') = v_bank, null);

  -- =========================================================================
  -- 7. Deactivating an account: gone from new receipts, untouched in history.
  -- =========================================================================
  select * into v_hist from transactions where idempotency_key = 'test:recv:airtel2';
  select count(*) into v_n from account_ledger_entries where account_id = v_airtel2;

  perform set_financial_account_status(v_airtel2, 'inactive', 'automated test');

  insert into t_result (step, ok, detail)
  values ('a deactivated account disappears from the receiving-account list',
          not exists (select 1 from collection_accounts() where id = v_airtel2), null);
  insert into t_result (step, ok, detail)
  values ('the accounts that are still active are unaffected',
          exists (select 1 from collection_accounts() where id = v_airtel)
          and exists (select 1 from collection_accounts() where id = v_mtn)
          and exists (select 1 from collection_accounts() where id = v_bank)
          and exists (select 1 from collection_accounts() where id = v_cash), null);

  -- A new receipt into it is refused, by name, rather than silently redirected
  -- to another account.
  begin
    perform record_member_collection(v_b, 'savings', 1000, v_airtel2, current_date, null,
                                     'ZZ-REF-AFTER-OFF', null, null, 'monthly', null, null,
                                     'test:recv:deactivated');
    insert into t_result (step, ok, detail)
    values ('a new receipt into a deactivated account is refused', false, 'accepted');
  exception when others then
    insert into t_result (step, ok, detail)
    values ('a new receipt into a deactivated account is refused',
            sqlerrm ilike '%cannot be used%', sqlerrm);
  end;

  -- The history is the point of the whole exercise: it must read back exactly
  -- as it was posted, naming the account that really took the money.
  select * into v_txn from transactions where id = v_hist.id;
  insert into t_result (step, ok, detail)
  values ('a historical transaction against a deactivated account is still readable, unchanged',
          v_txn.id = v_hist.id
          and v_txn.destination_account_id = v_airtel2
          and v_txn.method = v_hist.method
          and v_txn.amount = v_hist.amount
          and v_txn.external_ref = v_hist.external_ref
          and v_txn.status = v_hist.status
          and v_txn.created_at = v_hist.created_at
          and v_txn.reference = v_hist.reference, v_txn.reference);
  insert into t_result (step, ok, detail)
  values ('its account entries are still there and still against that account',
          (select count(*) from account_ledger_entries where account_id = v_airtel2) = v_n
          and v_n > 0, v_n::text);
  insert into t_result (step, ok, detail)
  values ('the deactivated account still names itself on the historical receipt',
          (select a.name from financial_accounts a where a.id = v_txn.destination_account_id)
            = 'ZZTEST Airtel Branch Two', null);

  -- Nothing was rewritten anywhere: no posted transaction in the database has
  -- lost the account it was posted against.
  select count(*) into v_m from transactions
   where status = 'posted'
     and type in ('share_purchase', 'weekly_savings', 'monthly_savings', 'loan_repayment',
                  'deposit', 'income', 'fee', 'penalty',
                  'loan_disbursement', 'withdrawal', 'expense', 'payment')
     and source_account_id is null and destination_account_id is null;
  insert into t_result (step, ok, detail)
  values ('no posted money movement anywhere has been left without its account',
          v_m = 0, v_m::text);
end;
$$;

select step, ok, detail from t_result order by n;

rollback;
