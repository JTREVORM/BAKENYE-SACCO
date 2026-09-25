-- ===========================================================================
-- BUD-SACCO - 0045 - The Membership Fees module
--
-- Savings and Shares each have a module of their own. The membership fee -
-- the one payment every member must make to join - had no home: it was
-- charged by `register_member()`, settled through the generic fee screen, and
-- visible nowhere as a thing the SACCO tracks. This migration gives it the
-- same standing as the other two.
--
-- WHAT WAS ALREADY TRUE, AND IS NOT CHANGED
--
-- The money architecture is already correct and is reused exactly as it
-- stands. A fee payment is a `transactions` row of type `fee`, it produces a
-- `receipts` row, one `fee_payment_lines` row per charge it settles, one
-- `income_entries` row per charge so the cashbook shows the income, and an
-- audit entry. None of that changes. No parallel ledger is created here.
--
-- WHAT WAS MISSING: PART PAYMENT
--
-- `post_fee_payment()` demanded the exact total: `p_amount_received` had to
-- equal the sum of the charges, every charge had to be `unpaid`, and the whole
-- charge was stamped `paid` through a single `paid_transaction_id`. A member
-- who brought half the fee could not be served at all.
--
-- The table that fixes this already exists. `fee_payment_lines` records what a
-- payment settled, charge by charge, and nothing stopped a charge from
-- appearing on more than one of them - the old code simply never wrote a line
-- for less than the whole charge. So part payment needs no new money table:
-- the allocation lines ARE the payment history, and a charge's paid amount is
-- their sum. `recompute_member_fee()` below owns that arithmetic, in the same
-- way `recompute_savings_period()` (0039) owns a savings month's. No counter
-- is incremented anywhere.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It deletes nothing, re-prices nothing, and re-posts nothing. Every existing
-- transaction, receipt, fee payment line, income entry and audit row is left
-- exactly as recorded. `member_fees.amount` stays the snapshot of what a
-- member was asked to pay on the day they were asked - a later change to the
-- fee never rewrites a charge already raised. Section 8 raises NEW charges for
-- the difference where the SACCO has decided a member must reach the current
-- fee; it never edits an old one.
-- ===========================================================================

-- ===========================================================================
-- 1. A CHARGE CAN NOW BE PART PAID
--
-- `partial` joins the three states a charge could be in. It means: money has
-- been received against this charge, and it is not yet settled. It is derived,
-- never typed in.
-- ===========================================================================
alter table member_fees drop constraint if exists member_fees_status_check;
alter table member_fees add constraint member_fees_status_check
  check (status in ('unpaid', 'partial', 'paid', 'waived'));

-- `paid_transaction_id` now means "the payment that finished this charge",
-- which is what it always meant for a charge settled in one go. A part-paid
-- charge has no such payment yet, so it stays null until one arrives. The
-- existing guard - a charge cannot read `paid` without naming that payment -
-- is therefore still exactly right and is left alone.
comment on column member_fees.paid_transaction_id is
  'The payment that settled this charge in full. Null while the charge is unpaid or part paid. Every payment against the charge, including the last one, is recorded in fee_payment_lines; this column names only the one that closed it.';

comment on column member_fees.amount is
  'What this member was asked to pay, copied from the fee at the moment of charging. A later change to fees.amount never rewrites it: it is the record of what was asked on the day. Where the SACCO decides a member must reach a new, higher fee, an additional charge is raised for the difference.';

comment on column member_fees.status is
  'Derived by recompute_member_fee() from the posted payment lines: unpaid (nothing received), partial (some received, not all), paid (settled in full). A charge waived by a manager stays waived.';

create index if not exists member_fees_owing_idx
  on member_fees (member_id) where status in ('unpaid', 'partial');

create index if not exists fee_payment_lines_charge_idx
  on fee_payment_lines (member_fee_id);

-- ===========================================================================
-- 2. THE ONE OWNER OF A CHARGE'S ARITHMETIC
--
-- Paid is the sum of the allocation lines whose transaction is still posted.
-- A reversed payment drops out of the sum the moment it is reversed, with no
-- second code path needed to unwind it - the same property that makes savings
-- reversals safe.
-- ===========================================================================
create or replace function member_fee_paid(p_charge_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(fpl.amount), 0)::numeric(16,2)
    from fee_payment_lines fpl
    join transactions t on t.id = fpl.transaction_id
   where fpl.member_fee_id = p_charge_id
     and t.status = 'posted'
     -- A payment being reversed right now must stop counting immediately.
     -- `reverse_transaction()` writes the reversal row before it flips the
     -- original to `reversed`, and the reversal trigger fires in between, so
     -- reading the original's status alone would still count money that is on
     -- its way out. Looking for the reversal that names it closes that window.
     and not exists (select 1 from transactions rv
                      where rv.reverses_id = t.id and rv.status = 'reversal');
$$;

