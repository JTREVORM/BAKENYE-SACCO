-- ===========================================================================
-- BUD-SACCO - 0018 - The loan calculation and eligibility engine
--
-- One place where a loan's numbers are worked out, reading the product and the
-- settings registry, so that the quote a member is shown, the figures written
-- when they apply, and the schedule built at disbursement cannot disagree.
--
-- Three things change here.
--
--  1. `quote_loan` prices the whole product, not part of it. Insurance and
--     application fees existed on paper and nowhere in the arithmetic; a
--     product could be configured to charge 1% insurance and the member would
--     still have been quoted, and charged, nothing. It also stops assuming the
--     repayment frequency is monthly, which is what makes a weekly product
--     something other than a monthly one with a misleading label.
--
--  2. `loan_eligibility` gathers the rules that decide whether a member may
--     borrow at all - the product's own requirements and the SACCO-wide ones
--     from the registry - and answers with every reason at once, so an
--     applicant is told the four things standing in their way rather than
--     discovering them one refused submission at a time.
--
--  3. `apply_for_loan` writes the terms snapshot 0017 made room for, and
--     `disburse_loan` builds the schedule on the loan's own snapshotted
--     frequency rather than on a hard-coded month.
--
-- The rule the whole file turns on: a quote reads the product, and everything
-- after application reads the loan. Once terms are snapshotted, editing the
-- product must not reach a loan that already exists.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Repayment frequency
--
-- A term is agreed in months whatever the frequency - "six months, paid
-- weekly" - so the frequency decides how many installments that term contains
-- and how far apart they fall, and nothing else.
-- ---------------------------------------------------------------------------

create or replace function loan_installments_for(p_period_months integer, p_frequency text)
returns integer language sql immutable as $fn$
  select greatest(1, round(
    p_period_months * case coalesce(p_frequency, 'monthly')
      when 'daily'    then 365.0 / 12.0
      when 'weekly'   then  52.0 / 12.0
      when 'biweekly' then  26.0 / 12.0
      else 1.0
    end)::integer);
$fn$;

/** Payments per year, which is the divisor for a reducing-balance rate. */
create or replace function loan_periods_per_year(p_frequency text)
returns numeric language sql immutable as $fn$
  select case coalesce(p_frequency, 'monthly')
           when 'daily' then 365.0 when 'weekly' then 52.0
           when 'biweekly' then 26.0 else 12.0 end;
$fn$;

/** The gap between two installments. */
create or replace function loan_installment_step(p_frequency text)
returns interval language sql immutable as $fn$
  select case coalesce(p_frequency, 'monthly')
           when 'daily'    then interval '1 day'
           when 'weekly'   then interval '7 days'
           when 'biweekly' then interval '14 days'
           else interval '1 month' end;
$fn$;

grant execute on function loan_installments_for(integer, text) to authenticated;
grant execute on function loan_periods_per_year(text)          to authenticated;
grant execute on function loan_installment_step(text)          to authenticated;

-- ---------------------------------------------------------------------------
-- Pricing
--
-- Signature unchanged from 0002: the member application and the staff loan
-- form both already call it this way.
-- ---------------------------------------------------------------------------

