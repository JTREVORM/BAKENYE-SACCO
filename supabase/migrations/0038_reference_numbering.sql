-- ===========================================================================
-- BUD-SACCO - 0038 - One human-facing numbering scheme
--
-- Everything a member, cashier or auditor reads aloud, writes on a passbook or
-- types into a search box now has the same shape. Nothing here changes a
-- primary key: rows are still joined on their UUIDs, which stay internal and
-- are never shown to anyone.
--
-- MEMBER NUMBERS            BND + YY + 3-digit sequence
--
--   BND26001, BND26002, ... the first, second and so on registered in 2026.
--   BND27001                the first registered in 2027.
--
--   The sequence is scoped to the year of registration, so it starts again at
--   001 every 1 January. A member number is issued once and never changes
--   (enforced by `members_number_is_permanent`, 0030) and never reused.
--
-- DOCUMENT REFERENCES       PREFIX + YYMMDD + 3-digit sequence
--
--   SAV260912001  savings              LRP260912001  loan repayment
--   SHR260912001  shares               LDS260912001  loan disbursement
--   RCT260912001  receipt              EXP260912001  expense
--   TRF260912001  transfer             DEP260912001  bank deposit
--   WDL260912001  bank withdrawal      PAY260912001  payment
--   INC260912001  income               REV260912001  reversal
--   FEE260912001  fee                  PEN260912001  penalty
--   LN260912001   loan account         REC260912001  reconciliation
--
--   The sequence is scoped to the prefix and the day the document was issued,
--   so it starts again at 001 each morning. Two documents of different kinds
--   issued on the same day count separately - SAV260912001 and RCT260912001
--   are both the first of their kind that day.
--
-- CONCURRENCY
--
--   Both generators take the next value with a single INSERT ... ON CONFLICT
--   DO UPDATE ... RETURNING on `doc_counters`. That statement takes a row lock
--   on the counter, so two cashiers pressing Confirm in the same millisecond
--   are serialised by the database: one waits for the other and they get
--   consecutive numbers. Neither can read a stale value, and neither can be
--   handed a number the other already has.
--
-- OVERFLOW
--
--   Three digits is the width the sequence is padded to, not a ceiling on
--   it. The 1000th member of a year becomes BND261000 and the 1000th savings
--   receipt of a day SAV2609121000: unique, still in issue order, still
--   sortable, simply one digit longer. A SACCO that outgrows three digits
--   keeps working rather than stopping at the counter. (`lpad` alone would
--   not do - given a longer string it truncates, and BND261000 would come
--   back as BND26100, a number the hundredth member already holds.)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The sequence
-- ---------------------------------------------------------------------------

/**
 * A sequence number as it is written: three digits, zero-padded, and wider
 * than three only once the count needs it - 1, 42, 999, 1000 become 001, 042,
 * 999, 1000.
 *
 * `lpad` is not enough on its own. It truncates a string longer than the
 * width it is given, so `lpad('1000', 3, '0')` is '100' - the number the
 * hundredth member or the hundredth receipt of the day already holds. Padding
 * has to widen and never cut.
 */
create or replace function pad_sequence(p_value bigint)
returns text
language sql
immutable
as $$
  select lpad(p_value::text, greatest(length(p_value::text), 3), '0');
$$;