revoke all on function member_fee_paid(uuid) from public, anon;
grant execute on function member_fee_paid(uuid) to authenticated;

comment on function member_fee_paid(uuid) is
  'What has actually been received against one charge: the sum of its allocation lines on payments that are still posted.';

create or replace function recompute_member_fee(p_charge_id uuid)
returns member_fees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge member_fees;
  v_paid   numeric(16,2);
  v_txn    uuid;
  v_on     date;
begin
  select * into v_charge from member_fees where id = p_charge_id for update;
  if not found then
    raise exception 'Fee charge not found.' using errcode = 'no_data_found';
  end if;

  -- A waived charge stays waived. A manager excused it in writing, and money
  -- arriving or being reversed afterwards does not overturn that decision.
  if v_charge.status = 'waived' then
    return v_charge;
  end if;

  v_paid := member_fee_paid(p_charge_id);

  if v_paid >= v_charge.amount then
    -- The payment that closed it: the last posted one, by date then by when
    -- it was recorded, so two payments on the same day still order sensibly.
    select t.id, t.occurred_on into v_txn, v_on
      from fee_payment_lines fpl
      join transactions t on t.id = fpl.transaction_id
     where fpl.member_fee_id = p_charge_id and t.status = 'posted'
     order by t.occurred_on desc, t.created_at desc
     limit 1;

    update member_fees
       set status = 'paid', paid_transaction_id = v_txn, paid_on = v_on, updated_at = now()
     where id = p_charge_id
    returning * into v_charge;
  else
    update member_fees
       set status = case when v_paid > 0 then 'partial' else 'unpaid' end,
           paid_transaction_id = null, paid_on = null, updated_at = now()
     where id = p_charge_id
    returning * into v_charge;
  end if;

  return v_charge;
end;
$$;

revoke all on function recompute_member_fee(uuid) from public, anon;

comment on function recompute_member_fee(uuid) is
  'The single owner of a fee charge''s paid amount and status, recomputed from the posted allocation lines. Called by the collection path and by the reversal trigger; never an incremented counter.';

