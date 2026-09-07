-- ===========================================================================
-- BUD-SACCO - 0011 - Capabilities, policies and RLS for the group tables
--
-- Roles are compared in exactly one place now: the capability predicates. Every
-- policy and every function below asks "can this caller do X", never "is this
-- caller one of these five roles". Adding the next role is one edit.
--
-- The rule the whole file exists to preserve: a member can read their own rows
-- and nothing else, and nobody at all can write to a financial table directly.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Capability predicates
-- ---------------------------------------------------------------------------

/** Anyone who works for the SACCO and may see operational data. */
create or replace function can_view_operations()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'loan_officer', 'cashier',
                  'accountant', 'group_officer', 'viewer');
$$;

/** Who may put a savings payment on the ledger. */
create or replace function can_record_savings()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'cashier', 'group_officer');
$$;

/** Who may create groups, move members between them and waive schedules. */
create or replace function can_manage_groups()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager');
$$;

/** The SACCO books - income, expenses, cashbook. Members never qualify. */
create or replace function can_view_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'cashier', 'accountant');
$$;

create or replace function can_record_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'cashier', 'accountant');
$$;

/** Oversight: the audit log and the user register. */
create or replace function can_view_audit()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'accountant');
$$;

grant execute on function can_view_finance()   to authenticated;
grant execute on function can_record_finance() to authenticated;
grant execute on function can_view_audit()     to authenticated;

-- ---------------------------------------------------------------------------
-- Existing policies, restated in terms of capabilities.
-- ---------------------------------------------------------------------------
drop policy if exists app_users_staff_read       on app_users;
create policy app_users_staff_read on app_users
  for select using (can_view_operations());

drop policy if exists members_staff_read         on members;
create policy members_staff_read on members
  for select using (can_view_operations());

drop policy if exists transactions_staff_read    on transactions;
create policy transactions_staff_read on transactions
  for select using (can_view_operations());

drop policy if exists share_lots_staff_read      on share_lots;
create policy share_lots_staff_read on share_lots
  for select using (can_view_operations());

drop policy if exists savings_periods_staff_read on savings_periods;
create policy savings_periods_staff_read on savings_periods
  for select using (can_view_operations());

drop policy if exists savings_payments_staff_read on savings_payments;
create policy savings_payments_staff_read on savings_payments
  for select using (can_view_operations());

-- Savings plans: everyone operational reads, only savings recorders write.
drop policy if exists savings_plans_staff        on savings_plans;
create policy savings_plans_staff_read on savings_plans
  for select using (can_view_operations());
create policy savings_plans_staff_write on savings_plans
  for all using (can_record_savings()) with check (can_record_savings());

drop policy if exists loans_staff_read           on loans;
create policy loans_staff_read on loans
  for select using (can_view_operations());

drop policy if exists loan_schedule_staff_read   on loan_schedule;
create policy loan_schedule_staff_read on loan_schedule
  for select using (can_view_operations());

drop policy if exists loan_repayments_staff_read on loan_repayments;
create policy loan_repayments_staff_read on loan_repayments
  for select using (can_view_operations());

drop policy if exists income_categories_read     on income_categories;
create policy income_categories_read on income_categories
  for select using (can_view_finance());

drop policy if exists expense_categories_read    on expense_categories;
create policy expense_categories_read on expense_categories
  for select using (can_view_finance());

drop policy if exists income_entries_read        on income_entries;
create policy income_entries_read on income_entries
  for select using (can_view_finance());

drop policy if exists expense_entries_read       on expense_entries;
create policy expense_entries_read on expense_entries
  for select using (can_view_finance());

drop policy if exists audit_logs_read            on audit_logs;
create policy audit_logs_read on audit_logs
  for select using (can_view_audit());

-- ---------------------------------------------------------------------------
-- RLS for the group tables.
--
-- Members see their own group and its cycles - the meeting day and the target
-- are theirs to know - and nothing about any other group.
-- ---------------------------------------------------------------------------
alter table sacco_groups    enable row level security;
alter table savings_cycles  enable row level security;
alter table payment_intents enable row level security;

