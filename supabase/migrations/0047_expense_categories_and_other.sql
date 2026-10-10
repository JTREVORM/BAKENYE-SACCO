-- Expense categories and the per-request type for Other. Existing records stay
-- untouched: a missing custom type remains valid for historical expenses.
insert into expense_categories (name, is_system) values
  ('Stationery', false),
  ('Printing & Photocopying', false),
  ('Registration Fees', false),
  ('Permits & Licences', false)
on conflict (name) do nothing;

alter table expense_entries add column custom_expense text;
-- Same whitespace characters as JavaScript String.trim().
alter table expense_entries add constraint expense_custom_expense_valid check (
  custom_expense is null or (
    length(custom_expense) between 1 and 160
    and custom_expense = btrim(custom_expense, E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  )
);
comment on column expense_entries.custom_expense is
  'The specified type for an Other expense; never a new category. Null on historical expenses.';

-- Replace the old signature rather than leaving ambiguous defaulted overloads.
-- Existing non-Other callers can still omit the new final argument.
drop function record_expense(uuid, numeric, text, date, payment_method, text, text, uuid, text, text, text);

create or replace function record_expense(
  p_category_id        uuid,
  p_amount             numeric,
  p_description        text,
  p_spent_on           date default current_date,
  p_method             payment_method default null,
  p_attachment_path    text default null,
  p_idempotency_key    text default null,
  p_payment_account_id uuid default null,
  p_payee              text default null,
  p_reference          text default null,
  p_notes              text default null,
  p_custom_expense     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row    expense_entries;
  v_acct   financial_accounts;
  v_method payment_method;
  v_cat    expense_categories;
  v_custom text;
  v_acct_id uuid := p_payment_account_id;
begin
  perform assert_capability(can_record_finance(), 'record expenses');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Expense amount must be greater than zero.' using errcode = 'check_violation';
  end if;
  if coalesce(p_spent_on, current_date) > current_date then
    raise exception 'An expense cannot be dated in the future.' using errcode = 'check_violation';
  end if;

  select * into v_cat from expense_categories where id = p_category_id;
  if not found or not v_cat.is_active then
    raise exception 'Choose an expense category.' using errcode = 'check_violation';
  end if;

  -- A double tap on "Submit" files one request, not two.
  if p_idempotency_key is not null then
    select * into v_row from expense_entries where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('expense_id', v_row.id, 'approval', v_row.approval,
                                'payment_no', v_row.payment_no, 'duplicate', true);
    end if;
  end if;

  if lower(btrim(v_cat.name)) = 'other' then
    v_custom := nullif(btrim(p_custom_expense, E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '');
    if v_custom is null then
      raise exception 'Specify expense when choosing Other.'
        using errcode = 'check_violation', hint = 'custom_expense';
    end if;
    if length(v_custom) > 160 then
      raise exception 'Keep Specify expense under 160 characters.'
        using errcode = 'check_violation', hint = 'custom_expense';
    end if;
  end if;
  -- Other categories discard stale/forged custom values. No category is created.

  if v_acct_id is null then
    v_acct_id := default_financial_account(
      (finance_account_types_for_method(coalesce(p_method, 'cash')))[1]);
  end if;
  if v_acct_id is null then
    raise exception 'Choose the account this expense will be paid from.' using errcode = 'check_violation';
  end if;

  select * into v_acct from financial_accounts where id = v_acct_id;
  v_method := coalesce(p_method, method_for_account_type(v_acct.account_type));
  if p_method is not null and not (v_acct.account_type = any (finance_account_types_for_method(p_method))) then
    v_method := method_for_account_type(v_acct.account_type, p_method);
  end if;
  v_acct := assert_account_usable(v_acct_id, v_method);

  insert into expense_entries (category_id, amount, description, spent_on, method,
                               attachment_path, approval, recorded_by, payment_account_id,
                               payment_no, payee, reference, notes, idempotency_key, custom_expense)
  values (p_category_id, p_amount, p_description, coalesce(p_spent_on, current_date), v_method,
          nullif(btrim(coalesce(p_attachment_path, '')), ''), 'pending', auth.uid(), v_acct_id,
          next_document_no('EXP'), nullif(btrim(coalesce(p_payee, '')), ''),
          nullif(btrim(coalesce(p_reference, '')), ''),
          nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key, v_custom)
  returning * into v_row;

  perform write_audit('expense.submitted', 'Financials', v_row.id::text,
    format('Expense %s of %s (%s) submitted for approval, to be paid from %s',
           v_row.payment_no, ugx(p_amount),
           v_cat.name || coalesce(' — ' || v_custom, ''), v_acct.name),
    null, to_jsonb(v_row), p_description);

  return jsonb_build_object('expense_id', v_row.id, 'approval', v_row.approval,
                            'payment_no', v_row.payment_no, 'duplicate', false);
end;
$$;

-- Keep category as the base category for filters and grouped reports.
create or replace view payment_register
with (security_invoker = true) as
select
  'payment'::text        as source,
  p.id,
  p.payment_no,
  p.payee,
  p.member_id,
  p.category_id,
  pc.name                as category,
  false                  as is_expense,
  p.amount,
  p.payment_date,
  p.payment_account_id,
  a.name                 as payment_account_name,
  a.account_type         as payment_account_type,
  p.method,
  p.reference,
  p.description,
  p.notes,
  p.status::text         as status,
  p.requires_approval,
  p.created_by,
  cu.full_name           as created_by_name,
  p.approved_by,
  au.full_name           as approved_by_name,
  p.rejection_reason,
  p.transaction_id,
  t.reference            as transaction_reference,
  p.created_at,
  (select count(*) from finance_documents d
    where d.owner_type = 'payment' and d.owner_id = p.id)::integer as document_count,
  null::text as custom_expense
from payments p
join payment_categories pc     on pc.id = p.category_id
join financial_accounts a      on a.id  = p.payment_account_id
left join app_users cu         on cu.id = p.created_by
left join app_users au         on au.id = p.approved_by
left join transactions t       on t.id  = p.transaction_id
union all
select
  'expense'::text,
  x.id,
  x.payment_no,
  coalesce(x.payee, ec.name),
  null::uuid,
  x.category_id,
  ec.name,
  true,
  x.amount,
  x.spent_on,
  x.payment_account_id,
  a.name,
  a.account_type,
  x.method,
  x.reference,
  x.description,
  x.notes,
  case
    when x.approval = 'pending'  then 'submitted'
    when x.approval = 'rejected' then 'rejected'
    when t.status   = 'reversed' then 'reversed'
    else 'completed'
  end,
  true,
  x.recorded_by,
  cu.full_name,
  x.approved_by,
  au.full_name,
  x.rejection_reason,
  x.transaction_id,
  t.reference,
  x.created_at,
  (select count(*) from finance_documents d
    where d.owner_type = 'expense' and d.owner_id = x.id)::integer,
  x.custom_expense
from expense_entries x
join expense_categories ec     on ec.id = x.category_id
left join financial_accounts a on a.id  = x.payment_account_id
left join app_users cu         on cu.id = x.recorded_by
left join app_users au         on au.id = x.approved_by
left join transactions t       on t.id  = x.transaction_id;

create or replace view account_movements
with (security_invoker = true) as
select
  e.id                  as entry_id,
  e.transaction_id,
  e.account_id,
  a.code                as account_code,
  a.name                as account_name,
  a.account_type,
  e.entry_date,
  e.debit               as money_in,
  e.credit              as money_out,
  e.balance_after,
  e.created_at,
  t.reference,
  t.type                as txn_type,
  t.status              as txn_status,
  t.method,
  t.description,
  t.external_ref,
  t.member_id,
  m.member_no,
  m.full_name           as member_name,
  t.recorded_by,
  u.full_name           as recorded_by_name,
  t.reverses_id,
  t.reversed_by_id,
  case when e.debit > 0 then sa.account_type else da.account_type end as counter_account_type,
  case when e.debit > 0 then sa.name         else da.name         end as counter_account_name,
  case
    when t.status = 'reversal' then 'reversal'
    when t.type = 'transfer' and e.debit > 0 then 'transfer_in'
    when t.type = 'transfer' then 'transfer_out'
    when t.type in ('weekly_savings', 'monthly_savings', 'deposit', 'share_purchase', 'loan_repayment')
      then 'collection'
    when t.type in ('income', 'fee', 'penalty')
         and t.member_id is not null and t.method <> 'internal' then 'collection'
    when t.type in ('income', 'fee', 'penalty') then 'other_receipt'
    when t.type = 'expense' then 'expense'
    else 'payment'
  end                   as movement_class,
  case t.type
    when 'weekly_savings'    then 'Member savings'
    when 'monthly_savings'   then 'Member savings'
    when 'deposit'           then 'Member deposits'
    when 'share_purchase'    then 'Share purchases'
    when 'loan_repayment'    then 'Loan repayments'
    when 'income'            then coalesce(ic.name, 'Other income')
    when 'fee'               then coalesce(fl.label, 'Loan fees')
    when 'penalty'           then 'Penalties'
    when 'expense'           then coalesce(ec.name, 'Expenses')
    when 'payment'           then coalesce(pc.name, 'Payments')
    when 'withdrawal'        then 'Member withdrawals'
    when 'loan_disbursement' then 'Loan disbursements'
    else 'Internal transfer'
  end                   as category_label,
  (a.opening_balance
   + sum(e.debit - e.credit) over (partition by e.account_id order by e.entry_date, e.id))::numeric(16,2)
                        as running_balance,
  ec.custom_expense
from account_ledger_entries e
join financial_accounts a        on a.id  = e.account_id
join transactions t              on t.id  = e.transaction_id
left join financial_accounts sa  on sa.id = t.source_account_id
left join financial_accounts da  on da.id = t.destination_account_id
left join members m              on m.id  = t.member_id
left join app_users u            on u.id  = t.recorded_by
left join lateral (
  select c.name from income_entries ie
    join income_categories c on c.id = ie.category_id
   where ie.transaction_id = coalesce(t.reverses_id, t.id)
   limit 1
) ic on t.type = 'income'
left join lateral (
  select c.name, xe.custom_expense from expense_entries xe
    join expense_categories c on c.id = xe.category_id
   where xe.transaction_id = coalesce(t.reverses_id, t.id)
   limit 1
) ec on t.type = 'expense'
left join lateral (
  select c.name from payments p
    join payment_categories c on c.id = p.category_id
   where p.transaction_id = coalesce(t.reverses_id, t.id)
   limit 1
) pc on t.type = 'payment'
left join lateral (
  select case when count(*) = 1 then max(l.description) else 'Member fees' end as label
    from fee_payment_lines l
   where l.transaction_id = coalesce(t.reverses_id, t.id)
  having count(*) > 0
) fl on t.type = 'fee';

create or replace view transaction_feed
with (security_invoker = true) as
select
  t.id,
  t.reference,
  t.member_id,
  m.member_no,
  m.full_name       as member_name,
  m.photo_url       as member_photo,
  t.type,
  t.status,
  t.amount,
  t.method,
  t.occurred_on,
  t.description,
  t.loan_id,
  t.reverses_id,
  t.reversed_by_id,
  t.reversal_reason,
  t.created_at,
  t.recorded_by,
  u.full_name       as recorded_by_name,
  -- Direction from the member's point of view: money in (+) or money out (-).
  case when t.type in ('weekly_savings', 'monthly_savings', 'deposit',
                       'share_purchase', 'loan_repayment', 'fee', 'penalty', 'expense')
       then 'debit' else 'credit' end as direction,
  (select c.name || coalesce(' — ' || e.custom_expense, '')
     from expense_entries e join expense_categories c on c.id = e.category_id
    where e.transaction_id = coalesce(t.reverses_id, t.id) and t.type = 'expense'
    limit 1) as expense_category_label
from transactions t
left join members   m on m.id = t.member_id
left join app_users u on u.id = t.recorded_by;

-- The existing receipt RPC serializes transaction_feed, including the new label.
-- Approval, account posting, reversals and category-based report totals are unchanged.
revoke all on function record_expense(uuid, numeric, text, date, payment_method, text, text, uuid, text, text, text, text) from public, anon;
grant execute on function record_expense(uuid, numeric, text, date, payment_method, text, text, uuid, text, text, text, text) to authenticated;
notify pgrst, 'reload schema';