-- ===========================================================================
-- 3. COLLECTING PART OF A FEE
--
-- Restated from 0030. The permission check, the account rules, the reference
-- rules, the idempotency, the receipt, the income entry and the audit line are
-- all 0030's and unchanged. What changes is the arithmetic in the middle:
--
--   * a charge that is already part paid can be paid again;
--   * `p_amount_received` may be less than the total outstanding;
--   * it may never be more - the counter does not take money the member does
--     not owe, and a cashier who types too much is told the balance;
--   * the money is allocated across the chosen charges, oldest first, each one
--     capped at what is still outstanding on it;
--   * `fee_payment_lines` records what this payment actually put against each
--     charge, which is what makes the member's payment history readable;
--   * the charges are then recomputed, never stamped directly.
-- ===========================================================================
create or replace function post_fee_payment(
  p_member_id       uuid,
  p_charge_ids      uuid[],
  p_account_id      uuid,
  p_method          payment_method,
  p_paid_on         date,
  p_reference       text,
  p_idempotency_key text,
  p_note            text,
  p_amount_received numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member    members;
  v_acct      financial_accounts;
  v_method    payment_method;
  v_ref       text := nullif(btrim(coalesce(p_reference, '')), '');
  v_on        date := coalesce(p_paid_on, current_date);
  v_ids       uuid[];
  v_count     integer;
  v_owing     numeric(16,2);
  v_take      numeric(16,2);
  v_left      numeric(16,2);
  v_slice     numeric(16,2);
  v_txn       transactions;
  v_desc      text;
  v_charge    record;
begin
  -- A retry of a payment already posted returns that payment.
  if p_idempotency_key is not null then
    select * into v_txn from transactions where idempotency_key = p_idempotency_key;
    if found then
      if exists (select 1 from fee_payment_lines where transaction_id = v_txn.id) then
        return fee_payment_result(v_txn.id, true);
      end if;
      raise exception 'This submission was already used for a different transaction. Reload the page and try again.'
        using errcode = 'unique_violation';
    end if;
  end if;

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status in ('archived', 'exited') then
    raise exception 'Fees cannot be taken from an archived member.' using errcode = 'check_violation';
  end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_charge_ids, '{}')) x where x is not null;
  if v_ids is null then
    raise exception 'Choose at least one fee to pay.' using errcode = 'check_violation', hint = 'fees';
  end if;

  perform 1 from member_fees where id = any (v_ids) for update;

  -- Every chosen charge must be this member's and still owe something. A
  -- charge that someone else settled while this form was open is refused
  -- rather than quietly skipped.
  select count(*), coalesce(sum(mf.amount - member_fee_paid(mf.id)), 0)
    into v_count, v_owing
    from member_fees mf
   where mf.id = any (v_ids) and mf.member_id = p_member_id
     and mf.status in ('unpaid', 'partial');

  if v_count <> cardinality(v_ids) then
    raise exception 'One or more of these fees is already paid, waived, or not this member''s. Reload and try again.'
      using errcode = 'check_violation', hint = 'fees';
  end if;
  if v_owing <= 0 then
    raise exception 'There is nothing outstanding on the fees chosen.'
      using errcode = 'check_violation', hint = 'fees';
  end if;

  -- Null means "settle them". A figure means "this is what the member brought".
  v_take := coalesce(p_amount_received, v_owing)::numeric(16,2);

  if v_take <= 0 then
    raise exception 'Enter an amount greater than zero.'
      using errcode = 'check_violation', hint = 'amount_received';
  end if;
  if v_take > v_owing then
    raise exception 'That is more than is outstanding. The balance on the fees chosen is %.', ugx(v_owing)
      using errcode = 'check_violation', hint = 'amount_received';
  end if;
  if v_on > current_date then
    raise exception 'A payment cannot be dated in the future.' using errcode = 'check_violation', hint = 'paid_on';
  end if;

  if p_account_id is null then
    raise exception 'Choose the account the money was received into.' using errcode = 'check_violation', hint = 'account_id';
  end if;
  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception 'Choose the account the money was received into.' using errcode = 'no_data_found', hint = 'account_id';
  end if;
  v_method := method_for_account_type(v_acct.account_type, p_method);
  v_acct   := assert_account_usable(p_account_id, v_method);

  if v_acct.account_type in ('merchant', 'bank') and v_ref is null then
    raise exception '%',
      case when v_acct.account_type = 'merchant'
           then 'Enter the mobile money transaction reference from the confirmation message.'
           else 'Enter the bank transfer or deposit slip reference.' end
      using errcode = 'check_violation', hint = 'reference';
  end if;
  if v_ref is not null and exists (
    select 1 from transactions where upper(external_ref) = upper(v_ref) and status <> 'reversed'
  ) then
    raise exception 'Reference % has already been recorded against another transaction.', v_ref
      using errcode = 'unique_violation', hint = 'reference';
  end if;

  select string_agg(fee_name, ', ' order by is_mandatory desc, fee_name) into v_desc
    from member_fees where id = any (v_ids);
  v_desc := coalesce(nullif(btrim(coalesce(p_note, '')), '') || ': ', '') || v_desc
            || ' - ' || v_member.full_name;

  -- The receiving account is handed to the posting trigger for this database
  -- transaction only, exactly as the collection screen does it.
  perform set_config('bnd.account_id', p_account_id::text, true);
  v_txn := post_transaction(p_member_id, 'fee', v_take, v_method, v_on, v_desc, p_idempotency_key);
  perform set_config('bnd.account_id', '', true);

  if v_ref is not null then
    update transactions set external_ref = v_ref where id = v_txn.id;
  end if;

  -- Allocate what was received, oldest charge first, each capped at its own
  -- outstanding balance. Mandatory charges are served before optional ones so
  -- that a part payment moves the member towards activation.
  v_left := v_take;
  for v_charge in
    select mf.id, mf.fee_id, mf.fee_name, (mf.amount - member_fee_paid(mf.id))::numeric(16,2) as owing
      from member_fees mf
     where mf.id = any (v_ids)
     order by mf.is_mandatory desc, mf.charged_on, mf.fee_name, mf.id
  loop
    exit when v_left <= 0;
    v_slice := least(v_left, v_charge.owing);
    continue when v_slice <= 0;

    insert into fee_payment_lines (transaction_id, member_fee_id, fee_id, description, amount)
    values (v_txn.id, v_charge.id, v_charge.fee_id, v_charge.fee_name, v_slice);

    -- The SACCO's income, one line per charge, so the cashbook shows the
    -- Membership Fee as the income it is - for the amount actually received,
    -- not the amount charged.
    insert into income_entries (category_id, amount, description, received_on, method,
                                member_id, transaction_id, recorded_by)
    select f.income_category_id, v_slice,
           v_charge.fee_name || ' - ' || v_member.full_name,
           v_on, v_method, p_member_id, v_txn.id, auth.uid()
      from fees f where f.id = v_charge.fee_id;

    v_left := v_left - v_slice;
  end loop;

  if v_left > 0 then
    raise exception 'Could not allocate % of this payment. Reload and try again.', ugx(v_left)
      using errcode = 'check_violation';
  end if;

  perform recompute_member_fee(id) from member_fees where id = any (v_ids);

  perform write_audit('fees.payment_recorded', 'Fees', v_txn.id::text,
    format('%s in fees received from %s (%s) into %s%s', ugx(v_take), v_member.full_name,
           v_member.member_no, v_acct.name, case when v_ref is not null then ', ref ' || v_ref else '' end),
    null,
    jsonb_build_object('transaction_id', v_txn.id, 'reference', v_txn.reference,
                       'receipt_no', (select receipt_no from receipts where transaction_id = v_txn.id),
                       'member_id', p_member_id, 'account', v_acct.name, 'method', v_method,
                       'external_ref', v_ref, 'amount', v_take,
                       'fees', (select jsonb_agg(jsonb_build_object(
                                         'fee', mf.fee_name, 'charged', mf.amount,
                                         'allocated', fpl.amount,
                                         'balance', mf.amount - member_fee_paid(mf.id),
                                         'status', mf.status))
                                  from fee_payment_lines fpl
                                  join member_fees mf on mf.id = fpl.member_fee_id
                                 where fpl.transaction_id = v_txn.id)),
    p_note);

  perform maybe_activate_member(p_member_id);

  return fee_payment_result(v_txn.id, false);
