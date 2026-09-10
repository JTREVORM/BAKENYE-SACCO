-- ===========================================================================
-- BUD-SACCO - 0025 - One share price
--
-- The official Bakenye National Development SACCO share price is UGX 20,000.
--
-- Until this migration the database held that fact in two places that
-- disagreed:
--
--   share_settings.unit_price      UGX 50,000   read by buy_shares(), receipts,
--                                                Settings and the Shares module
--   share_categories.share_price   UGX 20,000   one copy per category, read by
--                                                the Categories screen
--
-- Two stored copies of one price is the failure itself, whichever of them
-- happens to be right on a given day. So this migration does not merely fix
-- the number. It removes the second copy:
--
--   * `share_settings.unit_price` becomes the only stored share price. It is
--     what `buy_shares()` has always charged, what every share lot records at
--     the moment of sale, and what Settings edits through the audited
--     `update_share_settings()`.
--   * `share_categories` keeps what genuinely differs per tier - how many
--     shares, and by when - and loses `share_price` and the generated
--     `required_amount`. Both are now derived from the one price, in the
--     `share_categories_priced` view, so 50 shares is UGX 1,000,000 because the
--     current price is UGX 20,000, not because a category row says so.
--
-- Shares already bought keep the price on their own `share_lots` row. There
-- were none at UGX 50,000 when this was written, but that is a property of the
-- ledger, not of this migration: a later price change can never restate a sale.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Correct the stored price.
--
-- Conditional on the old value, so re-running this file can never overwrite a
-- price the SACCO later sets on purpose. The change is written to the audit
-- log, because a share price moving is exactly the kind of event that log is
-- for - and "a migration did it" is a better answer than no answer.
-- ---------------------------------------------------------------------------
do $$
declare
  v_old share_settings;
begin
  select * into v_old from share_settings where id;

  if found and v_old.unit_price = 50000 then
    update share_settings
       set unit_price = 20000,
           updated_at = now()
     where id;

    insert into audit_logs (actor_name, action, module, record_id, summary,
                            old_value, new_value, reason)
    values ('system (migration 0025)', 'settings.shares', 'Settings', 'share_settings',
            'Share price corrected from UGX 50,000 to UGX 20,000',
            jsonb_build_object('unit_price', v_old.unit_price),
            jsonb_build_object('unit_price', 20000),
            'The official Bakenye National Development SACCO share price is UGX 20,000 per share.');
  end if;
end $$;

-- A fresh database must not start life at the old price either.
alter table share_settings alter column unit_price set default 20000;

-- ---------------------------------------------------------------------------
-- 2. The one reader.
--
-- Every function and view that needs the price asks this, rather than each
-- carrying its own `select unit_price from share_settings`. SECURITY DEFINER so
-- a member's security-invoker view can value their own shares without needing
-- a policy of its own on the settings table.
-- ---------------------------------------------------------------------------
create or replace function share_unit_price()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select unit_price from share_settings where id;
$$;

grant execute on function share_unit_price() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Remove the second copy.
--
-- The views that read the per-category columns go first. No CASCADE: if
-- anything else still depends on them, this should fail loudly rather than
-- quietly take it down.
-- ---------------------------------------------------------------------------
drop view if exists share_category_summary;
drop view if exists member_financials;
drop view if exists member_share_progress;

alter table share_categories drop column if exists required_amount;
alter table share_categories drop column if exists share_price;

-- ---------------------------------------------------------------------------
-- 4. share_categories_priced - a share category, valued at the one price.
--
-- The Categories screen, the member forms and every total below read this.
-- `share_price` is the SACCO's price, repeated on each row for convenience;
-- `required_amount` is `required_shares` times it. If the price cannot be read
-- both are null, and the screens say "not set" rather than guess.
-- ---------------------------------------------------------------------------
create view share_categories_priced
with (security_invoker = true) as
select
  c.id,
  c.code,
  c.name,
  c.required_shares,
  p.unit_price                                      as share_price,
  (c.required_shares * p.unit_price)::numeric(16,2) as required_amount,
  c.qualification_months,
  c.description,
  c.status,
  c.sort_order,
  c.created_by,
  c.created_at,
  c.updated_at
from share_categories c
cross join (select share_unit_price() as unit_price) p;