revoke all on function pad_sequence(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Member numbers
-- ---------------------------------------------------------------------------

/**
 * The next member number for this year: BND26001.
 *
 * The uniqueness loop is not belt-and-braces over the counter - it is there
 * for numbers the counter never issued: members carried in from the paper
 * register, or a restore that brought rows back without their counter. Rather
 * than fail the registration, the function takes the next free number.
 */
create or replace function next_member_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yy    text := to_char(current_date, 'YY');
  v_scope text := 'MEMBER-' || v_yy;
  v_next  bigint;
  v_no    text;
begin
  loop
    insert into doc_counters (scope, last_value)
    values (v_scope, 1)
    on conflict (scope) do update
      set last_value = doc_counters.last_value + 1
    returning last_value into v_next;

    v_no := 'BND' || v_yy || pad_sequence(v_next);

    exit when not exists (select 1 from members where member_no = v_no);
  end loop;

  return v_no;
end;
$$;

revoke all on function next_member_no() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Document references
-- ---------------------------------------------------------------------------

/**
 * The next reference for a kind of document today: SAV260912001.
 *
 * The date in the reference is the date the document was issued, not the date
 * it is accounted for. A payment recorded today for money received last
 * Friday is numbered today and dated Friday on its face - the ordinary
 * accounting convention, and the only one under which the number can be
 * guaranteed unique at the moment it is handed over.
 *
 * `p_width` is kept so that call sites written against the old scheme still
 * compile; the daily sequence is always three digits wide.
 */
create or replace function next_document_no(p_prefix text, p_width integer default 3)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := upper(btrim(coalesce(p_prefix, '')));
  v_day    text := to_char(current_date, 'YYMMDD');
  v_next   bigint;
begin
  if v_prefix = '' then
    raise exception 'A document prefix is required to issue a reference.'
      using errcode = 'check_violation';
  end if;

  -- 'M' has meant "issue a member number" since 0002. Member numbers are
  -- scoped to the year, not the day, and are shaped differently, so they have
  -- their own generator; callers that still ask for 'M' are sent to it.
  if v_prefix = 'M' then
    return next_member_no();
  end if;

  -- A bank withdrawal was 'WD' before this migration spelled it 'WDL'.
  if v_prefix = 'WD' then
    v_prefix := 'WDL';
  end if;

  insert into doc_counters (scope, last_value)
  values (v_prefix || '-' || v_day, 1)
  on conflict (scope) do update
    set last_value = doc_counters.last_value + 1
  returning last_value into v_next;

  return v_prefix || v_day || pad_sequence(v_next);
end;
$$;

revoke all on function next_document_no(text, integer) from public, anon, authenticated;

/**
 * Which reference a ledger row of this kind takes.
 *
 * A member reading a statement should be able to tell what a line is from its
 * reference alone, without the description: SAV is savings, LRP a repayment,
 * LDS the money going out on a loan.
 */
create or replace function txn_reference_prefix(p_type txn_type)
returns text
language sql
immutable
as $$
  select case p_type
           when 'weekly_savings'    then 'SAV'
           when 'monthly_savings'   then 'SAV'
           when 'share_purchase'    then 'SHR'
           when 'loan_repayment'    then 'LRP'
           when 'loan_disbursement' then 'LDS'
           when 'deposit'           then 'DEP'
           when 'withdrawal'        then 'WDL'
           when 'income'            then 'INC'
           when 'expense'           then 'EXP'
           when 'payment'           then 'PAY'
           when 'transfer'          then 'TRF'
           when 'fee'               then 'FEE'
           when 'penalty'           then 'PEN'
           -- A type added later still gets a reference rather than a null.
           else 'TXN'
         end;
$$;

revoke all on function txn_reference_prefix(txn_type) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The callers, unchanged apart from the reference they ask for.
-- ---------------------------------------------------------------------------

-- Every ledger row now carries the prefix of its own kind instead of a single
-- undifferentiated BND-TX- series.
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
  values (next_document_no(txn_reference_prefix(p_type)), p_member_id, p_type, p_amount, p_method,
          coalesce(p_occurred_on, current_date), p_description, p_idempotency_key, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- A reversal is its own document and reads as one: REV260912001, correcting
-- the reference it names in its description.
create or replace function reverse_transaction(p_transaction_id uuid, p_reason text,
                                               p_reversal_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig      transactions;
  v_rev       transactions;
  v_loan      loans;
  v_fee       record;
  v_on        date := coalesce(p_reversal_date, current_date);
  v_period_id uuid;
  v_paid      numeric(16,2);
  v_exp       numeric(16,2);
begin
  perform assert_permission('transactions.reverse');

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
  if v_on > current_date then
    raise exception 'A reversal cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  if v_on < v_orig.occurred_on then
    raise exception 'A reversal cannot be dated before the transaction it reverses (%).',
      to_char(v_orig.occurred_on, 'DD Mon YYYY') using errcode = 'check_violation';
  end if;

  -- A disbursement can only be taken back while nothing has been repaid on it;
  -- otherwise the repayments would be left paying off a loan that never paid out.
  if v_orig.type = 'loan_disbursement' and v_orig.loan_id is not null then
    select * into v_loan from loans where id = v_orig.loan_id for update;
    if exists (select 1 from loan_repayments r
                 join transactions t on t.id = r.transaction_id
                where r.loan_id = v_orig.loan_id and t.status = 'posted') then
      raise exception 'Loan % has repayments recorded against it. Reverse those first, then the disbursement.',
        v_loan.loan_no using errcode = 'check_violation';
    end if;
  end if;

  insert into transactions (reference, member_id, type, status, amount, method,
                            occurred_on, description, loan_id, savings_id, share_lot_id,
                            income_id, expense_id, reverses_id, reversal_reason, recorded_by)
  values (next_document_no('REV'), v_orig.member_id, v_orig.type, 'reversal', v_orig.amount,
          v_orig.method, v_on,
          'Reversal of ' || v_orig.reference, v_orig.loan_id, v_orig.savings_id,
          v_orig.share_lot_id, v_orig.income_id, v_orig.expense_id,
          v_orig.id, p_reason, auth.uid())
  returning * into v_rev;

  update transactions
     set status = 'reversed', reversed_by_id = v_rev.id, reversal_reason = p_reason
   where id = v_orig.id;

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
    select * into v_loan from loans where id = v_orig.loan_id for update;
    if v_loan.status = 'completed' then
      update loans set status = 'active', completed_on = null where id = v_loan.id;
      -- The guarantors released when the loan was cleared are bound again,
      -- because the loan is owed again - each back to the standing they really
      -- had: accepted only if their acceptance is on record, otherwise still
      -- waiting for their answer. Consent is never invented.
      update loan_guarantors g
         set status = case when exists (select 1 from audit_logs a
                                         where a.action = 'guarantor.accepted'
                                           and a.record_id = g.id::text)
                           then 'accepted'::guarantor_status
                           else 'pending'::guarantor_status end
       where g.loan_id = v_loan.id and g.status = 'released'
         and g.responded_on is not distinct from v_loan.completed_on;
    end if;
  end if;

  if v_orig.type = 'loan_disbursement' and v_orig.loan_id is not null then
    -- The fees booked out of this disbursement go back with it.
    for v_fee in
      select id from transactions
       where loan_id = v_orig.loan_id and type = 'fee' and method = 'internal'
         and status = 'posted' and occurred_on = v_orig.occurred_on
    loop
      perform reverse_transaction(v_fee.id, p_reason, v_on);
    end loop;

    update loans
       set status = 'approved', disbursed_on = null, disbursed_by = null, first_due_on = null
     where id = v_orig.loan_id;
    delete from loan_schedule where loan_id = v_orig.loan_id;
  end if;

  perform write_audit('transaction.reversed', 'Financials', v_orig.id::text,
    format('Transaction %s (%s) reversed by %s on %s', v_orig.reference, ugx(v_orig.amount),
           v_rev.reference, to_char(v_on, 'DD Mon YYYY')),
    to_jsonb(v_orig), to_jsonb(v_rev), p_reason);

  return jsonb_build_object('original_reference', v_orig.reference,
                            'reversal_reference', v_rev.reference,
                            'reversal_id', v_rev.id);
end;
$$;

-- Loan accounts: LN260912001.
CREATE OR REPLACE FUNCTION public.apply_for_loan(p_member_id uuid, p_product_id uuid, p_principal numeric, p_period_months integer, p_purpose text, p_purpose_category text DEFAULT NULL::text, p_guarantors jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q        jsonb;
  v_elig     jsonb;
  v_loan     loans;
  v_member   members;
  v_product  loan_products;
  v_g        jsonb;
  v_gmember  members;
  v_count    integer;
  v_cover    numeric := 0;
  v_min_g    integer;
  v_need     numeric;
begin
  if not (has_permission('loans.assess')
          or (current_member_id() = p_member_id and has_permission('portal.loan_apply'))) then
    raise exception 'You do not have permission to apply on behalf of this member.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
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

  select * into v_product from loan_products where id = p_product_id;
  if not found then
    raise exception 'Loan product is not available.' using errcode = 'no_data_found';
  end if;

  -- Every rule at once, so the applicant is told everything standing in the
  -- way rather than the first thing.
  v_elig := loan_eligibility(p_member_id, p_product_id, p_principal);
  if not (v_elig ->> 'eligible')::boolean then
    raise exception '%', (
      select string_agg(value #>> '{}', ' ') from jsonb_array_elements(v_elig -> 'reasons')
    ) using errcode = 'check_violation';
  end if;

  v_q     := quote_loan(p_product_id, p_principal, p_period_months);
  v_min_g := (v_elig ->> 'min_guarantors')::integer;

  insert into loans (
    loan_no, member_id, product_id, product_name, product_code,
    principal, interest_rate, interest_method, interest_amount,
    processing_fee, insurance_fee, application_fee,
    total_payable, period_months, installment_amount, installment_count,
    repayment_frequency, late_penalty_pct, penalty_basis, grace_period_days,
    purpose, purpose_category, status, created_by, review_notes, terms)
  values (
    next_document_no('LN'), p_member_id, p_product_id, v_product.name, v_product.code,
    p_principal,
    (v_q ->> 'interest_rate')::numeric, v_q ->> 'interest_method',
    (v_q ->> 'interest_amount')::numeric,
    (v_q ->> 'processing_fee')::numeric,
    (v_q ->> 'insurance_fee')::numeric,
    (v_q ->> 'application_fee')::numeric,
    (v_q ->> 'total_payable')::numeric, p_period_months,
    (v_q ->> 'installment_amount')::numeric,
    (v_q ->> 'installment_count')::integer,
    v_product.repayment_frequency, v_product.late_penalty_pct,
    v_product.penalty_basis, v_product.grace_period_days,
    p_purpose, p_purpose_category, 'applied', auth.uid(),
    case when p_idempotency_key is null then null else 'idem:' || p_idempotency_key end,
    -- The contract, as it read today.
    jsonb_build_object(
      'snapshotted_at', now(),
      'quote', v_q,
      'product', to_jsonb(v_product),
      'sacco_rules', jsonb_build_object(
        'max_active_per_member', setting_int('loans.max_active_per_member'),
        'max_savings_multiple',  setting_number('loans.max_savings_multiple'),
        'min_membership_months', setting_int('loans.min_membership_months'),
        'require_guarantors',    setting_bool('loans.require_guarantors'),
        'guarantor_cover_pct',   setting_number('loans.guarantor_cover_pct'))))
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
    v_cover := v_cover + coalesce((v_g ->> 'amount')::numeric, 0);
  end loop;

  if v_count < v_min_g then
    raise exception 'This loan requires at least % guarantor(s).', v_min_g
      using errcode = 'check_violation';
  end if;

  -- Cover, not just headcount: three guarantors pledging a tenth of the
  -- principal between them are not security for it.
  if v_min_g > 0 then
    v_need := round(p_principal * (v_elig ->> 'guarantor_cover_pct')::numeric / 100.0, 2);
    if v_cover < v_need then
      raise exception 'Guarantors must cover at least UGX % of this loan. They currently cover UGX %.',
        to_char(v_need, 'FM999,999,999'), to_char(v_cover, 'FM999,999,999')
        using errcode = 'check_violation';
    end if;
  end if;

  perform write_audit('loan.applied', 'Loans', v_loan.id::text,
    format('%s applied for %s of UGX %s', v_member.full_name, v_product.name,
           to_char(p_principal, 'FM999,999,999')),
    null, to_jsonb(v_loan), p_purpose);

  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no,
                            'status', v_loan.status, 'quote', v_q, 'duplicate', false);
end;
$function$
;

-- Member registration issues BND26001 from the year counter.
create or replace function register_member(
  p_member             jsonb,
  p_optional_fee_ids   uuid[] default '{}',
  p_payment            jsonb default null,
  p_expected_total     numeric default null,
  p_registration_key   text default null,
  p_allow_shared_phone boolean default false,
  p_override_reason    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing  members;
  v_member    members;
  v_other     members;
  v_name      text := regexp_replace(btrim(coalesce(p_member ->> 'full_name', '')), '\s+', ' ', 'g');
  v_phone     text := normalize_ug_phone(p_member ->> 'phone');
  v_email     text := nullif(lower(btrim(coalesce(p_member ->> 'email', ''))), '');
  v_nin       text := nullif(upper(regexp_replace(coalesce(p_member ->> 'national_id', ''), '\s', '', 'g')), '');
  v_gender    text := nullif(lower(btrim(coalesce(p_member ->> 'gender', ''))), '');
  v_nok_name  text := nullif(btrim(coalesce(p_member ->> 'next_of_kin_name', '')), '');
  v_nok_rel   text := nullif(btrim(coalesce(p_member ->> 'next_of_kin_relation', '')), '');
  v_nok_phone text := nullif(btrim(coalesce(p_member ->> 'next_of_kin_phone', '')), '');
  v_dob       date := form_date(p_member ->> 'date_of_birth', 'date_of_birth', 'date of birth');
  v_joined    date := coalesce(form_date(p_member ->> 'joined_on', 'joined_on', 'membership date'), current_date);
  v_share     share_categories;
  v_savings   savings_categories;
  v_share_id  uuid;
  v_sav_id    uuid;
  v_fee       record;
  v_optional  uuid[] := coalesce(p_optional_fee_ids, '{}');
  v_charge    member_fees;
  v_charge_ids uuid[] := '{}';
  v_total     numeric(16,2) := 0;
  v_mandatory numeric(16,2) := 0;
  v_pay_now   boolean := coalesce((p_payment ->> 'pay_now')::boolean, false);
  v_paid      jsonb;
  v_min_age   integer;
  v_status    member_status;
  v_shared    boolean := false;
begin
  perform assert_permission('members.create');

  -- A retried submission returns the member it already registered.
  if p_registration_key is not null then
    select * into v_existing from members where registration_key = p_registration_key;
    if found then
      return registration_summary(v_existing.id, true);
    end if;
  end if;

  -- --- Who they are ------------------------------------------------------
  if length(v_name) < 3 or v_name !~ '\S+\s+\S+' then
    raise exception 'Enter the member''s full name - at least a first and a last name.'
      using errcode = 'check_violation', hint = 'full_name';
  end if;
  if length(v_name) > 120 then
    raise exception 'That name is too long.' using errcode = 'check_violation', hint = 'full_name';
  end if;

  if nullif(btrim(coalesce(p_member ->> 'phone', '')), '') is null then
    raise exception 'Enter the member''s phone number. It is how they sign in.'
      using errcode = 'check_violation', hint = 'phone';
  end if;
  if v_phone is null then
    raise exception 'Enter a valid Ugandan mobile number, e.g. 0772 123 456 or +256 772 123 456.'
      using errcode = 'check_violation', hint = 'phone';
  end if;

  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address, or leave it blank.' using errcode = 'check_violation', hint = 'email';
  end if;

  if v_nin is null and setting_bool('members.require_national_id') then
    raise exception 'Enter the member''s National ID number.' using errcode = 'check_violation', hint = 'national_id';
  end if;
  if v_nin is not null then
    select * into v_other from members where upper(national_id) = v_nin limit 1;
    if found then
      raise exception 'National ID % is already registered to % (%).', v_nin, v_other.full_name, v_other.member_no
        using errcode = 'unique_violation', hint = 'national_id';
    end if;
  end if;

  if v_dob is null and setting_bool('members.require_date_of_birth') then
    raise exception 'Enter the member''s date of birth.' using errcode = 'check_violation', hint = 'date_of_birth';
  end if;
  if v_dob is not null then
    if v_dob > current_date then
      raise exception 'A date of birth cannot be in the future.' using errcode = 'check_violation', hint = 'date_of_birth';
    end if;
    v_min_age := setting_int('members.min_age');
    if v_min_age > 0 and v_dob > (current_date - make_interval(years => v_min_age))::date then
      raise exception 'Members must be at least % years old to join.', v_min_age
        using errcode = 'check_violation', hint = 'date_of_birth';
    end if;
  end if;

  if v_gender is null and setting_bool('members.require_gender') then
    raise exception 'Choose the member''s gender.' using errcode = 'check_violation', hint = 'gender';
  end if;
  if v_gender is not null and v_gender not in ('male', 'female', 'other') then
    raise exception 'Choose a gender from the list.' using errcode = 'check_violation', hint = 'gender';
  end if;

  if setting_bool('members.require_next_of_kin')
     and (v_nok_name is null or v_nok_rel is null or v_nok_phone is null) then
    raise exception 'Enter the next of kin''s name, relationship and phone number.'
      using errcode = 'check_violation', hint = case when v_nok_name is null then 'next_of_kin_name'
                                                      when v_nok_rel is null then 'next_of_kin_relation'
                                                      else 'next_of_kin_phone' end;
  end if;

  if v_joined > current_date then
    raise exception 'The membership date cannot be in the future.' using errcode = 'check_violation', hint = 'joined_on';
  end if;

  -- --- Duplicates ----------------------------------------------------------
  select * into v_other from members
   where phone = v_phone and status not in ('archived', 'exited')
   order by joined_on limit 1;
  if found then
    if not coalesce(p_allow_shared_phone, false) then
      raise exception '% is already the phone number of % (%). Each member signs in with their own number.',
        format_ug_phone(v_phone), v_other.full_name, v_other.member_no
        using errcode = 'unique_violation', hint = 'phone';
    end if;
    perform assert_permission('members.phone_override');
    if length(btrim(coalesce(p_override_reason, ''))) < 5 then
      raise exception 'Give a reason for letting two members share this phone number.'
        using errcode = 'check_violation', hint = 'override_reason';
    end if;
    v_shared := true;
  end if;

  if v_dob is not null then
    select * into v_other from members
     where lower(full_name) = lower(v_name) and date_of_birth = v_dob
       and (v_nin is null or national_id is null)
       and status not in ('archived', 'exited')
     limit 1;
    if found then
      raise exception '% (%), born on the same day, is already a member. If this is a different person, record their National ID to tell them apart.',
        v_other.full_name, v_other.member_no using errcode = 'unique_violation', hint = 'full_name';
    end if;
  end if;

  -- --- Categories ----------------------------------------------------------
  v_share_id := nullif(p_member ->> 'share_category_id', '')::uuid;
  v_sav_id   := nullif(p_member ->> 'savings_category_id', '')::uuid;

  if setting_bool('members.registration_requires_categories') then
    if v_share_id is null then
      raise exception 'Choose the member''s share category.' using errcode = 'check_violation', hint = 'share_category_id';
    end if;
    if v_sav_id is null then
      raise exception 'Choose the member''s savings category.' using errcode = 'check_violation', hint = 'savings_category_id';
    end if;
  end if;

  if v_share_id is not null then
    select * into v_share from share_categories where id = v_share_id and status = 'active';
    if not found then
      raise exception 'That share category is not available.' using errcode = 'check_violation', hint = 'share_category_id';
    end if;
  end if;
  if v_sav_id is not null then
    select * into v_savings from savings_categories where id = v_sav_id and status = 'active';
    if not found then
      raise exception 'That savings category is not available.' using errcode = 'check_violation', hint = 'savings_category_id';
    end if;
  end if;
  if setting_bool('categories.share_matches_savings')
     and v_share.id is not null and v_savings.id is not null
     and split_part(v_savings.code, '_', 1) <> v_share.code then
    raise exception 'This SACCO requires the savings category to match the share category. % shares go with the % saver category.',
      v_share.name, v_share.name using errcode = 'check_violation', hint = 'savings_category_id';
  end if;

  -- --- Fees ----------------------------------------------------------------
  if exists (
    select 1 from unnest(v_optional) x
     where not exists (select 1 from fees f
                        where f.id = x and f.status = 'active' and f.charged_when = 'registration'
                          and f.applies_to_new_members and not f.is_mandatory
                          and f.effective_from <= v_joined)
  ) then
    raise exception 'One of the optional fees chosen is not available. Reload the form.'
      using errcode = 'check_violation', hint = 'fees';
  end if;

  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where is_mandatory), 0)
    into v_total, v_mandatory
    from fees
   where status = 'active' and charged_when = 'registration' and applies_to_new_members
     and effective_from <= v_joined
     and (is_mandatory or id = any (v_optional));

  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception 'The registration fees changed while this form was open. The total is now %. Review it and confirm again.',
      ugx(v_total) using errcode = 'check_violation', hint = 'fees';
  end if;

  if v_pay_now and v_total = 0 then
    v_pay_now := false;
  end if;

  v_status := case when v_mandatory > 0 and setting_bool('members.activation_requires_fees')
                   then 'pending' else 'active' end;

  -- --- The member ----------------------------------------------------------
  insert into members (member_no, full_name, phone, email, national_id, date_of_birth, gender,
                       address, occupation, next_of_kin_name, next_of_kin_phone,
                       next_of_kin_relation, joined_on, status, share_category_id,
                       savings_category_id, created_by, registration_key,
                       allow_shared_phone, shared_phone_reason, activated_at)
  values (next_member_no(), v_name, v_phone, v_email, v_nin, v_dob, v_gender,
          nullif(btrim(coalesce(p_member ->> 'address', '')), ''),
          nullif(btrim(coalesce(p_member ->> 'occupation', '')), ''),
          v_nok_name, v_nok_phone, v_nok_rel, v_joined, v_status, v_share_id, v_sav_id,
          auth.uid(), p_registration_key,
          v_shared, case when v_shared then btrim(p_override_reason) end,
          case when v_status = 'active' then now() end)
  returning * into v_member;

  for v_fee in
    select * from fees
     where status = 'active' and charged_when = 'registration' and applies_to_new_members
       and effective_from <= v_joined
       and (is_mandatory or id = any (v_optional))
     order by is_mandatory desc, sort_order, name
  loop
    insert into member_fees (member_id, fee_id, fee_name, amount, currency, is_mandatory,
                             charged_at_registration, charged_on, created_by)
    values (v_member.id, v_fee.id, v_fee.name, v_fee.amount, v_fee.currency, v_fee.is_mandatory,
            true, v_joined, auth.uid())
    returning * into v_charge;
    v_charge_ids := v_charge_ids || v_charge.id;
  end loop;

  perform write_audit('member.created', 'Members', v_member.id::text,
    format('Member %s (%s) registered%s', v_member.full_name, v_member.member_no,
           case when v_status = 'pending' then ' - pending until mandatory fees are paid' else '' end),
    null,
    to_jsonb(v_member) - 'registration_key'
      || jsonb_build_object('share_category', v_share.name, 'savings_category', v_savings.name,
                            'fees_charged', v_total),
    case when v_shared then 'Shared phone number allowed: ' || btrim(p_override_reason) end);

  if v_shared then
    perform write_audit('member.phone_shared', 'Members', v_member.id::text,
      format('%s registered on %s, a number another member also uses', v_member.member_no,
             format_ug_phone(v_phone)),
      null, jsonb_build_object('phone', v_phone), p_override_reason);
  end if;

  -- --- Payment -------------------------------------------------------------
  if v_pay_now then
    v_paid := post_fee_payment(
      v_member.id, v_charge_ids,
      nullif(p_payment ->> 'account_id', '')::uuid,
      nullif(p_payment ->> 'method', '')::payment_method,
      form_date(p_payment ->> 'paid_on', 'paid_on', 'payment date'),
      p_payment ->> 'reference',
      coalesce(nullif(p_payment ->> 'idempotency_key', ''), 'register:' || coalesce(p_registration_key, v_member.id::text)),
      'Registration fees',
      nullif(p_payment ->> 'amount_received', '')::numeric);
  elsif v_status = 'active' then
    perform ensure_member_schedule(v_member.id, current_date);
  end if;

  return registration_summary(v_member.id, false);
end;
$$;

-- Expenses are numbered EXP, not PAY: the payment register and the expense
-- register are two different books and a reader should be able to tell which
-- one a number came from.
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
  p_notes              text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row    expense_entries;
  v_acct   financial_accounts;
  v_method payment_method;
  v_cat    expense_categories;
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
                               payment_no, payee, reference, notes, idempotency_key)
  values (p_category_id, p_amount, p_description, coalesce(p_spent_on, current_date), v_method,
          nullif(btrim(coalesce(p_attachment_path, '')), ''), 'pending', auth.uid(), v_acct_id,
          next_document_no('EXP'), nullif(btrim(coalesce(p_payee, '')), ''),
          nullif(btrim(coalesce(p_reference, '')), ''),
          nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key)
  returning * into v_row;

  perform write_audit('expense.submitted', 'Financials', v_row.id::text,
    format('Expense %s of %s (%s) submitted for approval, to be paid from %s',
           v_row.payment_no, ugx(p_amount), v_cat.name, v_acct.name),
    null, to_jsonb(v_row), p_description);

  return jsonb_build_object('expense_id', v_row.id, 'approval', v_row.approval,
                            'payment_no', v_row.payment_no, 'duplicate', false);
end;
$$;


create or replace function approve_expense(
  p_expense_id uuid,
  p_approve    boolean,
  p_reason     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row  expense_entries;
  v_old  jsonb;
  v_txn  transactions;
  v_acct uuid;
begin
  select * into v_row from expense_entries where id = p_expense_id for update;
  if not found then
    raise exception 'Expense not found.' using errcode = 'no_data_found';
  end if;

  perform assert_can_approve(v_row.recorded_by);
  v_old := to_jsonb(v_row);

  if v_row.approval <> 'pending' then
    raise exception 'This expense has already been %.', v_row.approval using errcode = 'check_violation';
  end if;

  if p_approve then
    v_acct := coalesce(v_row.payment_account_id,
                       default_financial_account((finance_account_types_for_method(v_row.method))[1]));
    if v_acct is null then
      raise exception 'Choose the account this expense is paid from before approving it.'
        using errcode = 'check_violation';
    end if;
    perform assert_account_usable(v_acct, v_row.method);

    insert into transactions (reference, member_id, type, status, amount, method, occurred_on,
                              description, source_account_id, external_ref, idempotency_key,
                              recorded_by)
    values (coalesce(v_row.payment_no, next_document_no('EXP')), null, 'expense', 'posted',
            v_row.amount, v_row.method, v_row.spent_on, v_row.description, v_acct,
            null, 'expense:' || v_row.id::text, auth.uid())
    returning * into v_txn;

    update transactions set expense_id = v_row.id where id = v_txn.id;

    update expense_entries
       set approval = 'approved', approved_by = auth.uid(), approved_at = now(),
           transaction_id = v_txn.id, payment_account_id = v_acct,
           payment_no = coalesce(payment_no, v_txn.reference)
     where id = p_expense_id
    returning * into v_row;
  else
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'A reason is required when rejecting an expense.' using errcode = 'check_violation';
    end if;
    update expense_entries
       set approval = 'rejected', approved_by = auth.uid(), approved_at = now(),
           rejection_reason = btrim(p_reason)
     where id = p_expense_id
    returning * into v_row;
  end if;

  perform write_audit('expense.' || v_row.approval::text, 'Financials', v_row.id::text,
    format('Expense %s of %s %s', coalesce(v_row.payment_no, ''), ugx(v_row.amount), v_row.approval),
    v_old, to_jsonb(v_row), p_reason);

  return jsonb_build_object('expense_id', v_row.id, 'approval', v_row.approval,
                            'reference', v_txn.reference);
end;
$$;

-- Bank withdrawals are WDL, matching the withdrawal prefix on the ledger.
create or replace function create_internal_transfer(
  p_source_account_id      uuid,
  p_destination_account_id uuid,
  p_amount                 numeric,
  p_transfer_date          date default null,
  p_source_reference       text default null,
  p_destination_reference  text default null,
  p_description            text default null,
  p_purpose                text default null,
  p_handled_by             text default null,
  p_notes                  text default null,
  p_submit                 boolean default true,
  p_idempotency_key        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_src      financial_accounts;
  v_dst      financial_accounts;
  v_kind     transfer_kind;
  v_row      internal_transfers;
  v_on       date := coalesce(p_transfer_date, current_date);
  v_src_ref  text := nullif(btrim(coalesce(p_source_reference, '')), '');
  v_dst_ref  text := nullif(btrim(coalesce(p_destination_reference, '')), '');
  v_needs    boolean;
  v_prefix   text;
  v_balance  numeric;
begin
  perform assert_capability(can_record_finance(), 'record transfers');

  if p_idempotency_key is not null then
    select * into v_row from internal_transfers where idempotency_key = p_idempotency_key;
    if found then
      return transfer_result(v_row) || jsonb_build_object('duplicate', true);
    end if;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  if v_on > current_date then
    raise exception 'A transfer cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  if p_source_account_id = p_destination_account_id then
    raise exception 'Choose two different accounts.' using errcode = 'check_violation';
  end if;

  v_src := assert_account_usable(p_source_account_id, null);
  v_dst := assert_account_usable(p_destination_account_id, null);

  v_kind := transfer_kind_for(v_src.account_type, v_dst.account_type);
  if v_kind is null then
    raise exception 'Money cannot move from % to % in this system. Supported: merchant to bank, cash to bank, bank to cash and bank to bank.',
      v_src.name, v_dst.name using errcode = 'check_violation';
  end if;

  -- The references are the audit trail back to the real-world event, so the
  -- ones that event always produces are required.
  if v_kind = 'merchant_to_bank' and v_src_ref is null then
    raise exception 'Enter the merchant (mobile money) transaction reference for the withdrawal.'
      using errcode = 'check_violation';
  end if;
  if v_kind in ('merchant_to_bank', 'cash_to_bank') and v_dst_ref is null then
    raise exception 'Enter the bank deposit slip or transfer reference.' using errcode = 'check_violation';
  end if;
  if v_kind in ('bank_to_cash', 'bank_to_bank') and v_src_ref is null then
    raise exception 'Enter the bank withdrawal, cheque or transfer reference.' using errcode = 'check_violation';
  end if;

  if v_src_ref is not null and exists (
    select 1 from internal_transfers
     where source_account_id = p_source_account_id and upper(source_reference) = upper(v_src_ref)
       and status in ('draft', 'submitted', 'approved', 'completed')) then
    raise exception 'Reference % has already been recorded on %.', v_src_ref, v_src.name
      using errcode = 'unique_violation';
  end if;
  if v_dst_ref is not null and exists (
    select 1 from internal_transfers
     where destination_account_id = p_destination_account_id and upper(destination_reference) = upper(v_dst_ref)
       and status in ('draft', 'submitted', 'approved', 'completed')) then
    raise exception 'Reference % has already been recorded on %.', v_dst_ref, v_dst.name
      using errcode = 'unique_violation';
  end if;

  -- Checked now so the person recording hears about it now; checked again,
  -- authoritatively, when the money actually moves.
  v_balance := account_balance_at(p_source_account_id);
  if p_amount > v_balance and not setting_bool('treasury.allow_negative_balances') then
    raise exception '% holds %. It cannot send %.', v_src.name, ugx(v_balance), ugx(p_amount)
      using errcode = 'check_violation';
  end if;

  v_needs  := treasury_requires_approval(p_amount);
  v_prefix := case v_kind when 'cash_to_bank' then 'DEP' when 'bank_to_cash' then 'WDL' else 'TRF' end;

  insert into internal_transfers (transfer_no, kind, source_account_id, destination_account_id,
                                  amount, transfer_date, source_reference, destination_reference,
                                  description, purpose, handled_by, notes, status,
                                  requires_approval, idempotency_key, created_by, submitted_at)
  values (next_document_no(v_prefix), v_kind, p_source_account_id, p_destination_account_id,
          p_amount, v_on, v_src_ref, v_dst_ref,
          coalesce(nullif(btrim(coalesce(p_description, '')), ''),
                   case v_kind
                     when 'merchant_to_bank' then 'Transfer of collections from the merchant account to the bank'
                     when 'cash_to_bank'     then 'Deposit of cash at hand into the bank'
                     when 'bank_to_cash'     then 'Cash withdrawn from the bank'
                     else 'Transfer between bank accounts' end),
          nullif(btrim(coalesce(p_purpose, '')), ''),
          nullif(btrim(coalesce(p_handled_by, '')), ''),
          nullif(btrim(coalesce(p_notes, '')), ''),
          case when not coalesce(p_submit, true) then 'draft'::finance_doc_status
               else 'submitted'::finance_doc_status end,
          v_needs, p_idempotency_key, auth.uid(),
          case when coalesce(p_submit, true) then now() end)
  returning * into v_row;

  perform write_audit('treasury.transfer_' || v_row.status::text, 'Finance', v_row.id::text,
    format('%s %s: %s from %s to %s', v_row.transfer_no,
           case v_row.status when 'draft' then 'saved as draft'
                             else case when v_needs then 'submitted for approval' else 'recorded' end end,
           ugx(p_amount), v_src.name, v_dst.name),
    null, to_jsonb(v_row), p_notes);

  if v_row.status = 'submitted' and not v_needs then
    v_row := post_internal_transfer(v_row.id);
    perform write_audit('treasury.transfer_completed', 'Finance', v_row.id::text,
      format('%s completed: %s moved from %s to %s', v_row.transfer_no, ugx(p_amount),
             v_src.name, v_dst.name),
      jsonb_build_object('status', 'submitted'), to_jsonb(v_row), null);
  end if;

  return transfer_result(v_row) || jsonb_build_object('duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Signing in with a member number
-- ---------------------------------------------------------------------------

/**
 * The one form an identifier is counted and looked up in: a member number as
 * BND26001, a phone as +2567XXXXXXXX, an email in lower case. Anything else is
 * kept as typed, upper-cased, so it is still rate-limited.
 *
 * Case and stray separators are forgiven - `bnd26001` and `BND-26001` are the
 * same member - but the BND prefix is required. Bare digits are read as a
 * phone number, because on a phone keypad that is nearly always what they are.
 *
 * Member numbers issued under the pre-0038 scheme (BND-M-0000123) are still
 * recognised, so a passbook printed before the change still signs its holder
 * in.
 */
create or replace function login_identifier_key(p_identifier text)
returns text language plpgsql immutable as $$
declare
  v    text := btrim(coalesce(p_identifier, ''));
  v_up text := upper(regexp_replace(v, '[\s-]', '', 'g'));
begin
  if v = '' then
    return '';
  end if;
  if position('@' in v) > 0 then
    return lower(v);
  end if;
  if v_up ~ '^BNDM[0-9]{1,7}$' then
    return 'BND-M-' || lpad(regexp_replace(v_up, '\D', '', 'g'), 7, '0');
  end if;
  if v_up ~ '^BND[0-9]{5,}$' then
    return v_up;
  end if;
  return coalesce(normalize_ug_phone(v), upper(regexp_replace(v, '\s', '', 'g')));
end;
$$;

/** The login accounts an identifier could belong to. */
create or replace function login_candidates(p_key text)
returns table (user_id uuid, auth_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_key is null or p_key = '' then
    return;
  end if;

  if position('@' in p_key) > 0 then
    return query
      select a.id, a.email::text
        from auth.users a join app_users u on u.id = a.id
       where lower(a.email) = p_key;
  elsif p_key like 'BND%' then
    return query
      select a.id, a.email::text
        from members m join auth.users a on a.id = m.user_id
       where m.member_no = p_key;
  elsif p_key ~ '^\+2567[0-9]{8}$' then
    return query
      select distinct a.id, a.email::text
        from auth.users a
        join app_users u on u.id = a.id
       where u.phone = p_key
          or a.id in (select m.user_id from members m
                       where m.phone = p_key and m.user_id is not null);
  end if;
end;
$$;

-- The audit line for a successful sign-in names how someone identified
-- themselves; a member number now starts with BND and no longer BND-M-.
create or replace function login_record(
  p_identifier text, p_client text, p_user_id uuid, p_succeeded boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_key    text := login_identifier_key(p_identifier);
  v_client text := nullif(left(btrim(coalesce(p_client, '')), 100), '');
begin
  insert into login_attempts (identifier, client, succeeded, reason, user_id, kind)
  values (v_key, v_client, p_succeeded, p_reason, p_user_id, 'sign_in');

  if p_succeeded then
    update app_users set last_login_at = now() where id = p_user_id;
    perform write_account_audit(p_user_id, 'auth.login_succeeded',
      format('Signed in with %s', case when v_key like 'BND%' then 'member number'
                                       when v_key like '+256%' then 'phone number'
                                       when position('@' in v_key) > 0 then 'email'
                                       else 'identifier' end),
      jsonb_build_object('identifier', v_key, 'client', v_client));
  else
    insert into audit_logs (actor_id, actor_name, actor_role, action, module, record_id, summary, new_value, reason)
    values (p_user_id, coalesce((select full_name from app_users where id = p_user_id), 'unknown'),
            (select role from app_users where id = p_user_id),
            'auth.login_failed', 'Security', coalesce(p_user_id::text, v_key),
            format('Failed sign-in for %s', v_key),
            jsonb_build_object('identifier', v_key, 'client', v_client, 'reason', coalesce(p_reason, 'invalid')),
            null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------
create or replace function receipt_for_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_txn transaction_feed;
  v_row transactions;
  v_lines_txn uuid;
begin
  select * into v_txn from transaction_feed where id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found.' using errcode = 'no_data_found';
  end if;

  if not (can_view_operations() or v_txn.member_id = current_member_id()) then
    raise exception 'You may only view your own receipts.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from transactions where id = p_transaction_id;
  v_lines_txn := coalesce(v_row.reverses_id, v_row.id);

  return jsonb_build_object(
    'transaction',   to_jsonb(v_txn),
    'sacco_name',    sacco_legal_name(),
    -- A receipt row exists for every sum of money actually received (0027).
    -- Anything else printed as a receipt - a reprint of a loan disbursement,
    -- say - never had a receipt number issued to it, so it is identified by the
    -- transaction's own reference, which is a full document number in its own
    -- right under this scheme.
    'receipt_no',    coalesce((select receipt_no from receipts where transaction_id = p_transaction_id),
                              v_txn.reference),
    'external_ref',  v_row.external_ref,
    'receipt_title', case
                       when exists (select 1 from fee_payment_lines l
                                      join member_fees mf on mf.id = l.member_fee_id
                                     where l.transaction_id = v_lines_txn and mf.charged_at_registration)
                         then 'Membership Payment Receipt'
                       when exists (select 1 from fee_payment_lines l where l.transaction_id = v_lines_txn)
                         then 'Fee Payment Receipt'
                     end,
    'fee_lines',     (select coalesce(jsonb_agg(jsonb_build_object('description', l.description,
                                                                   'amount', l.amount) order by l.id), '[]'::jsonb)
                        from fee_payment_lines l where l.transaction_id = v_lines_txn),
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
    ),
    'source_account', case when can_view_finance() then (
      select jsonb_build_object('id', a.id, 'name', a.name, 'account_type', a.account_type)
        from financial_accounts a where a.id = v_row.source_account_id) end,
    'destination_account', case when can_view_finance() then (
      select jsonb_build_object('id', a.id, 'name', a.name, 'account_type', a.account_type)
        from financial_accounts a where a.id = v_row.destination_account_id) end,
    'transfer', case when can_view_finance() then (
      select jsonb_build_object('id', x.id, 'transfer_no', x.transfer_no, 'kind', x.kind,
                                'source_reference', x.source_reference,
                                'destination_reference', x.destination_reference,
                                'handled_by', x.handled_by, 'status', x.status)
        from internal_transfers x where x.transaction_id = coalesce(v_row.reverses_id, v_row.id)) end,
    'payment', case when can_view_finance() then (
      select jsonb_build_object('id', p.id, 'payment_no', p.payment_no, 'payee', p.payee,
                                'reference', p.reference, 'status', p.status)
        from payments p where p.transaction_id = coalesce(v_row.reverses_id, v_row.id)) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- What the columns hold, for anyone reading the catalogue rather than this file
--
-- The comments written in 0001 and 0027 describe the scheme those migrations
-- shipped. They stay as they are - a migration is a record of what happened -
-- and the live comment is set here instead.
-- ---------------------------------------------------------------------------
comment on column members.member_no is
  'BND + the two-digit year of registration + that year''s sequence, e.g. BND26001. Issued once by next_member_no(), never reused, never changed.';
comment on column transactions.reference is
  'The document number of this ledger row: a three-letter prefix for its kind + YYMMDD + that day''s sequence, e.g. SAV260912001.';
comment on column loans.loan_no is
  'LN + YYMMDD + that day''s sequence, e.g. LN260912001.';
comment on column receipts.receipt_no is
  'RCT + YYMMDD + that day''s sequence, e.g. RCT260912001.';
comment on column internal_transfers.transfer_no is
  'TRF, DEP (cash into the bank) or WDL (cash out of the bank) + YYMMDD + that day''s sequence, e.g. DEP260912001.';
comment on column payments.payment_no is
  'PAY + YYMMDD + that day''s sequence, e.g. PAY260912001.';
comment on column expense_entries.payment_no is
  'EXP + YYMMDD + that day''s sequence, e.g. EXP260912001. The expense register is numbered separately from the payment register.';
comment on column reconciliations.reconciliation_no is
  'REC + YYMMDD + that day''s sequence, e.g. REC260912001.';
comment on column doc_counters.scope is
  'What is being counted: MEMBER-YY for member numbers, PREFIX-YYMMDD for document references, ACCT-XXX for account codes.';
