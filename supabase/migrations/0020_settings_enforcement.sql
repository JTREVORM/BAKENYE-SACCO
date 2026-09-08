-- ===========================================================================
-- BUD-SACCO - 0020 - Making the limits real
--
-- 0015 gave the SACCO somewhere to record its deposit, withdrawal and cash
-- limits, and 0016 gave it a way to change them. This is the half that makes
-- them mean anything: the counter functions now read them and refuse a
-- transaction that breaks one.
--
-- Without this, a manager could set "largest single withdrawal: UGX 500,000",
-- see it saved, see it audited - and watch a cashier pay out two million. A
-- setting that nothing enforces is worse than no setting at all, because it
-- looks like a control.
--
-- Every limit treats zero as "no limit", consistently, so a SACCO that does not
-- want a ceiling simply leaves it at zero and nothing here fires.
--
-- The rules are checked in the database rather than only in the forms, because
-- the form is a courtesy and this is the boundary. A cashier who reaches the
-- RPC another way gets the same answer.
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
as $fn$
declare
  v_txn     transactions;
  v_member  members;
  v_balance numeric(16,2);
  v_limit   numeric;
  v_min     numeric;
begin
  perform assert_role('super_admin', 'manager', 'cashier');

  if p_type not in ('deposit', 'withdrawal') then
    raise exception 'Only deposits and withdrawals are handled here.'
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  -- ---- Configured limits ------------------------------------------------
  --
  -- Checked before anything is written, and phrased so the cashier is told the
  -- rule as well as the refusal: "the smallest deposit is UGX 5,000" is
  -- actionable in a way that "invalid amount" is not.

  if p_type = 'deposit' then
    v_min := setting_number('financial.min_deposit');
    if v_min > 0 and p_amount < v_min then
      raise exception 'The smallest deposit this SACCO accepts is UGX %.',
        to_char(v_min, 'FM999,999,999') using errcode = 'check_violation';
    end if;
  else
    v_min := setting_number('financial.min_withdrawal');
    if v_min > 0 and p_amount < v_min then
      raise exception 'The smallest withdrawal this SACCO allows is UGX %.',
        to_char(v_min, 'FM999,999,999') using errcode = 'check_violation';
    end if;

    v_limit := setting_number('financial.max_withdrawal_per_transaction');
    if v_limit > 0 and p_amount > v_limit then
      raise exception 'A single withdrawal may not exceed UGX %. Split it or seek approval.',
        to_char(v_limit, 'FM999,999,999') using errcode = 'check_violation';
    end if;
  end if;

  -- Cash specifically, whichever direction it moves. Larger sums are expected
  -- to go through the bank or mobile money, where there is a second record.
  if p_method = 'cash' then
    v_limit := setting_number('financial.max_cash_transaction');
    if v_limit > 0 and p_amount > v_limit then
      raise exception
        'Cash transactions are limited to UGX %. Use a bank transfer or mobile money for more.',
        to_char(v_limit, 'FM999,999,999') using errcode = 'check_violation';
    end if;
  end if;

  -- ---- Balance ----------------------------------------------------------

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
$fn$;

grant execute on function record_cash_movement(uuid, txn_type, numeric, payment_method, date, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Savings minimums
--
-- `record_savings_payment` is defined twice in the history - 0002 wrote it and
-- 0011 replaced it to add the group-cycle handling. This wraps whichever is
-- current with the configured floor rather than copying its body again, which
-- would leave two versions of the collection logic to keep in step.
--
-- A BEFORE INSERT trigger on `savings_payments` is the smallest place that
-- catches every path into savings: the collection sheet, the individual record
-- form, and anything added later that writes a payment without knowing this
-- rule exists.
-- ---------------------------------------------------------------------------

create or replace function savings_payment_minimum_gate()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_kind savings_kind;
  v_min  numeric;
begin
  select kind into v_kind from savings_periods where id = new.period_id;
  if v_kind is null then
    return new;
  end if;

  v_min := case v_kind
             when 'weekly'  then setting_number('savings.min_weekly_amount')
             else                setting_number('savings.min_monthly_amount')
           end;

  if v_min > 0 and new.amount < v_min then
    raise exception 'The smallest % saving this SACCO accepts is UGX %.',
      v_kind, to_char(v_min, 'FM999,999,999') using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists savings_payments_respect_minimum on savings_payments;
create trigger savings_payments_respect_minimum
  before insert on savings_payments
  for each row execute function savings_payment_minimum_gate();

-- ---------------------------------------------------------------------------
-- Reversal reasons
--
-- `security.require_reason_on_reversal` ships on, which is what the system
-- already did unconditionally. Turning it off is now possible and is a decision
-- the SACCO records, rather than a behaviour only a developer could change.
-- ---------------------------------------------------------------------------

create or replace function reversal_reason_required()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(setting_bool('security.require_reason_on_reversal'), true);
$fn$;

grant execute on function reversal_reason_required() to authenticated;
