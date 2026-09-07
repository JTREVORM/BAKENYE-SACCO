-- ===========================================================================
-- BUD-SACCO - 0006 - Application support functions
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Sign-in by member number.
--
-- Members are issued BND-M-0000123, not an email address they will remember, so
-- the number has to be resolved to the account email before
-- `signInWithPassword` can run.
--
-- This is deliberately NOT granted to `anon`. Exposing it to unauthenticated
-- callers would hand anyone a member-number-to-email oracle: walk
-- BND-M-0000001 upwards and harvest the address of every member of the SACCO.
--
-- Instead it is callable only with the service-role key, from the server-side
-- sign-in action, which returns an identical failure whether or not the member
-- number exists. See `signIn()` in `src/app/(auth)/actions.ts`.
-- ---------------------------------------------------------------------------
create or replace function email_for_member_no(p_member_no text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email::text
    from members m
    join app_users u on u.id = m.user_id
   where upper(m.member_no) = upper(p_member_no)
     and u.is_active
     and m.status = 'active'
   limit 1;
$$;

revoke all on function email_for_member_no(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Paginated member directory.
--
-- Point 25 of the brief: "Do not fetch an entire members table just to display
-- the first 20 members." Search, filter, sort, count and page all happen here;
-- the phone receives at most `p_limit` rows plus a total.
-- ---------------------------------------------------------------------------
create or replace function search_members(
  p_query   text default null,
  p_status  member_status default null,
  p_sort    text default 'name',      -- name | recent | savings | shares | loan
  p_limit   integer default 20,
  p_offset  integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows  jsonb;
  v_total bigint;
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform assert_role('super_admin', 'manager', 'loan_officer', 'cashier');

  select count(*) into v_total
    from members m
   where (p_status is null or m.status = p_status)
     and (v_q is null
          or m.full_name ilike '%' || v_q || '%'
          or m.member_no ilike '%' || v_q || '%'
          or m.phone     ilike '%' || v_q || '%'
          or coalesce(m.national_id, '') ilike '%' || v_q || '%');

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_rank), '[]'::jsonb)
    into v_rows
    from (
      select mf.*,
             case p_sort
               when 'recent'  then row_number() over (order by mf.joined_on desc, mf.full_name)
               when 'savings' then row_number() over (order by mf.savings_balance desc, mf.full_name)
               when 'shares'  then row_number() over (order by mf.share_value desc, mf.full_name)
               when 'loan'    then row_number() over (order by mf.loan_balance desc, mf.full_name)
               else                row_number() over (order by mf.full_name)
             end as sort_rank
        from member_financials mf
       where (p_status is null or mf.status = p_status)
         and (v_q is null
              or mf.full_name ilike '%' || v_q || '%'
              or mf.member_no ilike '%' || v_q || '%'
              or mf.phone     ilike '%' || v_q || '%'
              or coalesce(mf.national_id, '') ilike '%' || v_q || '%')
       order by sort_rank
       offset greatest(coalesce(p_offset, 0), 0)
       limit v_limit
    ) r;

  return jsonb_build_object(
    'rows',   v_rows,
    'total',  v_total,
    'limit',  v_limit,
    'offset', greatest(coalesce(p_offset, 0), 0)
  );
end;
$$;

grant execute on function search_members(text, member_status, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Guarantor picker - active members only, excluding the borrower and anyone
-- already attached to the loan. Capped at 10 so the phone never renders a
-- 500-row dropdown.
-- ---------------------------------------------------------------------------
create or replace function search_guarantor_candidates(
  p_query     text,
  p_exclude_member uuid,
  p_loan_id   uuid default null
) returns table (
  id uuid, member_no text, full_name text, phone text,
  photo_url text, savings_balance numeric, share_value numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select mf.id, mf.member_no, mf.full_name, mf.phone, mf.photo_url,
         mf.savings_balance, mf.share_value
    from member_financials mf
   where mf.status = 'active'
     and mf.id <> p_exclude_member
     and (p_loan_id is null
          or not exists (select 1 from loan_guarantors g
                          where g.loan_id = p_loan_id and g.member_id = mf.id))
     and (nullif(trim(coalesce(p_query, '')), '') is null
          or mf.full_name ilike '%' || trim(p_query) || '%'
          or mf.member_no ilike '%' || trim(p_query) || '%'
          or mf.phone     ilike '%' || trim(p_query) || '%')
   order by mf.full_name
   limit 10;
$$;

grant execute on function search_guarantor_candidates(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Receipt payload - everything printed on a receipt in one round trip.
-- ---------------------------------------------------------------------------
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

  if not (has_role('super_admin', 'manager', 'loan_officer', 'cashier')
          or v_txn.member_id = current_member_id()) then
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

grant execute on function receipt_for_transaction(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Savings performance report - one row per member for a period range.
-- ---------------------------------------------------------------------------
create or replace function savings_performance(
  p_kind savings_kind,
  p_from date,
  p_to   date
) returns table (
  member_id uuid, member_no text, full_name text,
  periods integer, expected numeric, paid numeric, balance numeric,
  paid_periods integer, missed_periods integer, compliance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id, m.member_no, m.full_name,
    count(sp.id)::integer,
    coalesce(sum(sp.expected_amount), 0)::numeric(16,2),
    coalesce(sum(sp.paid_amount), 0)::numeric(16,2),
    greatest(coalesce(sum(sp.expected_amount), 0) - coalesce(sum(sp.paid_amount), 0), 0)::numeric(16,2),
    count(sp.id) filter (where sp.status = 'paid')::integer,
    count(sp.id) filter (where sp.status = 'missed')::integer,
    case when count(sp.id) = 0 then 0
         else round(count(sp.id) filter (where sp.status = 'paid')::numeric
                    / count(sp.id) * 100, 1) end
  from members m
  left join savings_periods sp
         on sp.member_id = m.id
        and sp.kind = p_kind
        and sp.period_start >= p_from
        and sp.period_end   <= p_to
  where m.status = 'active'
  group by m.id, m.member_no, m.full_name
  order by m.full_name;
$$;

grant execute on function savings_performance(savings_kind, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Bulk-open savings periods for every active member.
--
-- Run weekly/monthly (pg_cron or an external scheduler) so the collection sheet
-- exists before the cashier starts the round, and so an unpaid period can be
-- marked 'missed' rather than silently not existing.
-- ---------------------------------------------------------------------------
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
  perform assert_role('super_admin', 'manager');

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

grant execute on function open_savings_periods(savings_kind, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Mark notifications read.
-- ---------------------------------------------------------------------------
create or replace function mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  update notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff provisioning: assign a role. Super admin only, and never to yourself
-- (so the last super admin cannot accidentally demote the account that would
-- have been able to fix it).
-- ---------------------------------------------------------------------------
create or replace function set_user_role(p_user_id uuid, p_role user_role, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_users;
  v_old  jsonb;
begin
  perform assert_role('super_admin');

  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role.' using errcode = 'check_violation';
  end if;

  select * into v_user from app_users where id = p_user_id for update;
  if not found then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_user);

  update app_users set role = p_role where id = p_user_id returning * into v_user;

  perform write_audit('user.role_changed', 'User Management', p_user_id::text,
    format('%s role changed from %s to %s', v_user.full_name, v_old ->> 'role', p_role),
    v_old, to_jsonb(v_user), p_reason);

  return jsonb_build_object('user_id', v_user.id, 'role', v_user.role);
end;
$$;

grant execute on function set_user_role(uuid, user_role, text) to authenticated;

create or replace function set_user_active(p_user_id uuid, p_active boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_users;
  v_old  jsonb;
begin
  perform assert_role('super_admin');

  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.' using errcode = 'check_violation';
  end if;

  select * into v_user from app_users where id = p_user_id for update;
  if not found then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_user);

  update app_users set is_active = p_active where id = p_user_id returning * into v_user;

  perform write_audit(case when p_active then 'user.activated' else 'user.deactivated' end,
    'User Management', p_user_id::text,
    format('%s %s', v_user.full_name, case when p_active then 'activated' else 'deactivated' end),
    v_old, to_jsonb(v_user), p_reason);

  return jsonb_build_object('user_id', v_user.id, 'is_active', v_user.is_active);
end;
$$;

grant execute on function set_user_active(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Loan portfolio report.
-- ---------------------------------------------------------------------------
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
  perform assert_role('super_admin', 'manager', 'loan_officer', 'cashier');

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

grant execute on function loan_portfolio(loan_status, date, date, integer, integer) to authenticated;