/** SECURITY DEFINER so a policy on members never re-enters members. */
create or replace function my_group_id()
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from members where user_id = auth.uid();
$$;

drop policy if exists sacco_groups_staff_read on sacco_groups;
create policy sacco_groups_staff_read on sacco_groups
  for select using (can_view_operations());

drop policy if exists sacco_groups_member_read on sacco_groups;
create policy sacco_groups_member_read on sacco_groups
  for select using (id = my_group_id());

-- No INSERT/UPDATE/DELETE policy: groups change only through create_group(),
-- update_group() and set_group_status(), which audit every change.

drop policy if exists savings_cycles_staff_read on savings_cycles;
create policy savings_cycles_staff_read on savings_cycles
  for select using (can_view_operations());

drop policy if exists savings_cycles_member_read on savings_cycles;
create policy savings_cycles_member_read on savings_cycles
  for select using (group_id = my_group_id());

drop policy if exists payment_intents_staff_read on payment_intents;
create policy payment_intents_staff_read on payment_intents
  for select using (can_view_operations());

drop policy if exists payment_intents_self_read on payment_intents;
create policy payment_intents_self_read on payment_intents
  for select using (member_id = current_member_id());

-- ===========================================================================
-- Functions whose permission check has to widen for the new roles.
--
-- Bodies are unchanged from where they were first defined; only the line that
-- decides who may call them has moved to a capability predicate.
-- ===========================================================================