-- ---------------------------------------------------------------------------
-- 5. The dependent views, restated against the priced categories.
--
-- Bodies are 0022's, with `share_categories` swapped for
-- `share_categories_priced`. Nothing else about how progress, qualification or
-- arrears is computed has changed.
-- ---------------------------------------------------------------------------
create view member_share_progress
with (security_invoker = true) as
select
  m.id                                   as member_id,
  m.share_category_id,
  sc.code                                as share_category_code,
  sc.name                                as share_category_name,
  sc.required_shares                     as target_shares,
  sc.share_price,
  sc.required_amount                     as target_amount,
  sc.qualification_months,
  coalesce(sh.share_count, 0)::integer   as shares_owned,
  coalesce(sh.share_value, 0)::numeric(16,2) as share_value,
  greatest(sc.required_shares - coalesce(sh.share_count, 0), 0)::integer
                                         as shares_remaining,
  -- What the remaining shares cost at today's price - the figure a member can
  -- actually act on - rather than target value minus value held, which would
  -- mislead the moment lots had been bought at a different price.
  (greatest(sc.required_shares - coalesce(sh.share_count, 0), 0) * sc.share_price)::numeric(16,2)
                                         as amount_remaining,
  case when sc.required_shares > 0
       then least(round(coalesce(sh.share_count, 0)::numeric
                        / sc.required_shares * 100, 2), 100)
       else null end::numeric(6,2)       as progress_percent,
  case when sc.qualification_months is not null
       then (m.joined_on + (sc.qualification_months || ' months')::interval)::date
       else null end                     as qualifies_by,
  case when sc.qualification_months is not null
       then (m.joined_on + (sc.qualification_months || ' months')::interval)::date
            - current_date
       else null end                     as days_to_qualify,
  (sc.id is not null and coalesce(sh.share_count, 0) >= sc.required_shares)
                                         as qualified,
  (sc.id is not null
   and sc.qualification_months is not null
   and coalesce(sh.share_count, 0) < sc.required_shares
   and (m.joined_on + (sc.qualification_months || ' months')::interval)::date < current_date)
                                         as qualification_lapsed
from members m
left join share_categories_priced sc on sc.id = m.share_category_id
left join member_shares           sh on sh.member_id = m.id;

create view member_financials
with (security_invoker = true) as
select
  m.id,
  m.member_no,
  m.user_id,
  m.full_name,
  m.phone,
  m.email,
  m.national_id,
  m.photo_url,
  m.status,
  m.joined_on,
  m.address,
  m.occupation,
  m.next_of_kin_name,
  m.next_of_kin_phone,
  m.next_of_kin_relation,
  m.date_of_birth,
  m.gender,

  coalesce(ms.savings_balance, 0)   as savings_balance,
  coalesce(ms.weekly_total, 0)      as weekly_total,
  coalesce(ms.monthly_total, 0)     as monthly_total,
  coalesce(ms.deposits_total, 0)    as deposits_total,
  coalesce(ms.withdrawals_total, 0) as withdrawals_total,
  coalesce(sh.share_count, 0)       as share_count,
  coalesce(sh.share_value, 0)       as share_value,
  coalesce(ml.loan_balance, 0)      as loan_balance,
  coalesce(ml.overdue_amount, 0)    as overdue_amount,
  coalesce(ml.active_loans, 0)      as active_loans,
  coalesce(ml.pending_loans, 0)     as pending_loans,
  ml.next_due_on,
  ml.next_due_amount,
  (coalesce(ms.savings_balance, 0) + coalesce(sh.share_value, 0))::numeric(16,2) as total_equity,

  -- --- share category ------------------------------------------------------
  m.share_category_id,
  shc.code                          as share_category_code,
  shc.name                          as share_category_name,
  shc.required_shares               as share_target_shares,
  shc.required_amount               as share_target_amount,
  sp.shares_remaining               as share_shares_remaining,
  sp.amount_remaining               as share_amount_remaining,
  sp.progress_percent               as share_progress_percent,
  sp.qualifies_by                   as share_qualifies_by,
  sp.qualified                      as share_qualified,
  sp.qualification_lapsed           as share_qualification_lapsed,

  -- --- savings category ----------------------------------------------------
  m.savings_category_id,
  svc.code                          as savings_category_code,
  svc.name                          as savings_category_name,
  svc.amount                        as savings_expected_amount,
  svc.frequency                     as savings_frequency,

  nx.due_on                         as savings_next_due_on,
  nx.expected_amount                as savings_next_expected,
  nx.paid_amount                    as savings_next_paid,
  nx.status                         as savings_next_status,
  nx.period_label                   as savings_current_cycle,

  coalesce(ar.outstanding, 0)::numeric(16,2) as savings_outstanding,
  coalesce(ct.contributed, 0)::numeric(16,2) as savings_contributed