end;
$$;

revoke all on function post_fee_payment(uuid, uuid[], uuid, payment_method, date, text, text, text, numeric) from public, anon;

-- ===========================================================================
-- 4. ACTIVATION WAITS FOR THE WHOLE FEE
--
-- Restated from 0030 for one line. It used to add up charges still marked
-- `unpaid`, which under part payment would let a member who has paid UGX 5,000
-- of UGX 20,000 slip through: their charge reads `partial`, not `unpaid`.
-- What is owed is now the sum of the balances, so part payment counts for
-- exactly what it is - progress, not settlement.
-- ===========================================================================
create or replace function maybe_activate_member(p_member_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_member members;
  v_owing  numeric(16,2);
begin
  select * into v_member from members where id = p_member_id for update;
  if not found or v_member.status <> 'pending' then
    return false;
  end if;

  select coalesce(sum(mf.amount - member_fee_paid(mf.id)), 0) into v_owing
    from member_fees mf
   where mf.member_id = p_member_id
     and mf.status in ('unpaid', 'partial')
     and mf.is_mandatory and mf.charged_at_registration;

  if v_owing > 0 and setting_bool('members.activation_requires_fees') then
    return false;
  end if;

  update members set status = 'active', activated_at = now() where id = p_member_id;

  perform write_audit('member.activated', 'Members', p_member_id::text,
    format('Member %s (%s) activated: mandatory registration fees settled in full',
           v_member.full_name, v_member.member_no),
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'active'),
    'Mandatory registration fees settled');

  perform ensure_member_schedule(p_member_id, current_date);
  return true;
end;
$$;

-- ===========================================================================
-- 5. REVERSING A FEE PAYMENT
--
-- Restated from 0030. It used to find charges by `paid_transaction_id` and
-- stamp them back to `unpaid`, which is wrong once a charge can be settled by
-- more than one payment: reversing the second of two payments would erase the
-- first one's money too. It now recomputes every charge the reversed payment
-- touched, so each falls back to exactly what the remaining posted payments
-- support - `partial` if earlier money stands, `unpaid` if none does.
-- ===========================================================================
create or replace function transactions_fee_reversal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_member_id uuid;
  v_member    members;
begin
  if new.status <> 'reversal' or new.type <> 'fee' or new.reverses_id is null then
    return null;
  end if;

  -- Recompute every charge the reversed payment put money against. The lines
  -- themselves are kept: they are the record of a payment that happened and
  -- was then reversed, and they drop out of the sums on their own because
  -- their transaction is no longer posted.
  perform recompute_member_fee(mf.id)
     from member_fees mf
    where mf.id in (select fpl.member_fee_id from fee_payment_lines fpl
                     where fpl.transaction_id = new.reverses_id);

  for v_member_id in
    select distinct mf.member_id
      from member_fees mf
     where mf.id in (select fpl.member_fee_id from fee_payment_lines fpl
                      where fpl.transaction_id = new.reverses_id)
  loop
    select * into v_member from members where id = v_member_id for update;
    if v_member.status = 'active'
       and setting_bool('members.activation_requires_fees')
       and exists (select 1 from member_fees mf
                    where mf.member_id = v_member_id
                      and mf.status in ('unpaid', 'partial')
                      and mf.is_mandatory and mf.charged_at_registration) then
      update members set status = 'pending' where id = v_member_id;
      perform write_audit('member.returned_to_pending', 'Members', v_member_id::text,
        format('Member %s (%s) returned to pending: a registration fee payment was reversed',
               v_member.full_name, v_member.member_no),
        jsonb_build_object('status', 'active'), jsonb_build_object('status', 'pending'),
        new.reversal_reason);
    end if;
  end loop;

  return null;
end;
$$;

