-- ===========================================================================
-- BUD-SACCO - 0017 - Loan products, in full, and the terms a loan keeps
--
-- Two halves.
--
--  1. `loan_products` grows the terms a SACCO actually prices a loan on:
--     insurance and application fees, a late penalty and the grace period it
--     starts after, a repayment frequency, and the eligibility rules that
--     decide who may borrow under it. Until now a product carried an interest
--     rate, a processing fee and little else, so every other term was either
--     absent or the same for every product by accident.
--
--  2. `loans` gains a snapshot of those terms, taken when the application is
--     written. This is the half that matters most. A product is a live record
--     a manager edits; a loan is a contract that was agreed on a particular
--     day. Raising the business-loan rate from 15% to 18% must change what the
--     next applicant is quoted and nothing whatever about the loan a member is
--     already repaying.
--
--     The loan already stored its own `interest_rate`, `interest_method` and
--     `processing_fee` - that instinct was right from 0001 and this extends it
--     to every term, plus a `terms` jsonb holding the product exactly as it
--     read at the moment of application, for anything a later question asks
--     that these columns did not anticipate.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Product terms
-- ---------------------------------------------------------------------------

alter table loan_products
  add column if not exists category            text,
  add column if not exists insurance_fee_pct   numeric(6,3)  not null default 0,
  add column if not exists application_fee     numeric(16,2) not null default 0,
  add column if not exists late_penalty_pct    numeric(6,3)  not null default 0,
  add column if not exists penalty_basis       text          not null default 'overdue',
  add column if not exists grace_period_days   integer       not null default 0,
  add column if not exists repayment_frequency text          not null default 'monthly',

  -- Eligibility. Zero consistently means "no requirement", which keeps the
  -- checks in 0018 free of null handling on every line.
  add column if not exists min_savings_balance   numeric(16,2) not null default 0,
  add column if not exists min_savings_multiple  numeric(6,2)  not null default 0,
  add column if not exists min_membership_months integer       not null default 0,
  add column if not exists required_shares       integer       not null default 0,
  add column if not exists requires_guarantors   boolean       not null default true,
  add column if not exists requires_collateral   boolean       not null default false,
  add column if not exists collateral_notes      text,
  add column if not exists eligibility_notes     text,
  add column if not exists instructions          text,

  add column if not exists sort_order  integer not null default 100,
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists updated_by  uuid references app_users (id);