-- 0003: staff dashboard figures.
create or replace function dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform assert_capability(can_view_operations(), 'view the dashboard');

  select jsonb_build_object(
    'total_members',      (select count(*) from members where status = 'active'),
    'members_this_month', (select count(*) from members
                            where joined_on >= date_trunc('month', current_date)),
    'share_capital',      (select coalesce(sum(sl.total_value), 0)
                             from share_lots sl
                             join transactions t on t.id = sl.transaction_id
                            where t.status = 'posted'),
    'total_savings',      (select coalesce(sum(
                              case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                                   then amount else -amount end), 0)
                             from transactions
                            where status = 'posted'
                              and type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')),
    'active_loan_count',  (select count(*) from loans where status in ('active', 'disbursed')),
    'active_loan_value',  (select coalesce(sum(principal), 0) from loans
                            where status in ('active', 'disbursed')),
    'outstanding_loans',  (select coalesce(sum(outstanding), 0) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')),
    'overdue_loans',      (select coalesce(sum(overdue_amount), 0) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')),
    'overdue_count',      (select count(*) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')
                              and overdue_amount > 0),
    'pending_loans',      (select count(*) from loans where status in ('applied', 'under_review')),
    'todays_collections', (select coalesce(sum(amount), 0) from transactions
                            where status = 'posted' and occurred_on = current_date
                              and type in ('weekly_savings', 'monthly_savings', 'deposit',
                                           'share_purchase', 'loan_repayment')),
    'income_mtd',         (select coalesce(sum(amount), 0) from income_entries
                            where received_on >= date_trunc('month', current_date)),
    'expenses_mtd',       (select coalesce(sum(e.amount), 0) from expense_entries e
                            where e.approval = 'approved'
                              and e.spent_on >= date_trunc('month', current_date)),
    'pending_expenses',   (select count(*) from expense_entries where approval = 'pending'),
    'total_groups',       (select count(*) from sacco_groups where status = 'active'),
    'groups_saving_today',(select count(*) from sacco_groups g
                            where g.status = 'active' and group_collects_on(g.id, current_date)),
    'savings_arrears',    (select coalesce(sum(greatest(expected_amount - paid_amount, 0)), 0)
                             from savings_periods
                            where status in ('partial', 'missed'))
  ) into v;

  return v;
end;
$$;

-- 0002: the ad-hoc savings entry, now open to a group officer.
create or replace function record_savings_payment(
  p_member_id uuid,
  p_kind      savings_kind,
  p_amount    numeric,
  p_paid_on   date default current_date,
  p_method    payment_method default 'cash',
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period  savings_periods;
  v_txn     transactions;
  v_payment savings_payments;
  v_member  members;
  v_paid    numeric(16,2);
  v_status  savings_status;
begin
  perform assert_capability(can_record_savings(), 'record savings');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Savings amount must be greater than zero.' using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'active' then
    raise exception 'Savings cannot be recorded for a % member.', v_member.status
      using errcode = 'check_violation';
  end if;

  v_period := ensure_savings_period(p_member_id, p_kind, coalesce(p_paid_on, current_date));

  if v_period.status = 'waived' then
    raise exception 'This period has been waived. Remove the waiver before recording a payment.'
      using errcode = 'check_violation';
  end if;

  v_txn := post_transaction(
    p_member_id,
    case when p_kind = 'weekly' then 'weekly_savings'::txn_type else 'monthly_savings'::txn_type end,
    p_amount, p_method, p_paid_on,
    initcap(p_kind::text) || ' savings - ' || v_period.period_label,
    p_idempotency_key
  );

  select * into v_payment from savings_payments where transaction_id = v_txn.id;
  if not found then
    insert into savings_payments (period_id, schedule_id, member_id, amount, paid_on, method,
                                  transaction_id, recorded_by)
    values (v_period.id, v_period.id, p_member_id, p_amount, coalesce(p_paid_on, current_date),
            p_method, v_txn.id, auth.uid())
    returning * into v_payment;

    update transactions set savings_id = v_payment.id where id = v_txn.id;

    -- Recompute from the payment rows. Never trust an incremented column.
    select coalesce(sum(sp.amount), 0) into v_paid
      from savings_payments sp
      join transactions t on t.id = sp.transaction_id
     where sp.period_id = v_period.id and t.status = 'posted';

    v_status := case
      when v_period.expected_amount > 0 and v_paid >= v_period.expected_amount then 'paid'
      when v_paid > 0 then 'partial'
      else 'pending'
    end;
    if v_period.expected_amount = 0 and v_paid > 0 then
      v_status := 'paid';
    end if;

    update savings_periods
       set paid_amount = v_paid, status = v_status
     where id = v_period.id;

    perform settle_manual_payment(
      p_member_id, v_period.group_id,
      case when p_kind = 'weekly' then 'weekly_savings'::txn_type else 'monthly_savings'::txn_type end,
      p_amount, p_method, v_period.id, null, v_txn.id, null, p_idempotency_key
    );

    perform write_audit('savings.recorded', 'Savings', v_payment.id::text,
      format('%s savings of UGX %s recorded for %s (%s)', initcap(p_kind::text),
             to_char(p_amount, 'FM999,999,999'), v_member.full_name, v_period.period_label),
      null, to_jsonb(v_payment), null);
  else
    select paid_amount, status into v_paid, v_status from savings_periods where id = v_period.id;
  end if;

  return jsonb_build_object(
    'transaction_id', v_txn.id,
    'reference',      v_txn.reference,
    'payment_id',     v_payment.id,
    'period_id',      v_period.id,
    'schedule_id',    v_period.id,
    'period_label',   v_period.period_label,
    'expected',       v_period.expected_amount,
    'paid',           v_paid,
    'balance',        greatest(v_period.expected_amount - v_paid, 0),
    'status',         v_status
  );
end;
$$;

-- 0002: income and expenses belong to the accountant as well.
create or replace function record_income(
  p_category_id uuid,
  p_amount      numeric,
  p_description text,
  p_received_on date default current_date,
  p_method      payment_method default 'cash',
  p_member_id   uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn transactions;
  v_row income_entries;
begin
  perform assert_capability(can_record_finance(), 'record income');

  v_txn := post_transaction(p_member_id, 'income', p_amount, p_method, p_received_on,
                            p_description, p_idempotency_key);

  select * into v_row from income_entries where transaction_id = v_txn.id;
  if not found then
    insert into income_entries (category_id, amount, description, received_on, method,
                                member_id, transaction_id, recorded_by)
    values (p_category_id, p_amount, p_description, coalesce(p_received_on, current_date),
            p_method, p_member_id, v_txn.id, auth.uid())
    returning * into v_row;

    update transactions set income_id = v_row.id where id = v_txn.id;

    perform write_audit('income.recorded', 'Financials', v_row.id::text,
      format('Income of UGX %s recorded', to_char(p_amount, 'FM999,999,999')),
      null, to_jsonb(v_row), p_description);
  end if;

  return jsonb_build_object('transaction_id', v_txn.id, 'reference', v_txn.reference,
                            'income_id', v_row.id);
end;
$$;

create or replace function record_expense(
  p_category_id uuid,
  p_amount      numeric,
  p_description text,
  p_spent_on    date default current_date,
  p_method      payment_method default 'cash',
  p_attachment_path text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row expense_entries;
begin
  perform assert_capability(can_record_finance(), 'record expenses');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Expense amount must be greater than zero.' using errcode = 'check_violation';
  end if;

  -- An expense is a *request* until approved. No ledger row is posted here;
  -- the cash only leaves the SACCO in approve_expense().
  insert into expense_entries (category_id, amount, description, spent_on, method,
                               attachment_path, approval, recorded_by)
  values (p_category_id, p_amount, p_description, coalesce(p_spent_on, current_date),
          p_method, p_attachment_path, 'pending', auth.uid())
  returning * into v_row;

  perform write_audit('expense.submitted', 'Financials', v_row.id::text,
    format('Expense of UGX %s submitted for approval', to_char(p_amount, 'FM999,999,999')),
    null, to_jsonb(v_row), p_description);

  return jsonb_build_object('expense_id', v_row.id, 'approval', v_row.approval);
end;
$$;

-- 0003: the cashbook is an accounting report.
create or replace function cashbook(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform assert_capability(can_view_finance(), 'view the cashbook');

  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'income', (
      select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select c.name as category, sum(i.amount) as total, count(*) as entries
          from income_entries i
          join income_categories c on c.id = i.category_id
         where i.received_on between p_from and p_to
         group by c.name
      ) x
    ),
    'expenses', (
      select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select c.name as category, sum(e.amount) as total, count(*) as entries
          from expense_entries e
          join expense_categories c on c.id = e.category_id
         where e.spent_on between p_from and p_to and e.approval = 'approved'
         group by c.name
      ) x
    ),
    'total_income',  (select coalesce(sum(amount), 0) from income_entries
                       where received_on between p_from and p_to),
    'total_expenses', (select coalesce(sum(amount), 0) from expense_entries
                        where spent_on between p_from and p_to and approval = 'approved')
  ) into v;

  return v || jsonb_build_object(
    'net_surplus', (v ->> 'total_income')::numeric - (v ->> 'total_expenses')::numeric
  );
end;
$$;

-- 0003: a member may read their own statement; staff may read any.
create or replace function member_statement(
  p_member_id uuid,
  p_from      date,
  p_to        date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_open  numeric(16,2);
  v_rows  jsonb;
  v_member jsonb;
begin
  if not (can_view_operations() or current_member_id() = p_member_id) then
    raise exception 'You may only view your own statement.' using errcode = 'insufficient_privilege';
  end if;

  select to_jsonb(mf) into v_member from member_financials mf where mf.id = p_member_id;
  if v_member is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  select coalesce(sum(case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                           then amount else -amount end), 0)
    into v_open
    from transactions
   where member_id = p_member_id and status = 'posted'
     and type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')
     and occurred_on < p_from;

  select coalesce(jsonb_agg(r order by r.occurred_on, r.created_at), '[]'::jsonb)
    into v_rows
    from (
      select t.reference, t.occurred_on, t.type, t.description, t.amount, t.method,
             t.status, t.created_at,
             sum(case when t.type in ('weekly_savings', 'monthly_savings', 'deposit')
                      then t.amount
                      when t.type = 'withdrawal' then -t.amount
                      else 0 end)
               over (order by t.occurred_on, t.created_at
                     rows between unbounded preceding and current row) + v_open as running_balance
        from transactions t
       where t.member_id = p_member_id
         and t.status in ('posted', 'reversed', 'reversal')
         and t.occurred_on between p_from and p_to
    ) r;

  return jsonb_build_object(
    'member',          v_member,
    'from',            p_from,
    'to',              p_to,
    'opening_balance', v_open,
    'rows',            v_rows,
    'generated_at',    now()
  );
end;
$$;

-- 0006: receipts.
create or replace function receipt_for_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_txn transaction_feed;
begin
  select * into v_txn from transaction_feed where id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found.' using errcode = 'no_data_found';
  end if;

  if not (can_view_operations() or v_txn.member_id = current_member_id()) then
    raise exception 'You may only view your own receipts.' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'transaction',   to_jsonb(v_txn),
    'sacco_name',    'BAKENYE UNITY AND DEVELOPMENT SACCO',
    'receipt_no',    replace(v_txn.reference, 'BND-TX-', 'BND-RCP-'),
    'loan', (
      select jsonb_build_object('loan_no', l.loan_no, 'outstanding', lb.outstanding,
                                'total_payable', l.total_payable, 'next_due_on', lb.next_due_on)
        from loans l join loan_balances lb on lb.loan_id = l.id
       where l.id = v_txn.loan_id
    ),
    'shares', (
      select jsonb_build_object('quantity', sl.quantity, 'unit_price', sl.unit_price,
                                'total_value', sl.total_value)
        from share_lots sl where sl.transaction_id = v_txn.id
    ),
    'balance_after', (
      select coalesce(sum(case when t2.type in ('weekly_savings', 'monthly_savings', 'deposit')
                               then t2.amount else -t2.amount end), 0)
        from transactions t2
       where t2.member_id = v_txn.member_id
         and t2.status = 'posted'
         and t2.type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')
         and (t2.occurred_on, t2.created_at) <= (v_txn.occurred_on, v_txn.created_at)
    )
  );
end;
$$;

-- 0006: loan portfolio report.
create or replace function loan_portfolio(
  p_status loan_status default null,
  p_from   date default null,
  p_to     date default null,
  p_limit  integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_total bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform assert_capability(can_view_operations(), 'view the loan portfolio');

  select count(*) into v_total
    from loans l
   where (p_status is null or l.status = p_status)
     and (p_from is null or l.applied_on >= p_from)
     and (p_to   is null or l.applied_on <= p_to);

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
    from (
      select l.id, l.loan_no, l.status, l.principal, l.total_payable, l.interest_rate,
             l.period_months, l.applied_on, l.disbursed_on, l.purpose,
             lb.amount_paid, lb.outstanding, lb.percent_repaid,
             lb.next_due_on, lb.overdue_amount, lb.days_overdue,
             m.id as member_id, m.member_no, m.full_name as member_name, m.photo_url,
             lp.name as product_name
        from loans l
        join loan_balances lb on lb.loan_id = l.id
        join members m        on m.id = l.member_id
        join loan_products lp on lp.id = l.product_id
       where (p_status is null or l.status = p_status)
         and (p_from is null or l.applied_on >= p_from)
         and (p_to   is null or l.applied_on <= p_to)
       order by l.applied_on desc, l.created_at desc
       offset greatest(coalesce(p_offset, 0), 0)
       limit v_limit
    ) r;

  return jsonb_build_object('rows', v_rows, 'total', v_total,
                            'limit', v_limit, 'offset', greatest(coalesce(p_offset, 0), 0));
end;
$$;

-- 0006: opening periods for every active member, regardless of group.
create or replace function open_savings_periods(p_kind savings_kind, p_on date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_m     record;
begin
  perform assert_capability(can_record_savings(), 'open savings periods');

  for v_m in select id from members where status = 'active' loop
    perform ensure_savings_period(v_m.id, p_kind, p_on);
    v_count := v_count + 1;
  end loop;

  perform write_audit('savings.periods_opened', 'Savings', null,
    format('Opened %s %s savings period(s) for %s', v_count, p_kind, to_char(p_on, 'DD Mon YYYY')),
    null, null, null);

  return v_count;
end;
$$;