from members m
left join member_savings          ms  on ms.member_id = m.id
left join member_shares           sh  on sh.member_id = m.id
left join member_loans_summary    ml  on ml.member_id = m.id
left join share_categories_priced shc on shc.id = m.share_category_id
left join savings_categories      svc on svc.id = m.savings_category_id
left join member_share_progress   sp  on sp.member_id = m.id
left join lateral (
  select s.due_on, s.expected_amount, s.paid_amount, s.status, s.period_label
    from savings_periods s
   where s.member_id = m.id
     and s.status in ('pending', 'partial')
   order by coalesce(s.due_on, s.period_end)
   limit 1
) nx on true
left join lateral (
  select sum(greatest(s.expected_amount - s.paid_amount, 0)) as outstanding
    from savings_periods s
   where s.member_id = m.id
     and s.status in ('pending', 'partial', 'missed')
) ar on true
left join lateral (
  select sum(s.paid_amount) as contributed
    from savings_periods s
   where s.member_id = m.id
) ct on true;

create view share_category_summary
with (security_invoker = true) as
select
  c.id                                    as share_category_id,
  c.code,
  c.name,
  c.required_shares,
  c.share_price,
  c.required_amount,
  c.qualification_months,
  c.status,
  c.sort_order,
  coalesce(ag.member_count, 0)::integer     as member_count,
  coalesce(ag.active_count, 0)::integer     as active_member_count,
  coalesce(ag.qualified, 0)::integer        as qualified_members,
  coalesce(ag.lapsed, 0)::integer           as lapsed_members,
  coalesce(ag.shares_held, 0)::integer      as shares_held,
  coalesce(ag.value_held, 0)::numeric(16,2) as value_held,
  (c.required_amount * coalesce(ag.active_count, 0))::numeric(16,2) as value_targeted,
  case when coalesce(ag.member_count, 0) > 0
       then round(coalesce(ag.qualified, 0)::numeric / ag.member_count * 100, 2)
       else 0 end::numeric(6,2)             as qualification_rate
from share_categories_priced c
left join lateral (
  select
    count(*)                                                  as member_count,
    count(*) filter (where p.member_status = 'active')         as active_count,
    count(*) filter (where p.qualified)                        as qualified,
    count(*) filter (where p.qualification_lapsed)             as lapsed,
    sum(p.shares_owned)                                        as shares_held,
    sum(p.share_value)                                         as value_held
  from (
    select msp.*, m.status as member_status
      from member_share_progress msp
      join members m on m.id = msp.member_id
     where msp.share_category_id = c.id
  ) p
) ag on true;

grant select on share_categories_priced to authenticated;
grant select on member_share_progress   to authenticated;
grant select on member_financials       to authenticated;
grant select on share_category_summary  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Category administration without a per-category price.
--
-- A category now says how many shares and by when. It has no price to set, so
-- the functions no longer accept one - an argument that silently did nothing
-- would be worse than no argument.
-- ---------------------------------------------------------------------------
drop function if exists create_share_category(text, integer, numeric, integer, text, text, integer);
drop function if exists update_share_category(uuid, text, integer, numeric, integer, text, integer);

create or replace function create_share_category(
  p_name            text,
  p_required_shares integer,
  p_qualification_months integer default null,
  p_description     text default null,
  p_code            text default null,
  p_sort_order      integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat   share_categories;
  v_code  text;
  v_price numeric := share_unit_price();
begin
  perform assert_capability(can_manage_categories(), 'create share categories');

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name for the share category.' using errcode = 'check_violation';
  end if;
  if p_required_shares is null or p_required_shares < 1 then
    raise exception 'A share category must require at least one share.'
      using errcode = 'check_violation';
  end if;

  v_code := upper(regexp_replace(coalesce(nullif(trim(p_code), ''), trim(p_name)),
                                 '[^A-Za-z0-9]+', '_', 'g'));
  v_code := regexp_replace(v_code, '^_+|_+$', '', 'g');

  insert into share_categories (code, name, required_shares, qualification_months,
                                description, sort_order, created_by)
  values (v_code, trim(p_name), p_required_shares, p_qualification_months,
          nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_sort_order, 100), auth.uid())
  returning * into v_cat;

  perform write_audit('share_category.created', 'Categories', v_cat.id::text,
    format('Share category %s created - %s shares, UGX %s at the current share price',
           v_cat.name, v_cat.required_shares,
           coalesce(to_char(v_cat.required_shares * v_price, 'FM999,999,999'), '(price not set)')),
    null, to_jsonb(v_cat), null);

  return jsonb_build_object('id', v_cat.id, 'code', v_cat.code, 'name', v_cat.name);