-- ===========================================================================
-- 6. THE READ MODELS
--
-- "The membership fee" is the set of charges that gate a member's activation:
-- mandatory, raised at registration. That is the same set `maybe_activate_member()`
-- consults, so what the module shows and what the system enforces can never
-- drift apart. Where the SACCO has raised a top-up to bring a member to the
-- current fee (section 8), that charge is in the same set and simply adds to
-- the member's required amount.
-- ===========================================================================
create or replace view member_membership_fee
with (security_invoker = true) as
  select m.id                                   as member_id,
         m.member_no,
         m.full_name,
         m.status                               as member_status,
         m.joined_on                            as registered_on,
         coalesce(sum(mf.amount) filter (where mf.status <> 'waived'), 0)::numeric(16,2)
                                                as required_amount,
         coalesce(sum(member_fee_paid(mf.id)), 0)::numeric(16,2)
                                                as paid_amount,
         greatest(coalesce(sum(mf.amount) filter (where mf.status <> 'waived'), 0)
                  - coalesce(sum(member_fee_paid(mf.id)), 0), 0)::numeric(16,2)
                                                as outstanding_amount,
         count(mf.id) filter (where mf.status = 'waived')::integer
                                                as waived_charges,
         count(mf.id)::integer                  as charges,
         case
           when count(mf.id) = 0 then 'none'
           when coalesce(sum(mf.amount) filter (where mf.status <> 'waived'), 0) = 0 then 'waived'
           when coalesce(sum(member_fee_paid(mf.id)), 0)
                >= coalesce(sum(mf.amount) filter (where mf.status <> 'waived'), 0) then 'paid'
           when coalesce(sum(member_fee_paid(mf.id)), 0) > 0 then 'partial'
           else 'unpaid'
         end                                    as status,
         (select max(t.occurred_on) from fee_payment_lines fpl
            join transactions t on t.id = fpl.transaction_id
           where fpl.member_fee_id = any (array_agg(mf.id)) and t.status = 'posted')
                                                as last_payment_on,
         (select t.reference from fee_payment_lines fpl
            join transactions t on t.id = fpl.transaction_id
           where fpl.member_fee_id = any (array_agg(mf.id)) and t.status = 'posted'
           order by t.occurred_on desc, t.created_at desc limit 1)
                                                as last_reference,
         (select r.receipt_no from fee_payment_lines fpl
            join transactions t on t.id = fpl.transaction_id
            join receipts r on r.transaction_id = t.id
           where fpl.member_fee_id = any (array_agg(mf.id)) and t.status = 'posted'
           order by t.occurred_on desc, t.created_at desc limit 1)
                                                as last_receipt_no
    from members m
    left join member_fees mf
      on mf.member_id = m.id and mf.is_mandatory and mf.charged_at_registration
   group by m.id, m.member_no, m.full_name, m.status, m.joined_on;

comment on view member_membership_fee is
  'One row per member: what the membership fee requires of them, what they have paid, what is left, and when they last paid. Required is the sum of their mandatory registration charges, each at the amount they were charged; paid is the sum of the posted allocation lines.';

revoke all on member_membership_fee from public, anon;
grant select on member_membership_fee to authenticated;

-- Every payment ever put against a member's membership fee, newest first.
create or replace view membership_fee_payments
with (security_invoker = true) as
  select fpl.id                as line_id,
         mf.member_id,
         m.member_no,
         mf.id                 as charge_id,
         mf.fee_name,
         mf.amount             as charged_amount,
         fpl.amount            as paid_amount,
         t.id                  as transaction_id,
         t.reference,
         t.external_ref,
         t.occurred_on         as paid_on,
         t.method,
         t.status              as transaction_status,
         r.receipt_no,
         fpl.created_at
    from fee_payment_lines fpl
    join member_fees mf on mf.id = fpl.member_fee_id
    join members m on m.id = mf.member_id
    join transactions t on t.id = fpl.transaction_id
    left join receipts r on r.transaction_id = t.id
   where mf.is_mandatory and mf.charged_at_registration;

comment on view membership_fee_payments is
  'The membership fee payment history, one row per allocation. A reversed payment stays visible with transaction_status = reversed; it is excluded from every total because the totals count posted payments only.';

revoke all on membership_fee_payments from public, anon;
grant select on membership_fee_payments to authenticated;

-- ---------------------------------------------------------------------------
-- The module's summary cards.
-- ---------------------------------------------------------------------------
create or replace function membership_fee_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  perform assert_capability(can_view_operations(), 'view the membership fees dashboard');

  select jsonb_build_object(
    'fee_amount',       coalesce(registration_fee_amount(), 0),
    'collected_total',  coalesce((select sum(fpl.amount) from fee_payment_lines fpl
                                   join member_fees mf on mf.id = fpl.member_fee_id
                                   join transactions t on t.id = fpl.transaction_id
                                  where mf.is_mandatory and mf.charged_at_registration
                                    and t.status = 'posted'), 0),
    'collected_month',  coalesce((select sum(fpl.amount) from fee_payment_lines fpl
                                   join member_fees mf on mf.id = fpl.member_fee_id
                                   join transactions t on t.id = fpl.transaction_id
                                  where mf.is_mandatory and mf.charged_at_registration
                                    and t.status = 'posted'
                                    and t.occurred_on >= date_trunc('month', current_date)::date), 0),
    'collected_today',  coalesce((select sum(fpl.amount) from fee_payment_lines fpl
                                   join member_fees mf on mf.id = fpl.member_fee_id
                                   join transactions t on t.id = fpl.transaction_id
                                  where mf.is_mandatory and mf.charged_at_registration
                                    and t.status = 'posted'
                                    and t.occurred_on = current_date), 0),
    'members_paid',     (select count(*) from member_membership_fee where status = 'paid'),
    'members_partial',  (select count(*) from member_membership_fee where status = 'partial'),
    'members_unpaid',   (select count(*) from member_membership_fee where status = 'unpaid'),
    'members_waived',   (select count(*) from member_membership_fee where status = 'waived'),
    'outstanding_total',(select coalesce(sum(outstanding_amount), 0) from member_membership_fee)
  ) into v_res;

  return v_res;