create or replace function quote_loan(
  p_product_id    uuid,
  p_principal     numeric,
  p_period_months integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  p          loan_products;
  v_n        integer;
  v_ppy      numeric;
  v_interest numeric(16,2);
  v_install  numeric(16,2);
  v_proc     numeric(16,2);
  v_ins      numeric(16,2);
  v_app      numeric(16,2);
  v_fees     numeric(16,2);
  v_total    numeric(16,2);
  v_years    numeric;
  r          numeric;
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

  v_n     := loan_installments_for(p_period_months, p.repayment_frequency);
  v_ppy   := loan_periods_per_year(p.repayment_frequency);
  v_years := p_period_months::numeric / 12.0;

  if p.interest_method = 'flat' then
    v_interest := round(p_principal * (p.interest_rate / 100.0) * v_years, 2);
    v_install  := round((p_principal + v_interest) / v_n, 2);
  else
    -- Reducing balance, equal installments: the standard annuity, with the
    -- rate divided by the number of payments a year rather than by twelve.
    r := (p.interest_rate / 100.0) / v_ppy;
    if r = 0 then
      v_install  := round(p_principal / v_n, 2);
      v_interest := 0;
    else
      v_install  := round(p_principal * r / (1 - power(1 + r, -v_n)), 2);
      v_interest := round(v_install * v_n - p_principal, 2);
    end if;
  end if;

  v_proc  := round(p_principal * (p.processing_fee_pct / 100.0), 2);
  v_ins   := round(p_principal * (p.insurance_fee_pct  / 100.0), 2);
  v_app   := round(p.application_fee, 2);
  v_fees  := v_proc + v_ins + v_app;
  v_total := p_principal + v_interest;

  return jsonb_build_object(
    'product_id',          p.id,
    'product_name',        p.name,
    'product_code',        p.code,
    'principal',           p_principal,
    'interest_rate',       p.interest_rate,
    'interest_method',     p.interest_method,
    'interest_amount',     v_interest,

    'processing_fee',      v_proc,
    'insurance_fee',       v_ins,
    'application_fee',     v_app,
    'total_fees',          v_fees,

    'total_payable',       v_total,
    'period_months',       p_period_months,
    'repayment_frequency', p.repayment_frequency,
    'installment_count',   v_n,
    'installment_amount',  v_install,
    'net_disbursed',       p_principal - v_fees,

    'late_penalty_pct',    p.late_penalty_pct,
    'penalty_basis',       p.penalty_basis,
    'grace_period_days',   p.grace_period_days,
    'requires_guarantors', p.requires_guarantors,
    'min_guarantors',      case when p.requires_guarantors then p.min_guarantors else 0 end,
    'requires_collateral', p.requires_collateral
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Eligibility
--
-- Answers with every reason at once. A member told "you need six months of
-- membership", who waits six months and is then told "you also need three
-- shares", has been failed by the software rather than by the rule.
--
-- `p_principal` is optional: with it, the borrowing-limit rules are checked
-- too; without it, this answers the standing question of whether the member
-- could borrow under this product at all.
-- ---------------------------------------------------------------------------

create or replace function loan_eligibility(
  p_member_id  uuid,
  p_product_id uuid,
  p_principal  numeric default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  p          loan_products;
  m          member_financials;
  v_reasons  jsonb := '[]'::jsonb;
  v_months   integer;
  v_active   integer;
  v_max_act  integer := setting_int('loans.max_active_per_member');
  v_mult     numeric := setting_number('loans.max_savings_multiple');
  v_min_mem  integer := setting_int('loans.min_membership_months');
  v_ceiling  numeric;
  v_req_mem  integer;
begin
  select * into p from loan_products where id = p_product_id;
  if not found then
    raise exception 'Loan product is not available.' using errcode = 'no_data_found';
  end if;

  select * into m from member_financials where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if not p.is_active then
    v_reasons := v_reasons || to_jsonb(format('%s is not currently offered.', p.name));
  end if;

  if m.status <> 'active' then
    v_reasons := v_reasons ||
      to_jsonb(format('Only active members may borrow. This member is %s.', m.status));
  end if;

  -- How many loans at once. The SACCO-wide setting replaces what used to be a
  -- flat "one loan at a time" written into the application function.
  select count(*) into v_active from loans
   where member_id = p_member_id
     and status in ('applied', 'under_review', 'approved', 'disbursed', 'active');
  if v_active >= v_max_act then
    v_reasons := v_reasons || to_jsonb(
      case when v_max_act = 1
        then 'This member already has a loan in progress. It must be closed before applying again.'
        else format('This member already has %s loans in progress, and the limit is %s.',
                    v_active, v_max_act) end);
  end if;

  -- Membership length: the product's own requirement, or the SACCO-wide floor,
  -- whichever is longer.
  v_req_mem := greatest(coalesce(p.min_membership_months, 0), coalesce(v_min_mem, 0));
  if v_req_mem > 0 then
    v_months := (extract(year from age(current_date, m.joined_on)) * 12
                 + extract(month from age(current_date, m.joined_on)))::integer;
    if v_months < v_req_mem then
      v_reasons := v_reasons || to_jsonb(format(
        'A member must have belonged for %s month(s) before borrowing under %s. This member has %s.',
        v_req_mem, p.name, v_months));
    end if;
  end if;

  if coalesce(p.min_savings_balance, 0) > 0
     and coalesce(m.savings_balance, 0) < p.min_savings_balance then
    v_reasons := v_reasons || to_jsonb(format(
      '%s requires savings of at least UGX %s. This member has UGX %s.',
      p.name, to_char(p.min_savings_balance, 'FM999,999,999'),
      to_char(coalesce(m.savings_balance, 0), 'FM999,999,999')));
  end if;

  if coalesce(p.required_shares, 0) > 0
     and coalesce(m.share_count, 0) < p.required_shares then
    v_reasons := v_reasons || to_jsonb(format(
      '%s requires %s share(s). This member holds %s.',
      p.name, p.required_shares, coalesce(m.share_count, 0)));
  end if;

  -- The borrowing ceiling: the product's own savings multiple if it sets one,
  -- otherwise the SACCO-wide one. Zero on both means no ceiling.
  v_ceiling := null;
  if coalesce(p.min_savings_multiple, 0) > 0 then
    v_ceiling := coalesce(m.savings_balance, 0) * p.min_savings_multiple;
  elsif coalesce(v_mult, 0) > 0 then
    v_ceiling := coalesce(m.savings_balance, 0) * v_mult;
  end if;

  if p_principal is not null then
    if p_principal < p.min_amount or p_principal > p.max_amount then
      v_reasons := v_reasons || to_jsonb(format(
        '%s is available between UGX %s and UGX %s.', p.name,
        to_char(p.min_amount, 'FM999,999,999'), to_char(p.max_amount, 'FM999,999,999')));
    end if;
    if v_ceiling is not null and p_principal > v_ceiling then
      v_reasons := v_reasons || to_jsonb(format(
        'With savings of UGX %s this member may borrow up to UGX %s.',
        to_char(coalesce(m.savings_balance, 0), 'FM999,999,999'),
        to_char(v_ceiling, 'FM999,999,999')));
    end if;
  end if;

  return jsonb_build_object(
    'eligible',            jsonb_array_length(v_reasons) = 0,
    'reasons',             v_reasons,
    'savings_balance',     coalesce(m.savings_balance, 0),
    'share_count',         coalesce(m.share_count, 0),
    'borrowing_ceiling',   v_ceiling,
    'max_amount',          p.max_amount,
    'requires_guarantors', p.requires_guarantors and setting_bool('loans.require_guarantors'),
    'min_guarantors',
      case when p.requires_guarantors and setting_bool('loans.require_guarantors')
           then p.min_guarantors else 0 end,
    'guarantor_cover_pct', setting_number('loans.guarantor_cover_pct'),
    'requires_collateral', p.requires_collateral,
    'collateral_notes',    p.collateral_notes,
    'eligibility_notes',   p.eligibility_notes
  );
end;
$fn$;

grant execute on function loan_eligibility(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Applying
--
-- Same signature as 0002. What is new: the eligibility rules come from the
-- product and the registry rather than from a single hard-coded sentence, the
-- guarantor requirement is checked against configured cover as well as count,
-- and the loan is written with the full snapshot of the terms it was agreed
-- under.
-- ---------------------------------------------------------------------------

create or replace function apply_for_loan(
  p_member_id        uuid,
  p_product_id       uuid,
  p_principal        numeric,
  p_period_months    integer,
  p_purpose          text,
  p_purpose_category text default null,
  p_guarantors       jsonb default '[]'::jsonb,
  p_idempotency_key  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
  if not (has_role('super_admin', 'manager', 'loan_officer')
          or current_member_id() = p_member_id) then
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
    next_document_no('LN', 5), p_member_id, p_product_id, v_product.name, v_product.code,
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
$fn$;

-- ---------------------------------------------------------------------------
-- Disbursing
--
-- The schedule is built from the loan's own snapshotted frequency, and the
-- insurance and application fees are booked alongside the processing fee that
-- 0002 already handled. All three are SACCO income taken at disbursement.
-- ---------------------------------------------------------------------------

create or replace function disburse_loan(
  p_loan_id         uuid,
  p_method          payment_method default 'cash',
  p_disbursed_on    date default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_loan    loans;
  v_old     jsonb;
  v_txn     transactions;
  v_member  members;
  v_first   date;
  v_on      date;
  v_i       integer;
  v_n       integer;
  v_step    interval;
  v_prin    numeric(16,2);
  v_int     numeric(16,2);
  v_fee_txn transactions;
  v_inc_cat uuid;
  v_fee     record;
begin
  perform assert_role('super_admin', 'manager');

  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_loan);

  if v_loan.status <> 'approved' then
    raise exception 'Only an approved loan can be disbursed (this one is %).', v_loan.status
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = v_loan.member_id;
  v_on := coalesce(p_disbursed_on, current_date);

  v_txn := post_transaction(
    v_loan.member_id, 'loan_disbursement', v_loan.principal, p_method, v_on,
    format('Disbursement of loan %s', v_loan.loan_no), p_idempotency_key
  );
  update transactions set loan_id = v_loan.id where id = v_txn.id;

  select id into v_inc_cat from income_categories where name = 'Service charges';

  -- The three fees the loan carries, each booked only if it is charged. They
  -- are read from the loan, not the product: a fee raised since this loan was
  -- agreed is not a fee this member consented to.
  for v_fee in
    select * from (values
      ('Processing fee',  v_loan.processing_fee,  'fee'),
      ('Insurance fee',   v_loan.insurance_fee,   'ins'),
      ('Application fee', v_loan.application_fee, 'app')
    ) as t(label, amount, suffix)
    where t.amount > 0
  loop
    v_fee_txn := post_transaction(
      v_loan.member_id, 'fee', v_fee.amount, 'internal', v_on,
      format('%s on loan %s', v_fee.label, v_loan.loan_no),
      case when p_idempotency_key is null then null
           else p_idempotency_key || ':' || v_fee.suffix end
    );
    update transactions set loan_id = v_loan.id where id = v_fee_txn.id;

    if v_inc_cat is not null then
      insert into income_entries (category_id, amount, description, received_on, method,
                                  member_id, loan_id, transaction_id, recorded_by)
      values (v_inc_cat, v_fee.amount,
              format('%s on loan %s', v_fee.label, v_loan.loan_no),
              v_on, 'internal', v_loan.member_id, v_loan.id, v_fee_txn.id, auth.uid())
      on conflict do nothing;
    end if;
  end loop;

  v_n    := coalesce(v_loan.installment_count,
                     loan_installments_for(v_loan.period_months, v_loan.repayment_frequency));
  v_step := loan_installment_step(v_loan.repayment_frequency);

  -- The first payment falls one whole period after disbursement, plus any
  -- grace period the product granted.
  v_first := (v_on + v_step + (v_loan.grace_period_days || ' days')::interval)::date;

  update loans
     set status       = 'active',
         disbursed_on = v_on,
         disbursed_by = auth.uid(),
         first_due_on = v_first,
         installment_count = v_n
   where id = p_loan_id
   returning * into v_loan;

  -- Build the amortisation schedule once, at disbursement.
  delete from loan_schedule where loan_id = v_loan.id;
  v_prin := round(v_loan.principal / v_n, 2);
  v_int  := round(v_loan.interest_amount / v_n, 2);
  for v_i in 1 .. v_n loop
    insert into loan_schedule (loan_id, installment_no, due_on,
                               principal_due, interest_due, total_due)
    values (
      v_loan.id, v_i,
      (v_first + (v_step * (v_i - 1)))::date,
      -- The last installment absorbs rounding so the schedule sums exactly.
      case when v_i < v_n then v_prin
           else v_loan.principal - v_prin * (v_n - 1) end,
      case when v_i < v_n then v_int
           else v_loan.interest_amount - v_int * (v_n - 1) end,
      case when v_i < v_n then v_prin + v_int
           else v_loan.total_payable - (v_prin + v_int) * (v_n - 1) end
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
                            'transaction_id', v_txn.id, 'first_due_on', v_first,
                            'installments', v_n);
end;
$fn$;

grant execute on function quote_loan(uuid, numeric, integer) to authenticated;
grant execute on function apply_for_loan(uuid, uuid, numeric, integer, text, text, jsonb, text)
  to authenticated;
grant execute on function disburse_loan(uuid, payment_method, date, text) to authenticated;