end;
$$;

create or replace function update_share_category(
  p_id              uuid,
  p_name            text,
  p_required_shares integer,
  p_qualification_months integer default null,
  p_description     text default null,
  p_sort_order      integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old   share_categories;
  v_cat   share_categories;
  v_price numeric := share_unit_price();
begin
  perform assert_capability(can_manage_categories(), 'edit share categories');

  select * into v_old from share_categories where id = p_id for update;
  if not found then
    raise exception 'Share category not found.' using errcode = 'no_data_found';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name for the share category.' using errcode = 'check_violation';
  end if;
  if p_required_shares is null or p_required_shares < 1 then
    raise exception 'A share category must require at least one share.'
      using errcode = 'check_violation';
  end if;

  update share_categories
     set name                 = trim(p_name),
         required_shares      = p_required_shares,
         qualification_months = p_qualification_months,
         description          = nullif(trim(coalesce(p_description, '')), ''),
         sort_order           = coalesce(p_sort_order, 100)
   where id = p_id
  returning * into v_cat;

  perform write_audit('share_category.updated', 'Categories', p_id::text,
    format('Share category %s updated - %s shares, UGX %s at the current share price',
           v_cat.name, v_cat.required_shares,
           coalesce(to_char(v_cat.required_shares * v_price, 'FM999,999,999'), '(price not set)')),
    to_jsonb(v_old), to_jsonb(v_cat), null);

  return jsonb_build_object('id', v_cat.id, 'code', v_cat.code, 'name', v_cat.name);
end;
$$;

grant execute on function create_share_category(text, integer, integer, text, text, integer) to authenticated;
grant execute on function update_share_category(uuid, text, integer, integer, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. buy_shares - the only place a share is sold.
--
-- Restated from 0002 for one reason: it read the price inline and would have
-- multiplied by null if the settings row were ever missing, surfacing as an
-- opaque "amount must be greater than zero" from the ledger. It now reads the
-- one reader and refuses, by name, to sell a share that has no price.
-- Everything else - roles, idempotency, the lot recording its own price - is
-- unchanged.
-- ---------------------------------------------------------------------------
create or replace function buy_shares(
  p_member_id   uuid,
  p_quantity    integer,
  p_method      payment_method default 'cash',
  p_purchased_on date default current_date,
  p_note        text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price numeric(16,2);
  v_total numeric(16,2);
  v_txn   transactions;
  v_lot   share_lots;
  v_member members;
begin
  perform assert_role('super_admin', 'manager', 'cashier');

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Number of shares must be at least 1.' using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'active' then
    raise exception 'Shares cannot be sold to a % member.', v_member.status
      using errcode = 'check_violation';
  end if;

  v_price := share_unit_price();
  if v_price is null or v_price <= 0 then
    raise exception 'The share price has not been set. Set it under Settings before recording a purchase.'
      using errcode = 'check_violation';
  end if;

  v_total := v_price * p_quantity;

  v_txn := post_transaction(
    p_member_id, 'share_purchase', v_total, p_method, p_purchased_on,
    format('Purchase of %s share(s) at UGX %s each', p_quantity, to_char(v_price, 'FM999,999,999')),
    p_idempotency_key
  );

  -- Idempotent replay: the ledger row already existed, so does the lot.
  select * into v_lot from share_lots where transaction_id = v_txn.id;
  if not found then
    insert into share_lots (member_id, quantity, unit_price, purchased_on,
                            transaction_id, note, recorded_by)
    values (p_member_id, p_quantity, v_price, coalesce(p_purchased_on, current_date),
            v_txn.id, p_note, auth.uid())
    returning * into v_lot;

    update transactions set share_lot_id = v_lot.id where id = v_txn.id;

    perform write_audit('shares.purchased', 'Shares', v_lot.id::text,
      format('%s bought %s share(s) for UGX %s', v_member.full_name, p_quantity,
             to_char(v_total, 'FM999,999,999')),
      null, to_jsonb(v_lot), p_note);
  end if;

  return jsonb_build_object(
    'transaction_id', v_txn.id,
    'reference',      v_txn.reference,
    'share_lot_id',   v_lot.id,
    'quantity',       v_lot.quantity,
    'unit_price',     v_lot.unit_price,
    'total_value',    v_lot.total_value
  );
end;
$$;