end;
$$;

revoke all on function membership_fee_dashboard() from public, anon;
grant execute on function membership_fee_dashboard() to authenticated;

-- The current membership fee, read from configuration. Never hard-coded.
create or replace function registration_fee_amount()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric(16,2)
    from fees
   where charged_when = 'registration'
     and status = 'active'
     and is_mandatory
     and applies_to_new_members
     and effective_from <= current_date;
$$;

revoke all on function registration_fee_amount() from public, anon;
grant execute on function registration_fee_amount() to authenticated;

comment on function registration_fee_amount() is
  'What it currently costs to join, summed from the active mandatory registration fees. The amount lives in `fees`; this function reads it so no screen or business rule has to hard-code a figure.';

-- ---------------------------------------------------------------------------
-- The module's table.
-- ---------------------------------------------------------------------------
create or replace function search_membership_fees(
  p_query  text default null,
  p_status text default null,
  p_limit  integer default 50,
  p_offset integer default 0
) returns table (
  member_id          uuid,
  member_no          text,
  full_name          text,
  member_status      member_status,
  registered_on      date,
  required_amount    numeric,
  paid_amount        numeric,
  outstanding_amount numeric,
  status             text,
  last_payment_on    date,
  last_reference     text,
  last_receipt_no    text,
  total_count        bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform assert_capability(can_view_operations(), 'view membership fees');

  return query
  with rows as (
    select f.* from member_membership_fee f
     where (v_q is null
            or f.member_no ilike '%' || v_q || '%'
            or f.full_name ilike '%' || v_q || '%')
       and (p_status is null or p_status = 'all' or f.status = p_status)
  )
  select r.member_id, r.member_no, r.full_name, r.member_status, r.registered_on,
         r.required_amount, r.paid_amount, r.outstanding_amount, r.status,
         r.last_payment_on, r.last_reference, r.last_receipt_no,
         (select count(*) from rows) as total_count
    from rows r
   order by case r.status when 'unpaid' then 0 when 'partial' then 1 else 2 end,
            r.registered_on desc, r.member_no
   limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function search_membership_fees(text, text, integer, integer) from public, anon;
grant execute on function search_membership_fees(text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- One member, for the profile card and the collection dialog.
-- ---------------------------------------------------------------------------
create or replace function member_membership_fee_detail(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  perform assert_capability(can_view_operations(), 'view a member''s membership fee');

  select jsonb_build_object(
    'member_id',          f.member_id,
    'member_no',          f.member_no,
    'full_name',          f.full_name,
    'member_status',      f.member_status,
    'registered_on',      f.registered_on,
    'required_amount',    f.required_amount,
    'paid_amount',        f.paid_amount,
    'outstanding_amount', f.outstanding_amount,
    'status',             f.status,
    'last_payment_on',    f.last_payment_on,
    'fee_amount',         registration_fee_amount(),
    'charges', (select coalesce(jsonb_agg(jsonb_build_object(
                         'charge_id', mf.id, 'fee_name', mf.fee_name,
                         'charged_amount', mf.amount,
                         'paid_amount', member_fee_paid(mf.id),
                         'outstanding_amount', greatest(mf.amount - member_fee_paid(mf.id), 0),
                         'status', mf.status, 'charged_on', mf.charged_on,
                         'charge_reason', mf.charge_reason)
                         order by mf.charged_on, mf.fee_name), '[]'::jsonb)
                  from member_fees mf
                 where mf.member_id = p_member_id
                   and mf.is_mandatory and mf.charged_at_registration),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
                          'paid_on', p.paid_on, 'amount', p.paid_amount,
                          'reference', p.reference, 'external_ref', p.external_ref,
                          'receipt_no', p.receipt_no, 'method', p.method,
                          'transaction_status', p.transaction_status,
                          'fee_name', p.fee_name)
                          order by p.paid_on desc, p.created_at desc), '[]'::jsonb)
                   from membership_fee_payments p where p.member_id = p_member_id)
  ) into v_res
  from member_membership_fee f where f.member_id = p_member_id;

  if v_res is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  return v_res;
