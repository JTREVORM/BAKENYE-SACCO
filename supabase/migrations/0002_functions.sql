-- ===========================================================================
-- BND-SACCO - 0002 - Financial integrity layer
--
-- Every money-moving operation lives here as a SECURITY DEFINER function that
-- runs inside a single transaction. The web app never writes to `transactions`,
-- `share_lots`, `loan_repayments` or `savings_payments` directly - it calls
-- these. That is what makes "no duplicate transactions", "no negative
-- balances", "no double disbursement" enforceable rather than aspirational.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Reference generation: BND-TX-2026-004582
-- Uses a counter row locked FOR UPDATE so concurrent cashiers cannot collide.
-- ---------------------------------------------------------------------------
create or replace function next_document_no(p_prefix text, p_width integer default 6)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_year  text := to_char(current_date, 'YYYY');
  v_next  bigint;
begin
  -- Member numbers are not year-scoped; financial documents are.
  if p_prefix = 'M' then
    v_scope := 'M';
  else
    v_scope := p_prefix || '-' || v_year;
  end if;

  insert into doc_counters (scope, last_value)
  values (v_scope, 1)
  on conflict (scope) do update
    set last_value = doc_counters.last_value + 1
  returning last_value into v_next;

  if p_prefix = 'M' then
    return 'BND-M-' || lpad(v_next::text, p_width, '0');
  end if;

  return 'BND-' || p_prefix || '-' || v_year || '-' || lpad(v_next::text, p_width, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger immutability. A posted transaction may never be edited or deleted.
-- The only permitted UPDATE is the bookkeeping that links it to its reversal.
-- ---------------------------------------------------------------------------
create or replace function guard_transaction_immutability()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Transactions cannot be deleted. Post a reversal instead (ref %).', old.reference
      using errcode = 'check_violation';
  end if;

  -- Allow only the reversal linkage fields to change.
  if new.reference      is distinct from old.reference
     or new.amount      is distinct from old.amount
     or new.type        is distinct from old.type
     or new.member_id   is distinct from old.member_id
     or new.occurred_on is distinct from old.occurred_on
     or new.created_at  is distinct from old.created_at
  then
    raise exception 'Transaction % is immutable. Post a reversal instead.', old.reference
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger transactions_immutable
  before update or delete on transactions
  for each row execute function guard_transaction_immutability();

-- ---------------------------------------------------------------------------
-- Audit helper. Called from inside every state-changing function so the log
-- cannot be "forgotten" by a caller.
-- ---------------------------------------------------------------------------
create or replace function write_audit(
  p_action    text,
  p_module    text,
  p_record_id text,
  p_summary   text,
  p_old       jsonb default null,
  p_new       jsonb default null,
  p_reason    text  default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role user_role;
begin
  select full_name, role into v_name, v_role from app_users where id = auth.uid();

  insert into audit_logs (actor_id, actor_name, actor_role, action, module,
                          record_id, summary, old_value, new_value, reason)
  values (auth.uid(), coalesce(v_name, 'system'), v_role, p_action, p_module,
          p_record_id, p_summary, p_old, p_new, p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Role helpers used throughout RLS and the functions below.
-- ---------------------------------------------------------------------------
create or replace function current_role_of()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from app_users where id = auth.uid() and is_active;
$$;

create or replace function has_role(variadic p_roles user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users
    where id = auth.uid() and is_active and role = any (p_roles)
  );
$$;

create or replace function current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from members where user_id = auth.uid();
$$;

create or replace function assert_role(variadic p_roles user_role[])
returns void
language plpgsql
stable
as $$
begin
  if not has_role(variadic p_roles) then
    raise exception 'You do not have permission to perform this action.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: post one ledger row. Not callable from the API.
-- ---------------------------------------------------------------------------
create or replace function post_transaction(
  p_member_id  uuid,
  p_type       txn_type,
  p_amount     numeric,
  p_method     payment_method,
  p_occurred_on date,
  p_description text,
  p_idempotency_key text default null
) returns transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row transactions;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero.' using errcode = 'check_violation';
  end if;

  -- Idempotency: if this exact key was already posted, return the original row
  -- instead of creating a duplicate. This is what makes a double-tapped
  -- "Confirm" button on a flaky 3G connection safe.
  if p_idempotency_key is not null then
    select * into v_row from transactions where idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  insert into transactions (reference, member_id, type, amount, method,
                            occurred_on, description, idempotency_key, recorded_by)
  values (next_document_no('TX'), p_member_id, p_type, p_amount, p_method,
          coalesce(p_occurred_on, current_date), p_description, p_idempotency_key, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ===========================================================================
-- SHARES
-- ===========================================================================
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

  select unit_price into v_price from share_settings where id;
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

-- ===========================================================================
-- SAVINGS
-- ===========================================================================

-- Canonical period boundaries so the same week/month always resolves to one row.
create or replace function savings_period_bounds(p_kind savings_kind, p_on date)
returns table (period_start date, period_end date, period_label text)
language sql immutable as $$
  select
    case when p_kind = 'weekly'
         then date_trunc('week', p_on)::date
         else date_trunc('month', p_on)::date end,
    case when p_kind = 'weekly'
         then (date_trunc('week', p_on) + interval '6 days')::date
         else (date_trunc('month', p_on) + interval '1 month - 1 day')::date end,
    case when p_kind = 'weekly'
         then 'Week ' || to_char(p_on, 'IW') || ', ' || to_char(p_on, 'IYYY')
         else to_char(p_on, 'Mon YYYY') end;
$$;

-- Find-or-create the period row, seeding `expected_amount` from the member's plan.
create or replace function ensure_savings_period(
  p_member_id uuid,
  p_kind      savings_kind,
  p_on        date
) returns savings_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b       record;
  v_period  savings_periods;
  v_target  numeric(16,2);
begin
  select * into v_b from savings_period_bounds(p_kind, p_on);

  select * into v_period from savings_periods
   where member_id = p_member_id and kind = p_kind and period_start = v_b.period_start
   for update;

  if found then
    return v_period;
  end if;

  select target_amount into v_target
    from savings_plans
   where member_id = p_member_id and kind = p_kind
     and active_from <= p_on and (active_to is null or active_to >= p_on)
   order by active_from desc
   limit 1;

  insert into savings_periods (member_id, kind, period_start, period_end,
                               period_label, expected_amount, status)
  values (p_member_id, p_kind, v_b.period_start, v_b.period_end,
          v_b.period_label, coalesce(v_target, 0), 'pending')
  on conflict (member_id, kind, period_start) do update
    set period_label = excluded.period_label
  returning * into v_period;

  return v_period;
end;
$$;

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
  perform assert_role('super_admin', 'manager', 'cashier');

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

  v_txn := post_transaction(
    p_member_id,
    case when p_kind = 'weekly' then 'weekly_savings'::txn_type else 'monthly_savings'::txn_type end,
    p_amount, p_method, p_paid_on,
    initcap(p_kind::text) || ' savings - ' || v_period.period_label,
    p_idempotency_key
  );

  select * into v_payment from savings_payments where transaction_id = v_txn.id;
  if not found then
    insert into savings_payments (period_id, member_id, amount, paid_on, method,
                                  transaction_id, recorded_by)
    values (v_period.id, p_member_id, p_amount, coalesce(p_paid_on, current_date),
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
    -- With no configured target, any payment counts as settled for that period.
    if v_period.expected_amount = 0 and v_paid > 0 then
      v_status := 'paid';
    end if;

    update savings_periods
       set paid_amount = v_paid, status = v_status
     where id = v_period.id;

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
    'period_label',   v_period.period_label,
    'expected',       v_period.expected_amount,
    'paid',           v_paid,
    'balance',        greatest(v_period.expected_amount - v_paid, 0),
    'status',         v_status
  );
end;
$$;

-- ===========================================================================
-- LOANS
-- ===========================================================================

-- Deterministic loan pricing. The app previews with the same numbers the
-- database will commit, so the member never sees one figure and is charged
-- another.
create or replace function quote_loan(
  p_product_id    uuid,
  p_principal     numeric,
  p_period_months integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p loan_products;
  v_interest numeric(16,2);
  v_fee      numeric(16,2);
  v_total    numeric(16,2);
  v_install  numeric(16,2);
  v_years    numeric;
begin
  select * into p from loan_products where id = p_product_id and is_active;
  if not found then
    raise exception 'Loan product is not available.' using errcode = 'no_data_found';
  end if;

  if p_principal < p.min_amount or p_principal > p.max_amount then
    raise exception 'Amount must be between UGX % and UGX %.',
      to_char(p.min_amount, 'FM999,999,999'), to_char(p.max_amount, 'FM999,999,999')
      using errcode = 'check_violation';
  end if;

  if p_period_months < p.min_period_months or p_period_months > p.max_period_months then
    raise exception 'Repayment period must be between % and % months.',
      p.min_period_months, p.max_period_months using errcode = 'check_violation';
  end if;

  v_years := p_period_months::numeric / 12.0;

  if p.interest_method = 'flat' then
    v_interest := round(p_principal * (p.interest_rate / 100.0) * v_years, 2);
  else
    -- Reducing balance, equal installments: standard annuity.
    declare
      r numeric := (p.interest_rate / 100.0) / 12.0;
    begin
      if r = 0 then
        v_install  := round(p_principal / p_period_months, 2);
        v_interest := 0;
      else
        v_install  := round(p_principal * r / (1 - power(1 + r, -p_period_months)), 2);
        v_interest := round(v_install * p_period_months - p_principal, 2);
      end if;
    end;
  end if;

  v_fee   := round(p_principal * (p.processing_fee_pct / 100.0), 2);
  v_total := p_principal + v_interest;

  if v_install is null then
    v_install := round(v_total / p_period_months, 2);
  end if;

  return jsonb_build_object(
    'product_id',        p.id,
    'product_name',      p.name,
    'principal',         p_principal,
    'interest_rate',     p.interest_rate,
    'interest_method',   p.interest_method,
    'interest_amount',   v_interest,
    'processing_fee',    v_fee,
    'total_payable',     v_total,
    'period_months',     p_period_months,
    'installment_amount', v_install,
    'net_disbursed',     p_principal - v_fee,
    'min_guarantors',    p.min_guarantors
  );
end;
$$;

create or replace function apply_for_loan(
  p_member_id     uuid,
  p_product_id    uuid,
  p_principal     numeric,
  p_period_months integer,
  p_purpose       text,
  p_purpose_category text default null,
  p_guarantors    jsonb default '[]'::jsonb,   -- [{"member_id":"...","amount":123}]
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q      jsonb;
  v_loan   loans;
  v_member members;
  v_g      jsonb;
  v_gmember members;
  v_count  integer;
  v_min_g  integer;
begin
  -- A member may apply for themselves; staff may apply on their behalf.
  if not (has_role('super_admin', 'manager', 'loan_officer')
          or current_member_id() = p_member_id) then
    raise exception 'You do not have permission to apply on behalf of this member.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'active' then
    raise exception 'Only active members may apply for a loan.' using errcode = 'check_violation';
  end if;

  -- Guard against a resubmitted wizard creating twin applications.
  if p_idempotency_key is not null then
    select * into v_loan from loans
     where member_id = p_member_id
       and created_at > now() - interval '1 day'
       and review_notes = 'idem:' || p_idempotency_key;
    if found then
      return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no,
                                'status', v_loan.status, 'duplicate', true);
    end if;
  end if;

  if exists (select 1 from loans
              where member_id = p_member_id
                and status in ('applied', 'under_review', 'approved', 'disbursed', 'active')) then
    raise exception 'This member already has a loan in progress. Close it before applying again.'
      using errcode = 'check_violation';
  end if;

  v_q := quote_loan(p_product_id, p_principal, p_period_months);
  v_min_g := (v_q ->> 'min_guarantors')::integer;

  insert into loans (loan_no, member_id, product_id, principal, interest_rate,
                     interest_method, interest_amount, processing_fee, total_payable,
                     period_months, installment_amount, purpose, purpose_category,
                     status, created_by, review_notes)
  values (next_document_no('LN', 5), p_member_id, p_product_id, p_principal,
          (v_q ->> 'interest_rate')::numeric, v_q ->> 'interest_method',
          (v_q ->> 'interest_amount')::numeric, (v_q ->> 'processing_fee')::numeric,
          (v_q ->> 'total_payable')::numeric, p_period_months,
          (v_q ->> 'installment_amount')::numeric, p_purpose, p_purpose_category,
          'applied', auth.uid(),
          case when p_idempotency_key is null then null else 'idem:' || p_idempotency_key end)
  returning * into v_loan;

  -- Guarantors must be active members, and never the borrower.
  v_count := 0;
  for v_g in select * from jsonb_array_elements(coalesce(p_guarantors, '[]'::jsonb))
  loop
    select * into v_gmember from members where id = (v_g ->> 'member_id')::uuid;
    if not found then
      raise exception 'Guarantor is not a registered member.' using errcode = 'no_data_found';
    end if;
    if v_gmember.status <> 'active' then
      raise exception 'Guarantor % is not an active member.', v_gmember.full_name
        using errcode = 'check_violation';
    end if;
    if v_gmember.id = p_member_id then
      raise exception 'A member cannot guarantee their own loan.' using errcode = 'check_violation';
    end if;

    insert into loan_guarantors (loan_id, member_id, guaranteed_amount, status)
    values (v_loan.id, v_gmember.id, (v_g ->> 'amount')::numeric, 'pending');

    v_count := v_count + 1;
  end loop;

  if v_count < v_min_g then
    raise exception 'This loan requires at least % guarantor(s).', v_min_g
      using errcode = 'check_violation';
  end if;

  perform write_audit('loan.applied', 'Loans', v_loan.id::text,
    format('%s applied for %s of UGX %s', v_member.full_name, v_q ->> 'product_name',
           to_char(p_principal, 'FM999,999,999')),
    null, to_jsonb(v_loan), p_purpose);

  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no,
                            'status', v_loan.status, 'quote', v_q, 'duplicate', false);
end;
$$;

create or replace function set_loan_status(
  p_loan_id uuid,
  p_status  loan_status,
  p_reason  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_old  jsonb;
begin
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_loan);

  -- Who may move the loan to which state.
  case p_status
    when 'under_review' then perform assert_role('super_admin', 'manager', 'loan_officer');
    when 'approved'     then perform assert_role('super_admin', 'manager');
    when 'rejected'     then perform assert_role('super_admin', 'manager', 'loan_officer');
    else raise exception 'Use the dedicated function for the % state.', p_status
           using errcode = 'check_violation';
  end case;

  -- Legal transitions only.
  if p_status = 'under_review' and v_loan.status <> 'applied' then
    raise exception 'Only an applied loan can be moved to review.' using errcode = 'check_violation';
  end if;
  if p_status = 'approved' and v_loan.status not in ('applied', 'under_review') then
    raise exception 'Only a loan under review can be approved.' using errcode = 'check_violation';
  end if;
  if p_status = 'rejected' and v_loan.status not in ('applied', 'under_review') then
    raise exception 'Only a pending loan can be rejected.' using errcode = 'check_violation';
  end if;
  if p_status = 'rejected' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A rejection reason is required.' using errcode = 'check_violation';
  end if;

  update loans
     set status      = p_status,
         reviewed_on = case when p_status = 'under_review' then current_date else reviewed_on end,
         approved_on = case when p_status = 'approved'     then current_date else approved_on end,
         approved_by = case when p_status = 'approved'     then auth.uid()   else approved_by end,
         rejected_on = case when p_status = 'rejected'     then current_date else rejected_on end,
         rejected_by = case when p_status = 'rejected'     then auth.uid()   else rejected_by end,
         rejection_reason = case when p_status = 'rejected' then p_reason else rejection_reason end,
         review_notes = case when p_status = 'under_review' then coalesce(p_reason, review_notes)
                             else review_notes end
   where id = p_loan_id
   returning * into v_loan;

  perform write_audit('loan.' || p_status::text, 'Loans', v_loan.id::text,
    format('Loan %s moved to %s', v_loan.loan_no, replace(p_status::text, '_', ' ')),
    v_old, to_jsonb(v_loan), p_reason);

  -- Tell the member.
  insert into notifications (user_id, title, body, kind, link)
  select m.user_id,
         case when p_status = 'approved' then 'Loan approved'
              when p_status = 'rejected' then 'Loan application declined'
              else 'Loan under review' end,
         case when p_status = 'approved'
                then format('Your loan %s for UGX %s has been approved.', v_loan.loan_no,
                            to_char(v_loan.principal, 'FM999,999,999'))
              when p_status = 'rejected'
                then format('Your loan %s was not approved. Reason: %s', v_loan.loan_no, p_reason)
              else format('Your loan %s is being reviewed.', v_loan.loan_no) end,
         case when p_status = 'approved' then 'success'
              when p_status = 'rejected' then 'error' else 'info' end,
         '/loans/' || v_loan.id
    from members m
   where m.id = v_loan.member_id and m.user_id is not null;

  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'status', v_loan.status);
end;
$$;

create or replace function disburse_loan(
  p_loan_id uuid,
  p_method  payment_method default 'cash',
  p_disbursed_on date default current_date,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan   loans;
  v_old    jsonb;
  v_txn    transactions;
  v_member members;
  v_first  date;
  v_i      integer;
  v_prin   numeric(16,2);
  v_int    numeric(16,2);
  v_fee_txn transactions;
  v_inc_cat uuid;
begin
  perform assert_role('super_admin', 'manager');

  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_loan);

  -- The FOR UPDATE lock above plus this check is what prevents a double
  -- disbursement from two simultaneous clicks.
  if v_loan.status <> 'approved' then
    raise exception 'Only an approved loan can be disbursed (this one is %).', v_loan.status
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = v_loan.member_id;

  v_txn := post_transaction(
    v_loan.member_id, 'loan_disbursement', v_loan.principal, p_method, p_disbursed_on,
    format('Disbursement of loan %s', v_loan.loan_no), p_idempotency_key
  );
  update transactions set loan_id = v_loan.id where id = v_txn.id;

  -- Processing fee is SACCO income, booked at disbursement.
  if v_loan.processing_fee > 0 then
    v_fee_txn := post_transaction(
      v_loan.member_id, 'fee', v_loan.processing_fee, 'internal', p_disbursed_on,
      format('Processing fee on loan %s', v_loan.loan_no),
      case when p_idempotency_key is null then null else p_idempotency_key || ':fee' end
    );
    update transactions set loan_id = v_loan.id where id = v_fee_txn.id;

    select id into v_inc_cat from income_categories where name = 'Service charges';
    if v_inc_cat is not null then
      insert into income_entries (category_id, amount, description, received_on, method,
                                  member_id, loan_id, transaction_id, recorded_by)
      values (v_inc_cat, v_loan.processing_fee,
              format('Processing fee on loan %s', v_loan.loan_no),
              coalesce(p_disbursed_on, current_date), 'internal',
              v_loan.member_id, v_loan.id, v_fee_txn.id, auth.uid())
      on conflict do nothing;
    end if;
  end if;

  v_first := (coalesce(p_disbursed_on, current_date) + interval '1 month')::date;

  update loans
     set status       = 'active',
         disbursed_on = coalesce(p_disbursed_on, current_date),
         disbursed_by = auth.uid(),
         first_due_on = v_first
   where id = p_loan_id
   returning * into v_loan;

  -- Build the amortisation schedule once, at disbursement.
  delete from loan_schedule where loan_id = v_loan.id;
  v_prin := round(v_loan.principal / v_loan.period_months, 2);
  v_int  := round(v_loan.interest_amount / v_loan.period_months, 2);
  for v_i in 1 .. v_loan.period_months loop
    insert into loan_schedule (loan_id, installment_no, due_on, principal_due, interest_due, total_due)
    values (
      v_loan.id, v_i,
      (coalesce(p_disbursed_on, current_date) + (v_i || ' month')::interval)::date,
      -- Last installment absorbs rounding so the schedule sums exactly.
      case when v_i < v_loan.period_months then v_prin
           else v_loan.principal - v_prin * (v_loan.period_months - 1) end,
      case when v_i < v_loan.period_months then v_int
           else v_loan.interest_amount - v_int * (v_loan.period_months - 1) end,
      case when v_i < v_loan.period_months then v_prin + v_int
           else v_loan.total_payable - (v_prin + v_int) * (v_loan.period_months - 1) end
    );
  end loop;

  perform write_audit('loan.disbursed', 'Loans', v_loan.id::text,
    format('Loan %s of UGX %s disbursed to %s', v_loan.loan_no,
           to_char(v_loan.principal, 'FM999,999,999'), v_member.full_name),
    v_old, to_jsonb(v_loan), null);

  insert into notifications (user_id, title, body, kind, link)
  select v_member.user_id, 'Loan disbursed',
         format('UGX %s has been disbursed. Your first payment of UGX %s is due %s.',
                to_char(v_loan.principal, 'FM999,999,999'),
                to_char(v_loan.installment_amount, 'FM999,999,999'),
                to_char(v_first, 'DD Mon YYYY')),
         'success', '/loans/' || v_loan.id
   where v_member.user_id is not null;

  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no,
                            'status', v_loan.status, 'reference', v_txn.reference,
                            'transaction_id', v_txn.id, 'first_due_on', v_first);
end;
$$;

create or replace function record_loan_repayment(
  p_loan_id uuid,
  p_amount  numeric,
  p_paid_on date default current_date,
  p_method  payment_method default 'cash',
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan       loans;
  v_old        jsonb;
  v_member     members;
  v_txn        transactions;
  v_rep        loan_repayments;
  v_paid       numeric(16,2);
  v_outstanding numeric(16,2);
  v_int_paid   numeric(16,2);
  v_int_part   numeric(16,2);
  v_prin_part  numeric(16,2);
  v_next_due   date;
  v_completed  boolean := false;
  v_inc_cat    uuid;
begin
  perform assert_role('super_admin', 'manager', 'cashier', 'loan_officer');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Repayment amount must be greater than zero.' using errcode = 'check_violation';
  end if;

  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_loan);

  if v_loan.status not in ('active', 'disbursed', 'defaulted') then
    raise exception 'Repayments can only be recorded against an active loan (this one is %).',
      v_loan.status using errcode = 'check_violation';
  end if;

  select coalesce(sum(r.amount), 0) into v_paid
    from loan_repayments r
    join transactions t on t.id = r.transaction_id
   where r.loan_id = p_loan_id and t.status = 'posted';

  v_outstanding := v_loan.total_payable - v_paid;

  if p_amount > v_outstanding + 0.005 then
    raise exception 'Payment of UGX % exceeds the outstanding balance of UGX %.',
      to_char(p_amount, 'FM999,999,999'), to_char(v_outstanding, 'FM999,999,999')
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = v_loan.member_id;

  v_txn := post_transaction(
    v_loan.member_id, 'loan_repayment', p_amount, p_method, p_paid_on,
    format('Repayment on loan %s', v_loan.loan_no), p_idempotency_key
  );

  select * into v_rep from loan_repayments where transaction_id = v_txn.id;
  if not found then
    update transactions set loan_id = v_loan.id where id = v_txn.id;

    -- Interest first, then principal - the standard SACCO allocation order.
    select coalesce(sum(r.interest_portion), 0) into v_int_paid
      from loan_repayments r
      join transactions t on t.id = r.transaction_id
     where r.loan_id = p_loan_id and t.status = 'posted';

    v_int_part  := least(p_amount, greatest(v_loan.interest_amount - v_int_paid, 0));
    v_prin_part := p_amount - v_int_part;

    insert into loan_repayments (loan_id, member_id, amount, principal_portion,
                                 interest_portion, paid_on, method, transaction_id, recorded_by)
    values (p_loan_id, v_loan.member_id, p_amount, v_prin_part, v_int_part,
            coalesce(p_paid_on, current_date), p_method, v_txn.id, auth.uid())
    returning * into v_rep;

    -- Interest actually collected is SACCO income.
    if v_int_part > 0 then
      select id into v_inc_cat from income_categories where name = 'Loan interest';
      if v_inc_cat is not null then
        insert into income_entries (category_id, amount, description, received_on, method,
                                    member_id, loan_id, transaction_id, recorded_by)
        values (v_inc_cat, v_int_part,
                format('Interest collected on loan %s', v_loan.loan_no),
                coalesce(p_paid_on, current_date), p_method,
                v_loan.member_id, v_loan.id, v_txn.id, auth.uid());
      end if;
    end if;

    v_paid        := v_paid + p_amount;
    v_outstanding := v_loan.total_payable - v_paid;
    v_completed   := v_outstanding <= 0.005;

    update loans
       set status       = case when v_completed then 'completed'::loan_status else 'active'::loan_status end,
           completed_on = case when v_completed then coalesce(p_paid_on, current_date) else null end
     where id = p_loan_id;

    -- Release guarantors once the debt is cleared.
    if v_completed then
      update loan_guarantors set status = 'released', responded_on = current_date
       where loan_id = p_loan_id and status in ('pending', 'accepted');
    end if;

    perform write_audit('loan.repayment', 'Loans', v_rep.id::text,
      format('Repayment of UGX %s on loan %s by %s', to_char(p_amount, 'FM999,999,999'),
             v_loan.loan_no, v_member.full_name),
      v_old, to_jsonb(v_rep), null);
  else
    v_completed   := (v_loan.total_payable - v_paid) <= 0.005;
    v_outstanding := v_loan.total_payable - v_paid;
  end if;

  select min(s.due_on) into v_next_due
    from loan_schedule s
   where s.loan_id = p_loan_id
     and s.due_on > coalesce(p_paid_on, current_date);

  return jsonb_build_object(
    'transaction_id', v_txn.id,
    'reference',      v_txn.reference,
    'repayment_id',   v_rep.id,
    'amount',         p_amount,
    'total_paid',     v_paid,
    'outstanding',    greatest(v_outstanding, 0),
    'completed',      v_completed,
    'next_due_on',    v_next_due
  );
end;
$$;

-- ===========================================================================
-- DEPOSITS / WITHDRAWALS
-- ===========================================================================
create or replace function record_cash_movement(
  p_member_id uuid,
  p_type      txn_type,          -- 'deposit' | 'withdrawal'
  p_amount    numeric,
  p_method    payment_method default 'cash',
  p_occurred_on date default current_date,
  p_description text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn     transactions;
  v_member  members;
  v_balance numeric(16,2);
begin
  perform assert_role('super_admin', 'manager', 'cashier');

  if p_type not in ('deposit', 'withdrawal') then
    raise exception 'Only deposits and withdrawals are handled here.' using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if p_type = 'withdrawal' then
    -- Withdrawals are settled against savings only; share capital is not liquid.
    select coalesce(sum(case when t.type in ('weekly_savings', 'monthly_savings', 'deposit')
                             then t.amount else -t.amount end), 0)
      into v_balance
      from transactions t
     where t.member_id = p_member_id
       and t.status = 'posted'
       and t.type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal');

    if p_amount > v_balance then
      raise exception 'Withdrawal of UGX % exceeds the available savings balance of UGX %.',
        to_char(p_amount, 'FM999,999,999'), to_char(v_balance, 'FM999,999,999')
        using errcode = 'check_violation';
    end if;
  end if;

  v_txn := post_transaction(p_member_id, p_type, p_amount, p_method, p_occurred_on,
                            coalesce(p_description, initcap(p_type::text)), p_idempotency_key);

  perform write_audit('cash.' || p_type::text, 'Financials', v_txn.id::text,
    format('%s of UGX %s for %s', initcap(p_type::text),
           to_char(p_amount, 'FM999,999,999'), v_member.full_name),
    null, to_jsonb(v_txn), p_description);

  return jsonb_build_object('transaction_id', v_txn.id, 'reference', v_txn.reference,
                            'amount', p_amount, 'type', p_type);
end;
$$;

-- ===========================================================================
-- INCOME / EXPENSES
-- ===========================================================================
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
  perform assert_role('super_admin', 'manager', 'cashier');

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
  perform assert_role('super_admin', 'manager', 'cashier');

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

create or replace function approve_expense(
  p_expense_id uuid,
  p_approve    boolean,
  p_reason     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row expense_entries;
  v_old jsonb;
  v_txn transactions;
begin
  perform assert_role('super_admin', 'manager');

  select * into v_row from expense_entries where id = p_expense_id for update;
  if not found then
    raise exception 'Expense not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_row);

  if v_row.approval <> 'pending' then
    raise exception 'This expense has already been %.', v_row.approval
      using errcode = 'check_violation';
  end if;

  if p_approve then
    v_txn := post_transaction(null, 'expense', v_row.amount, v_row.method, v_row.spent_on,
                              v_row.description, 'expense:' || v_row.id::text);
    update transactions set expense_id = v_row.id where id = v_txn.id;

    update expense_entries
       set approval = 'approved', approved_by = auth.uid(), approved_at = now(),
           transaction_id = v_txn.id
     where id = p_expense_id
     returning * into v_row;
  else
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'A reason is required when rejecting an expense.' using errcode = 'check_violation';
    end if;
    update expense_entries
       set approval = 'rejected', approved_by = auth.uid(), approved_at = now()
     where id = p_expense_id
     returning * into v_row;
  end if;

  perform write_audit('expense.' || v_row.approval::text, 'Financials', v_row.id::text,
    format('Expense of UGX %s %s', to_char(v_row.amount, 'FM999,999,999'), v_row.approval),
    v_old, to_jsonb(v_row), p_reason);

  return jsonb_build_object('expense_id', v_row.id, 'approval', v_row.approval,
                            'reference', v_txn.reference);
end;
$$;

-- ===========================================================================
-- REVERSALS - the only sanctioned way to "undo" money
-- ===========================================================================
create or replace function reverse_transaction(
  p_transaction_id uuid,
  p_reason         text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig transactions;
  v_rev  transactions;
  v_period_id uuid;
  v_paid numeric(16,2);
  v_exp  numeric(16,2);
begin
  perform assert_role('super_admin', 'manager');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reverse a transaction.' using errcode = 'check_violation';
  end if;

  select * into v_orig from transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Transaction not found.' using errcode = 'no_data_found';
  end if;
  if v_orig.status <> 'posted' then
    raise exception 'Transaction % is already %.', v_orig.reference, v_orig.status
      using errcode = 'check_violation';
  end if;

  insert into transactions (reference, member_id, type, status, amount, method,
                            occurred_on, description, loan_id, savings_id, share_lot_id,
                            income_id, expense_id, reverses_id, reversal_reason, recorded_by)
  values (next_document_no('TX'), v_orig.member_id, v_orig.type, 'reversal', v_orig.amount,
          v_orig.method, current_date,
          'Reversal of ' || v_orig.reference, v_orig.loan_id, v_orig.savings_id,
          v_orig.share_lot_id, v_orig.income_id, v_orig.expense_id,
          v_orig.id, p_reason, auth.uid())
  returning * into v_rev;

  update transactions
     set status = 'reversed', reversed_by_id = v_rev.id, reversal_reason = p_reason
   where id = v_orig.id;

  -- Roll the derived aggregates back in step with the ledger.
  if v_orig.type in ('weekly_savings', 'monthly_savings') and v_orig.savings_id is not null then
    select period_id into v_period_id from savings_payments where id = v_orig.savings_id;
    if v_period_id is not null then
      select coalesce(sum(sp.amount), 0) into v_paid
        from savings_payments sp
        join transactions t on t.id = sp.transaction_id
       where sp.period_id = v_period_id and t.status = 'posted';

      select expected_amount into v_exp from savings_periods where id = v_period_id;

      update savings_periods
         set paid_amount = v_paid,
             status = case
               when v_exp > 0 and v_paid >= v_exp then 'paid'
               when v_paid > 0 then 'partial'
               when v_exp = 0 then 'pending'
               when period_end < current_date then 'missed'
               else 'pending' end
       where id = v_period_id;
    end if;
  end if;

  if v_orig.type = 'loan_repayment' and v_orig.loan_id is not null then
    update loans
       set status = case when status = 'completed' then 'active'::loan_status else status end,
           completed_on = case when status = 'completed' then null else completed_on end
     where id = v_orig.loan_id;
  end if;

  perform write_audit('transaction.reversed', 'Financials', v_orig.id::text,
    format('Transaction %s (UGX %s) reversed by %s', v_orig.reference,
           to_char(v_orig.amount, 'FM999,999,999'), v_rev.reference),
    to_jsonb(v_orig), to_jsonb(v_rev), p_reason);

  return jsonb_build_object('original_reference', v_orig.reference,
                            'reversal_reference', v_rev.reference,
                            'reversal_id', v_rev.id);
end;
$$;

-- ===========================================================================
-- GUARANTORS
-- ===========================================================================
create or replace function set_guarantor_status(
  p_guarantor_id uuid,
  p_status       guarantor_status,
  p_note         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g    loan_guarantors;
  v_old  jsonb;
  v_loan loans;
begin
  select * into v_g from loan_guarantors where id = p_guarantor_id for update;
  if not found then
    raise exception 'Guarantor record not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_g);

  -- Staff may set any status; the guaranteeing member may only accept/decline
  -- their own pending request.
  if not has_role('super_admin', 'manager', 'loan_officer') then
    if current_member_id() <> v_g.member_id then
      raise exception 'You may only respond to your own guarantee requests.'
        using errcode = 'insufficient_privilege';
    end if;
    if p_status not in ('accepted', 'declined') then
      raise exception 'You may only accept or decline a guarantee request.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select * into v_loan from loans where id = v_g.loan_id;
  if p_status = 'released' and v_loan.status not in ('completed', 'rejected', 'written_off') then
    raise exception 'A guarantor cannot be released while the loan is still %.', v_loan.status
      using errcode = 'check_violation';
  end if;

  update loan_guarantors
     set status = p_status, responded_on = current_date, note = coalesce(p_note, note)
   where id = p_guarantor_id
   returning * into v_g;

  perform write_audit('guarantor.' || p_status::text, 'Loans', v_g.id::text,
    format('Guarantor on loan %s marked %s', v_loan.loan_no, p_status), v_old, to_jsonb(v_g), p_note);

  return jsonb_build_object('guarantor_id', v_g.id, 'status', v_g.status);
end;
$$;

create or replace function remove_guarantor(p_guarantor_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g    loan_guarantors;
  v_loan loans;
  v_left integer;
  v_min  integer;
begin
  perform assert_role('super_admin', 'manager', 'loan_officer');

  select * into v_g from loan_guarantors where id = p_guarantor_id;
  if not found then
    raise exception 'Guarantor record not found.' using errcode = 'no_data_found';
  end if;

  select * into v_loan from loans where id = v_g.loan_id for update;

  -- Once money is out the door the guarantee is a live obligation.
  if v_loan.status in ('disbursed', 'active', 'defaulted') then
    raise exception 'Guarantors cannot be removed from a loan that has been disbursed.'
      using errcode = 'check_violation';
  end if;

  select p.min_guarantors into v_min from loan_products p where p.id = v_loan.product_id;
  select count(*) - 1 into v_left from loan_guarantors where loan_id = v_g.loan_id;

  if v_left < v_min then
    raise exception 'Loan %s must keep at least % guarantor(s).', v_loan.loan_no, v_min
      using errcode = 'check_violation';
  end if;

  delete from loan_guarantors where id = p_guarantor_id;

  perform write_audit('guarantor.removed', 'Loans', p_guarantor_id::text,
    format('Guarantor removed from loan %s', v_loan.loan_no), to_jsonb(v_g), null, p_reason);

  return jsonb_build_object('removed', true);
end;
$$;

-- ===========================================================================
-- MEMBER ONBOARDING
-- ===========================================================================
create or replace function create_member(
  p_full_name text,
  p_phone     text,
  p_national_id text default null,
  p_email     text default null,
  p_address   text default null,
  p_date_of_birth date default null,
  p_gender    text default null,
  p_occupation text default null,
  p_next_of_kin_name text default null,
  p_next_of_kin_phone text default null,
  p_next_of_kin_relation text default null,
  p_photo_url text default null,
  p_user_id   uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member members;
begin
  perform assert_role('super_admin', 'manager', 'loan_officer', 'cashier');

  insert into members (member_no, user_id, full_name, phone, email, national_id,
                       date_of_birth, gender, address, occupation,
                       next_of_kin_name, next_of_kin_phone, next_of_kin_relation,
                       photo_url, created_by)
  values (next_document_no('M', 7), p_user_id, p_full_name, p_phone, nullif(p_email, ''),
          nullif(p_national_id, ''), p_date_of_birth, p_gender, p_address, p_occupation,
          p_next_of_kin_name, p_next_of_kin_phone, p_next_of_kin_relation,
          p_photo_url, auth.uid())
  returning * into v_member;

  perform write_audit('member.created', 'Members', v_member.id::text,
    format('Member %s (%s) registered', v_member.full_name, v_member.member_no),
    null, to_jsonb(v_member), null);

  return jsonb_build_object('member_id', v_member.id, 'member_no', v_member.member_no);
end;
$$;

create or replace function set_member_status(
  p_member_id uuid,
  p_status    member_status,
  p_reason    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member members;
  v_old    jsonb;
  v_out    numeric(16,2);
begin
  perform assert_role('super_admin', 'manager');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when changing a member''s status.'
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_member);

  if p_status in ('inactive', 'exited') then
    select coalesce(sum(l.total_payable), 0)
             - coalesce((select sum(r.amount) from loan_repayments r
                          join transactions t on t.id = r.transaction_id
                         where r.loan_id = l.id and t.status = 'posted'), 0)
      into v_out
      from loans l
     where l.member_id = p_member_id and l.status in ('active', 'disbursed', 'defaulted');

    if coalesce(v_out, 0) > 0 then
      raise exception 'This member still owes UGX %. Settle the loan before deactivating.',
        to_char(v_out, 'FM999,999,999') using errcode = 'check_violation';
    end if;
  end if;

  update members set status = p_status where id = p_member_id returning * into v_member;

  perform write_audit('member.' || p_status::text, 'Members', v_member.id::text,
    format('Member %s marked %s', v_member.member_no, p_status),
    v_old, to_jsonb(v_member), p_reason);

  return jsonb_build_object('member_id', v_member.id, 'status', v_member.status);
end;
$$;