do $$ begin
  alter table loan_products add constraint loan_products_insurance_fee_range
    check (insurance_fee_pct >= 0 and insurance_fee_pct <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table loan_products add constraint loan_products_application_fee_range
    check (application_fee >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table loan_products add constraint loan_products_penalty_range
    check (late_penalty_pct >= 0 and late_penalty_pct <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table loan_products add constraint loan_products_penalty_basis_known
    check (penalty_basis in ('overdue', 'installment', 'outstanding'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table loan_products add constraint loan_products_frequency_known
    check (repayment_frequency in ('daily', 'weekly', 'biweekly', 'monthly'));
exception when duplicate_object then null; end $$;

-- "Grace period cannot exceed the loan term." The term is in months and the
-- grace period in days, so the comparison needs a month length - 31 days is the
-- generous reading, and the generous reading is the right one for a rule whose
-- purpose is to catch a typed 300 where 30 was meant.
do $$ begin
  alter table loan_products add constraint loan_products_grace_within_term
    check (grace_period_days >= 0 and grace_period_days <= max_period_months * 31);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table loan_products add constraint loan_products_eligibility_non_negative
    check (min_savings_balance >= 0 and min_savings_multiple >= 0
           and min_membership_months >= 0 and required_shares >= 0);
exception when duplicate_object then null; end $$;

create index if not exists loan_products_active_idx
  on loan_products (is_active, sort_order, name);

/** Touch `updated_at` on any write, including ones that bypass the functions. */
create or replace function loan_products_touch()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists loan_products_set_updated_at on loan_products;
create trigger loan_products_set_updated_at
  before update on loan_products
  for each row execute function loan_products_touch();

-- ---------------------------------------------------------------------------
-- The terms a loan keeps
-- ---------------------------------------------------------------------------

alter table loans
  -- Named here so a renamed or retired product cannot rewrite what a printed
  -- agreement said the loan was.
  add column if not exists product_name        text,
  add column if not exists product_code        text,

  add column if not exists insurance_fee       numeric(16,2) not null default 0,
  add column if not exists application_fee     numeric(16,2) not null default 0,
  add column if not exists late_penalty_pct    numeric(6,3)  not null default 0,
  add column if not exists penalty_basis       text          not null default 'overdue',
  add column if not exists grace_period_days   integer       not null default 0,
  add column if not exists repayment_frequency text          not null default 'monthly',
  add column if not exists installment_count   integer,

  /**
   * The product as it read at the moment of application.
   *
   * The typed columns above carry everything the arithmetic needs. This holds
   * the rest - the eligibility rules that were in force, the instructions the
   * member was shown - so that a question nobody thought to ask in 2026 can
   * still be answered from the record in 2031.
   */
  add column if not exists terms jsonb;

do $$ begin
  alter table loans add constraint loans_frequency_known
    check (repayment_frequency in ('daily', 'weekly', 'biweekly', 'monthly'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table loans add constraint loans_fees_non_negative
    check (insurance_fee >= 0 and application_fee >= 0
           and late_penalty_pct >= 0 and grace_period_days >= 0);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Loans written before this migration have no snapshot. The honest thing is to
-- reconstruct one from what is actually known and to say plainly that it was
-- reconstructed, rather than to present a guess as a contemporaneous record.
--
-- The loan's own `interest_rate`, `interest_method` and `processing_fee` are
-- authoritative - they were copied from the product at application time and
-- are what the loan has been charged on. The remaining terms did not exist
-- when these loans were written, so they take the defaults above (no insurance
-- fee, no penalty, monthly repayment), which is exactly how those loans have
-- in fact been treated. Nothing here changes a figure on an existing loan.
-- ---------------------------------------------------------------------------

update loans l
   set product_name = p.name,
       product_code = p.code,
       installment_count = coalesce(l.installment_count, l.period_months),
       terms = jsonb_build_object(
         'reconstructed', true,
         'reconstructed_at', now(),
         'note', 'Written before terms were snapshotted. Interest rate, method and '
                 'processing fee are the loan''s own recorded values; the remaining '
                 'terms are the defaults these loans were always treated under.',
         'product_id', p.id,
         'product_name', p.name,
         'product_code', p.code,
         'interest_rate', l.interest_rate,
         'interest_method', l.interest_method,
         'processing_fee', l.processing_fee,
         'repayment_frequency', 'monthly',
         'insurance_fee_pct', 0,
         'application_fee', 0,
         'late_penalty_pct', 0,
         'grace_period_days', 0)
  from loan_products p
 where p.id = l.product_id
   and l.terms is null;

-- ---------------------------------------------------------------------------
-- Creating and editing a product
--
-- One function for both, taking the product as a jsonb payload rather than as
-- twenty-six positional arguments. A positional signature that long is a
-- standing invitation to transpose two numerics of the same type - to swap the
-- insurance fee with the application fee, silently, in a way no type checker
-- catches and no test notices until a member is overcharged.
--
-- `p_product_id` null creates; not null edits.
-- ---------------------------------------------------------------------------

create or replace function assert_loan_product_payload_valid(p jsonb)
returns void language plpgsql immutable as $fn$
declare
  v_min_amt   numeric := coalesce((p ->> 'min_amount')::numeric, 0);
  v_max_amt   numeric := coalesce((p ->> 'max_amount')::numeric, 0);
  v_min_term  integer := coalesce((p ->> 'min_period_months')::integer, 0);
  v_max_term  integer := coalesce((p ->> 'max_period_months')::integer, 0);
  v_rate      numeric := coalesce((p ->> 'interest_rate')::numeric, -1);
  v_grace     integer := coalesce((p ->> 'grace_period_days')::integer, 0);
  v_guarantors integer := coalesce((p ->> 'min_guarantors')::integer, 0);
  v_code      text    := upper(btrim(coalesce(p ->> 'code', '')));
begin
  if coalesce(btrim(p ->> 'name'), '') = '' then
    raise exception 'Enter a name for the product.' using errcode = 'check_violation';
  end if;
  if v_code = '' then
    raise exception 'Enter a short code, for example BIZ.' using errcode = 'check_violation';
  end if;
  if v_code !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'The code must be 2-10 capital letters or digits.'
      using errcode = 'check_violation';
  end if;

  if v_rate < 0 then
    raise exception 'Enter an interest rate of zero or more.' using errcode = 'check_violation';
  end if;
  if v_rate > 100 then
    raise exception 'An interest rate above 100%% per year is almost certainly a typing error.'
      using errcode = 'check_violation';
  end if;
  if coalesce(p ->> 'interest_method', 'flat') not in ('flat', 'reducing') then
    raise exception 'Choose either flat or reducing balance interest.'
      using errcode = 'check_violation';
  end if;

  if v_min_amt < 0 then
    raise exception 'The smallest amount cannot be negative.' using errcode = 'check_violation';
  end if;
  if v_max_amt <= 0 then
    raise exception 'Enter the largest amount a member may borrow.'
      using errcode = 'check_violation';
  end if;
  if v_max_amt < v_min_amt then
    raise exception 'The largest amount (UGX %) must be at least the smallest amount (UGX %).',
      trim(to_char(v_max_amt, 'FM999,999,999')), trim(to_char(v_min_amt, 'FM999,999,999'))
      using errcode = 'check_violation';
  end if;

  if v_min_term < 1 then
    raise exception 'The shortest term must be at least one month.'
      using errcode = 'check_violation';
  end if;
  if v_max_term < v_min_term then
    raise exception 'The longest term (% months) must be at least the shortest term (% months).',
      v_max_term, v_min_term using errcode = 'check_violation';
  end if;

  if coalesce((p ->> 'processing_fee_pct')::numeric, 0) < 0
     or coalesce((p ->> 'insurance_fee_pct')::numeric, 0) < 0
     or coalesce((p ->> 'application_fee')::numeric, 0) < 0
     or coalesce((p ->> 'late_penalty_pct')::numeric, 0) < 0 then
    raise exception 'A fee or penalty cannot be negative.' using errcode = 'check_violation';
  end if;
  if coalesce((p ->> 'processing_fee_pct')::numeric, 0) > 100
     or coalesce((p ->> 'insurance_fee_pct')::numeric, 0) > 100
     or coalesce((p ->> 'late_penalty_pct')::numeric, 0) > 100 then
    raise exception 'A percentage fee or penalty above 100%% is almost certainly a typing error.'
      using errcode = 'check_violation';
  end if;

  if v_guarantors < 0 then
    raise exception 'The number of guarantors cannot be negative.'
      using errcode = 'check_violation';
  end if;
  if coalesce((p ->> 'requires_guarantors')::boolean, true) and v_guarantors = 0 then
    raise exception 'This product requires guarantors, so enter how many are needed.'
      using errcode = 'check_violation';
  end if;

  -- Grace period against the term, in the same units.
  if v_grace < 0 then
    raise exception 'The grace period cannot be negative.' using errcode = 'check_violation';
  end if;
  if v_grace > v_max_term * 31 then
    raise exception 'A grace period of % days is longer than the longest term (% months).',
      v_grace, v_max_term using errcode = 'check_violation';
  end if;

  if coalesce(p ->> 'repayment_frequency', 'monthly')
       not in ('daily', 'weekly', 'biweekly', 'monthly') then
    raise exception 'Choose a repayment frequency: daily, weekly, bi-weekly or monthly.'
      using errcode = 'check_violation';
  end if;
  if coalesce(p ->> 'penalty_basis', 'overdue')
       not in ('overdue', 'installment', 'outstanding') then
    raise exception 'Choose what the late penalty is charged on.'
      using errcode = 'check_violation';
  end if;

  if coalesce((p ->> 'min_savings_balance')::numeric, 0) < 0
     or coalesce((p ->> 'min_savings_multiple')::numeric, 0) < 0
     or coalesce((p ->> 'min_membership_months')::integer, 0) < 0
     or coalesce((p ->> 'required_shares')::integer, 0) < 0 then
    raise exception 'An eligibility requirement cannot be negative.'
      using errcode = 'check_violation';
  end if;
end;
$fn$;

create or replace function save_loan_product(
  p_product_id uuid,
  p_payload    jsonb,
  p_reason     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old  loan_products;
  v_new  loan_products;
  v_code text := upper(btrim(coalesce(p_payload ->> 'code', '')));
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
begin
  perform assert_capability(can_manage_settings(), 'manage loan products');
  perform assert_loan_product_payload_valid(p_payload);

  if exists (select 1 from loan_products
              where upper(code) = v_code
                and (p_product_id is null or id <> p_product_id)) then
    raise exception 'A product with the code % already exists.', v_code
      using errcode = 'unique_violation';
  end if;
  if exists (select 1 from loan_products
              where lower(name) = lower(v_name)
                and (p_product_id is null or id <> p_product_id)) then
    raise exception 'A product called % already exists.', v_name
      using errcode = 'unique_violation';
  end if;

  if p_product_id is not null then
    select * into v_old from loan_products where id = p_product_id;
    if not found then
      raise exception 'That loan product could not be found.' using errcode = 'no_data_found';
    end if;
  end if;

  insert into loan_products as lp (
    id, name, code, description, category,
    interest_rate, interest_method,
    min_amount, max_amount, min_period_months, max_period_months,
    repayment_frequency,
    processing_fee_pct, insurance_fee_pct, application_fee,
    late_penalty_pct, penalty_basis, grace_period_days,
    min_savings_balance, min_savings_multiple, min_membership_months, required_shares,
    requires_guarantors, min_guarantors, requires_collateral, collateral_notes,
    eligibility_notes, instructions, is_active, sort_order, updated_by
  )
  values (
    coalesce(p_product_id, gen_random_uuid()), v_name, v_code,
    nullif(btrim(coalesce(p_payload ->> 'description', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'category', '')), ''),
    (p_payload ->> 'interest_rate')::numeric,
    coalesce(p_payload ->> 'interest_method', 'flat'),
    coalesce((p_payload ->> 'min_amount')::numeric, 0),
    (p_payload ->> 'max_amount')::numeric,
    coalesce((p_payload ->> 'min_period_months')::integer, 1),
    (p_payload ->> 'max_period_months')::integer,
    coalesce(p_payload ->> 'repayment_frequency', 'monthly'),
    coalesce((p_payload ->> 'processing_fee_pct')::numeric, 0),
    coalesce((p_payload ->> 'insurance_fee_pct')::numeric, 0),
    coalesce((p_payload ->> 'application_fee')::numeric, 0),
    coalesce((p_payload ->> 'late_penalty_pct')::numeric, 0),
    coalesce(p_payload ->> 'penalty_basis', 'overdue'),
    coalesce((p_payload ->> 'grace_period_days')::integer, 0),
    coalesce((p_payload ->> 'min_savings_balance')::numeric, 0),
    coalesce((p_payload ->> 'min_savings_multiple')::numeric, 0),
    coalesce((p_payload ->> 'min_membership_months')::integer, 0),
    coalesce((p_payload ->> 'required_shares')::integer, 0),
    coalesce((p_payload ->> 'requires_guarantors')::boolean, true),
    coalesce((p_payload ->> 'min_guarantors')::integer, 0),
    coalesce((p_payload ->> 'requires_collateral')::boolean, false),
    nullif(btrim(coalesce(p_payload ->> 'collateral_notes', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'eligibility_notes', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'instructions', '')), ''),
    coalesce((p_payload ->> 'is_active')::boolean, true),
    coalesce((p_payload ->> 'sort_order')::integer, 100),
    auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name, code = excluded.code, description = excluded.description,
    category = excluded.category,
    interest_rate = excluded.interest_rate, interest_method = excluded.interest_method,
    min_amount = excluded.min_amount, max_amount = excluded.max_amount,
    min_period_months = excluded.min_period_months,
    max_period_months = excluded.max_period_months,
    repayment_frequency = excluded.repayment_frequency,
    processing_fee_pct = excluded.processing_fee_pct,
    insurance_fee_pct = excluded.insurance_fee_pct,
    application_fee = excluded.application_fee,
    late_penalty_pct = excluded.late_penalty_pct,
    penalty_basis = excluded.penalty_basis,
    grace_period_days = excluded.grace_period_days,
    min_savings_balance = excluded.min_savings_balance,
    min_savings_multiple = excluded.min_savings_multiple,
    min_membership_months = excluded.min_membership_months,
    required_shares = excluded.required_shares,
    requires_guarantors = excluded.requires_guarantors,
    min_guarantors = excluded.min_guarantors,
    requires_collateral = excluded.requires_collateral,
    collateral_notes = excluded.collateral_notes,
    eligibility_notes = excluded.eligibility_notes,
    instructions = excluded.instructions,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order,
    updated_by = excluded.updated_by
  returning * into v_new;

  -- Loans already written carry their own terms, snapshotted at application.
  -- Editing a product changes what the next application is quoted, and nothing
  -- about a loan already on the books.
  perform write_audit(
    case when p_product_id is null then 'loan_product.created' else 'loan_product.updated' end,
    'Settings', v_new.id::text,
    format('Loan product %s (%s) %s at %s%% %s',
           v_new.name, v_new.code,
           case when p_product_id is null then 'created' else 'updated' end,
           v_new.interest_rate, v_new.interest_method),
    case when p_product_id is null then null else to_jsonb(v_old) end,
    to_jsonb(v_new),
    nullif(btrim(coalesce(p_reason, '')), ''));

  return to_jsonb(v_new);
end;
$fn$;

grant execute on function save_loan_product(uuid, jsonb, text)      to authenticated;
grant execute on function assert_loan_product_payload_valid(jsonb)  to authenticated;