end;
$$;

revoke all on function member_membership_fee_detail(uuid) from public, anon;
grant execute on function member_membership_fee_detail(uuid) to authenticated;

-- ===========================================================================
-- 7. COLLECTING THE MEMBERSHIP FEE
--
-- The counter's entry point. It finds the member's outstanding membership-fee
-- charges itself, so the screen never has to know about charge ids, and hands
-- them to `post_fee_payment()` - the same authoritative posting path the
-- general fee screen uses. Nothing is posted here that is not posted there.
-- ===========================================================================
create or replace function collect_membership_fee(
  p_member_id       uuid,
  p_amount          numeric,
  p_account_id      uuid,
  p_method          payment_method default null,
  p_paid_on         date default null,
  p_reference       text default null,
  p_note            text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids   uuid[];
  v_owing numeric(16,2);
begin
  perform assert_permission('fees.collect');

  select array_agg(mf.id order by mf.charged_on, mf.fee_name, mf.id),
         coalesce(sum(mf.amount - member_fee_paid(mf.id)), 0)
    into v_ids, v_owing
    from member_fees mf
   where mf.member_id = p_member_id
     and mf.is_mandatory and mf.charged_at_registration
     and mf.status in ('unpaid', 'partial');

  if v_ids is null or v_owing <= 0 then
    raise exception 'This member''s membership fee is already settled.'
      using errcode = 'check_violation', hint = 'amount';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.'
      using errcode = 'check_violation', hint = 'amount';
  end if;
  if p_amount > v_owing then
    raise exception 'That is more than is owed. The membership fee balance is %.', ugx(v_owing)
      using errcode = 'check_violation', hint = 'amount';
  end if;

  return post_fee_payment(p_member_id, v_ids, p_account_id, p_method, p_paid_on,
                          p_reference, p_idempotency_key, p_note, p_amount);
end;
$$;

revoke all on function collect_membership_fee(uuid, numeric, uuid, payment_method, date, text, text, text) from public, anon;
grant execute on function collect_membership_fee(uuid, numeric, uuid, payment_method, date, text, text, text) to authenticated;

comment on function collect_membership_fee(uuid, numeric, uuid, payment_method, date, text, text, text) is
  'Takes a membership fee payment, in full or in part, never more than the balance. Posts through post_fee_payment() so the ledger entry, the receipt, the income entry, the audit line and the activation check are the system''s existing ones.';

-- ===========================================================================
-- 8. BRINGING EARLIER MEMBERS UP TO THE CURRENT FEE
--
-- The membership fee was raised on 25 September 2026, from UGX 5,000 to
-- UGX 20,000. A member charged before that was charged the old amount and,
-- having paid it, owes nothing against the charge they were given: that is
-- what `member_fees.amount` being a snapshot means, and it is why the old
-- charge is not touched here.
--
-- The SACCO has decided that every member must reach the current fee. That is
-- a new obligation, so it is raised as a NEW charge for the difference, with
-- its own reason, its own audit entry, and its own place in the member's
-- payment history. The original charge, its transaction, its receipt and its
-- income entry are left exactly as they are: nothing is re-priced, nothing is
-- re-posted, and no money moves in this migration.
--
-- The top-up is mandatory and counts as part of the registration obligation,
-- so it appears in the module beside the original charge and is what the
-- member is asked for at the counter.
--
-- An already-active member is NOT returned to pending by this. Activation is
-- withheld until the fee is settled; it is not withdrawn because the SACCO
-- later asked for more. Only a reversal returns a member to pending.
--
-- This runs once. A second run finds the top-up already there and does
-- nothing, because the shortfall it looks for has been closed by the charge it
-- raised the first time.
-- ===========================================================================
do $$
declare
  v_fee     fees;
  v_topup   fees;
  v_current numeric(16,2);
  v_m       record;
  v_charge  member_fees;
  v_count   integer := 0;
  v_total   numeric(16,2) := 0;
begin
  select * into v_fee from fees
   where charged_when = 'registration' and status = 'active' and is_mandatory
     and applies_to_new_members
   order by sort_order, name limit 1;

  if not found then
    raise notice '0045: no active mandatory registration fee, so no top-up is raised.';
    return;
  end if;

  v_current := registration_fee_amount();
  if v_current <= 0 then
    return;
  end if;

  -- Is anybody actually short? If not, no adjustment fee is created at all, so
  -- a SACCO that never changed its fee never sees one.
  if not exists (
    select 1 from members m
      join member_fees mf on mf.member_id = m.id
                         and mf.is_mandatory and mf.charged_at_registration
     where m.status not in ('archived', 'exited')
     group by m.id
    having coalesce(sum(mf.amount) filter (where mf.status <> 'waived'), 0) < v_current
  ) then
    return;
  end if;

  -- The adjustment is its own fee, for two reasons. A member may hold only one
  -- charge per registration fee - `member_fees_one_registration_charge` has
  -- guarded against double-charging the joining fee since 0030, and that guard
  -- stays exactly as it is. And the adjustment is genuinely a different thing
  -- from the joining fee: it is the difference asked of a member who joined
  -- when the fee was lower. Giving it its own row says so on every receipt.
  --
  -- It is `charged_when = 'on_request'`, because nothing raises it
  -- automatically: it exists only where the SACCO has decided an earlier
  -- member must reach the current fee. That also keeps it out of
  -- `registration_fee_schedule()` and `registration_fee_amount()`, so joining
  -- still costs exactly the registration fee and no new member is ever charged
  -- an adjustment. The CHARGES it carries are marked
  -- `charged_at_registration`, which is what makes them part of the membership
  -- fee: they gate activation and they show in the module beside the original
  -- charge.
  --
  -- Each charge carries the member's own shortfall, not the catalogue amount.
  -- The catalogue amount is the current fee only because `fees` requires a
  -- positive figure and requires every fee to apply to somebody; a manager who
  -- ever needs to raise an adjustment by hand edits it under Settings -> Fees
  -- first, with the audit entry that every fee change carries.
  select * into v_topup from fees where code = 'MEMBERSHIP_ADJUSTMENT';
  if not found then
    insert into fees (code, name, description, amount, currency, fee_type, charged_when,
                      is_mandatory, applies_to_new_members, applies_to_existing_members,
                      status, income_category_id, sort_order, effective_from)
    values ('MEMBERSHIP_ADJUSTMENT', 'Membership fee adjustment',
            'The difference between what a member was charged to join and the current membership fee.',
            v_current, v_fee.currency, 'membership', 'on_request',
            true, false, true, 'active', v_fee.income_category_id,
            coalesce(v_fee.sort_order, 10) + 1, current_date)
    returning * into v_topup;

    insert into audit_logs (actor_name, action, module, record_id, summary,
                            old_value, new_value, reason)
    values ('system (migration 0045)', 'fee.created', 'Settings', v_topup.id::text,
            'Membership fee adjustment created, so a member charged an older, lower fee can be brought up to the current one',
            null, to_jsonb(v_topup),
            'Raising the difference as its own charge keeps the original charge, its payment, its receipt and its income entry exactly as recorded.');
  end if;

  for v_m in
    select m.id, m.member_no, m.full_name,
           coalesce(sum(mf.amount) filter (where mf.status <> 'waived'), 0)::numeric(16,2) as required
      from members m
      join member_fees mf
        on mf.member_id = m.id and mf.is_mandatory and mf.charged_at_registration
     where m.status not in ('archived', 'exited')
     group by m.id, m.member_no, m.full_name
    having coalesce(sum(mf.amount) filter (where mf.status <> 'waived'), 0) < v_current
  loop
    insert into member_fees (member_id, fee_id, fee_name, amount, currency, is_mandatory,
                             charged_at_registration, charge_reason, created_by)
    values (v_m.id, v_topup.id, v_topup.name, (v_current - v_m.required)::numeric(16,2),
            v_topup.currency, true, true,
            format('Membership fee brought up to the current %s. Charged %s before the fee changed; this is the difference.',
                   ugx(v_current), ugx(v_m.required)),
            null)
    on conflict (member_id, fee_id) where charged_at_registration do nothing
    returning * into v_charge;

    continue when v_charge.id is null;

    perform write_audit('fees.charged', 'Fees', v_charge.id::text,
      format('Membership fee adjustment of %s charged to %s (%s)',
             ugx(v_charge.amount), v_m.full_name, v_m.member_no),
      null, to_jsonb(v_charge),
      'Approved decision: every member must reach the current membership fee. The original charge, its payment, its receipt and its income entry are unchanged; this is an additional charge for the difference only.');

    v_count := v_count + 1;
    v_total := v_total + v_charge.amount;
  end loop;

  if v_count > 0 then
    insert into audit_logs (actor_name, action, module, record_id, summary,
                            old_value, new_value, reason)
    values ('system (migration 0045)', 'fees.top_up_raised', 'Fees', null,
            format('%s member(s) brought up to the current membership fee of %s, %s charged in total',
                   v_count, ugx(v_current), ugx(v_total)),
            null,
            jsonb_build_object('members_topped_up', v_count,
                               'total_charged', v_total,
                               'current_fee', v_current),
            'The membership fee was raised. Members charged the older, lower amount keep that charge and its payment exactly as recorded; the difference is raised as a new charge so the record shows what was asked, and when.');
  end if;
end $$;

-- ===========================================================================
-- 9. WHAT THE MODULE IS ALLOWED TO DO
--
-- No new permission is created and none is widened. Reading the module needs
-- the same `can_view_operations()` that the members, savings and shares read
-- models need. Taking money needs `fees.collect`, exactly as the general fee
-- screen already did.
-- ===========================================================================
