begin;
create temp table t_result (n serial, step text, ok boolean, detail text);

-- Each suite is a real authenticated Super Admin session. All test expenses,
-- settings, approvals, ledger entries and counter changes roll back together.
do $$
declare
  v_other uuid := (select id from expense_categories where name = 'Other');
  v_stationery uuid := (select id from expense_categories where name = 'Stationery');
  v_account uuid;
  v_id uuid;
  v_legacy uuid;
  v_transaction uuid;
  v_result jsonb;
  v_before numeric;
  v_other_before numeric;
  v_count integer := (select count(*) from expense_categories);
  v_expense_count integer;
  v_row record;
  v_invalid text;
  v_label text;
begin
  insert into t_result(step, ok) values ('all original expense categories remain',
    (select count(*) = 9 from expense_categories where name in
      ('Salaries','Rent','Electricity','Internet','Transport','Office supplies','Bank charges','Equipment','Other')));
  insert into t_result(step, ok) values ('four additional expense categories are active and unique',
    (select count(*) = 4 and bool_and(is_active) from expense_categories where name in
      ('Stationery','Printing & Photocopying','Registration Fees','Permits & Licences')));
  perform update_settings(jsonb_build_object('treasury.four_eyes', false), 'Expense category test');
  v_account := (create_financial_account('cash', 'Expense category test wallet',
    p_opening_balance => 10000, p_opening_date => current_date) ->> 'id')::uuid;

  -- Existing Other records did not have a custom type. Recreate one as the
  -- migration found it; approving it must not require editing the old record.
  reset role;
  insert into expense_entries(category_id, amount, description, payment_account_id, recorded_by)
    values(v_other, 100, 'Historical Other expense', v_account, auth.uid()) returning id into v_legacy;
  set role authenticated;
  perform approve_expense(v_legacy, true);
  insert into t_result(step, ok) values ('historical Other without a custom type can still be approved',
    (select approval = 'approved' and custom_expense is null from expense_entries where id = v_legacy));

  for v_row in select id, name from expense_categories where name in
    ('Stationery','Printing & Photocopying','Registration Fees','Permits & Licences') loop
    v_before := finance_account_balance_at(v_account);
    v_result := record_expense(v_row.id, 100, 'New category test',
      p_payment_account_id => v_account, p_idempotency_key => 'test:expense:category:' || v_row.id);
    v_id := (v_result ->> 'expense_id')::uuid;
    insert into t_result(step, ok) values (v_row.name || ': request waits for approval without moving money',
      (select approval = 'pending' and custom_expense is null and transaction_id is null
         from expense_entries where id = v_id) and finance_account_balance_at(v_account) = v_before);
    perform approve_expense(v_id, true);
    select transaction_id into v_transaction from expense_entries where id = v_id;
    insert into t_result(step, ok) values (v_row.name || ': approval posts one expense to the same account',
      finance_account_balance_at(v_account) = v_before - 100
      and (select count(*) = 1 from account_ledger_entries where transaction_id = v_transaction and account_id = v_account)
      and (select type = 'expense' and amount = 100 and status = 'posted' from transactions where id = v_transaction));
    insert into t_result(step, ok) values (v_row.name || ': category reaches approvals and receipt details',
      (select category = v_row.name from payment_register where id = v_id and source = 'expense')
      and receipt_for_transaction(v_transaction) -> 'transaction' ->> 'expense_category_label' = v_row.name);
    insert into t_result(step, ok) values (v_row.name || ': category appears in grouped reports',
      exists (select 1 from jsonb_array_elements(cashbook(current_date,current_date)->'expenses') x where x->>'category' = v_row.name)
      and exists (select 1 from jsonb_array_elements(receipts_and_payments(current_date,current_date)->'payments') x where x->>'category' = v_row.name));
  end loop;

  v_expense_count := (select count(*) from expense_entries);
  foreach v_invalid in array array[null::text, '', '   ', E'\t\n\r ', U&'\00A0\2003\FEFF', repeat('x',161)] loop
    begin
      perform record_expense(v_other, 100, 'Invalid custom test',
        p_payment_account_id => v_account, p_custom_expense => v_invalid);
      insert into t_result(step, ok) values ('blank/missing/overlong Other type is rejected', false);
    exception when check_violation then
      insert into t_result(step, ok, detail) values ('blank/missing/overlong Other type is rejected',
        sqlerrm like 'Specify expense%' or sqlerrm like 'Keep Specify expense%', sqlerrm);
    end;
  end loop;
  insert into t_result(step, ok) values ('invalid requests leave no expense behind',
    (select count(*) from expense_entries) = v_expense_count);

  v_other_before := coalesce((select (x->>'total')::numeric
    from jsonb_array_elements(cashbook(current_date,current_date)->'expenses') x where x->>'category'='Other'),0);
  foreach v_label in array array['Office cleaning','Meeting refreshments'] loop
    v_before := finance_account_balance_at(v_account);
    v_result := record_expense(v_other, 100, 'Supplier invoice for this expense',
      p_payment_account_id => v_account, p_idempotency_key => 'test:expense:other:' || v_label,
      p_custom_expense => E'\t ' || v_label || U&'\00A0');
    v_id := (v_result ->> 'expense_id')::uuid;
    insert into t_result(step, ok) values ('Other type is trimmed and saved separately from the description',
      (select custom_expense = v_label and description = 'Supplier invoice for this expense' and category_id = v_other
         from expense_entries where id = v_id));
    insert into t_result(step, ok) values ('pending Other is visible to approvals under the base Other category',
      (select category = 'Other' and custom_expense = v_label and status = 'submitted'
         from payment_register where source='expense' and id = v_id)
      and finance_account_balance_at(v_account) = v_before);
    v_result := record_expense(v_other, 100, 'Supplier invoice for this expense',
      p_payment_account_id => v_account, p_idempotency_key => 'test:expense:other:' || v_label,
      p_custom_expense => v_label);
    insert into t_result(step, ok) values ('retry returns the same Other expense without duplicating it',
      (v_result->>'expense_id')::uuid = v_id and (v_result->>'duplicate')::boolean);
    perform approve_expense(v_id,true);
    select transaction_id into v_transaction from expense_entries where id = v_id;
    insert into t_result(step, ok) values ('Other receipt and transaction details include the custom label',
      receipt_for_transaction(v_transaction)->'transaction'->>'expense_category_label' = 'Other — ' || v_label
      and (select expense_category_label = 'Other — ' || v_label from transaction_feed where id = v_transaction));
    insert into t_result(step, ok) values ('ledger retains base Other and the saved custom type',
      (select category_label = 'Other' and custom_expense = v_label and money_out = 100
         from account_movements where transaction_id = v_transaction)
      and finance_account_balance_at(v_account) = v_before - 100);
    begin
      perform approve_expense(v_id,true);
      insert into t_result(step, ok) values ('an expense cannot be approved twice', false);
    exception when check_violation then
      insert into t_result(step, ok) values ('an expense cannot be approved twice',sqlerrm like '%already been%');
    end;
  end loop;
  insert into t_result(step, ok) values ('cashbook groups custom types together as Other',
    exists(select 1 from jsonb_array_elements(cashbook(current_date,current_date)->'expenses') x
      where x->>'category'='Other' and (x->>'total')::numeric = v_other_before + 200)
    and not exists(select 1 from jsonb_array_elements(cashbook(current_date,current_date)->'expenses') x
      where x->>'category' like 'Other — %'));
  insert into t_result(step, ok) values ('receipts/payments report also groups by the main Other category',
    not exists(select 1 from jsonb_array_elements(receipts_and_payments(current_date,current_date)->'payments') x
      where x->>'category' like 'Other — %')
    and exists(select 1 from jsonb_array_elements(receipts_and_payments(current_date,current_date)->'payments') x
      where x->>'category'='Other'));

  v_result := record_expense(v_stationery,100,'Ordinary expense',
    p_payment_account_id => v_account, p_custom_expense => 'Stale custom value');
  insert into t_result(step, ok) values ('a non-Other request discards a stale custom type',
    (select custom_expense is null from expense_entries where id=(v_result->>'expense_id')::uuid));

  v_before := finance_account_balance_at(v_account);
  v_result := record_expense(v_other,100,'Rejected expense',p_payment_account_id => v_account,p_custom_expense=>'Repair charges');
  v_id := (v_result->>'expense_id')::uuid;
  perform approve_expense(v_id,false,'Not authorised');
  insert into t_result(step, ok) values ('rejection keeps the custom type and posts no money',
    (select custom_expense='Repair charges' and approval='rejected' and transaction_id is null from expense_entries where id=v_id)
    and finance_account_balance_at(v_account)=v_before);

  v_result := record_expense(v_other,100,'Maximum-length custom type',
    p_payment_account_id=>v_account,p_custom_expense=>repeat('x',160));
  insert into t_result(step, ok) values ('a 160-character custom type is accepted',
    (select length(custom_expense)=160 from expense_entries where id=(v_result->>'expense_id')::uuid));
  insert into t_result(step, ok) values ('custom expense types never add permanent categories',
    (select count(*) from expense_categories)=v_count);

  -- The new field must not change four-eyes approval controls.
  perform update_settings(jsonb_build_object('treasury.four_eyes',true),'Expense category test');
  begin
    perform approve_expense((v_result->>'expense_id')::uuid,true);
    insert into t_result(step, ok) values ('four-eyes still prevents self approval of Other',false);
  exception when insufficient_privilege then
    insert into t_result(step, ok) values ('four-eyes still prevents self approval of Other',sqlerrm like '%different person%');
  end;
end;
$$;

select step, ok, detail from t_result order by n;
rollback;
