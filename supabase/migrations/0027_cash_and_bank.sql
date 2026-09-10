-- ===========================================================================
-- BUD-SACCO - 0027 - Cash at Merchant, Cash at Bank and Cash at Hand
--
-- The question this migration exists to answer at any moment: where is the
-- SACCO's money?
--
--     Cash at Merchant   money collected through the merchant code / mobile
--                        money, still sitting in the merchant wallet
--     Cash at Bank       money in the SACCO's bank account(s)
--     Cash at Hand       physical cash in the office
--
-- DESIGN
--
-- There is still exactly one financial ledger: `transactions`. What is new is
-- the account side of it. Every ledger row that moves money now names the
-- account the money came out of (`source_account_id`), the account it went into
-- (`destination_account_id`), or both, and `account_ledger_entries` holds one
-- immutable debit or credit per account it touched. An account balance is its
-- opening balance plus the sum of those entries - never a column anyone can
-- type into.
--
--   * A member collection is one ledger row with a destination account:
--     savings up, the receiving account up.
--   * An expense, a payment, a loan disbursement or a member withdrawal is one
--     ledger row with a source account.
--   * An internal transfer (merchant -> bank, cash -> bank, bank -> cash,
--     bank -> bank) is ONE ledger row with both, posting a credit to one account
--     and a debit to the other in the same statement. It is neither income nor
--     expense, and total SACCO funds do not change.
--   * A reversal swaps the two accounts of the row it reverses, so every entry
--     is undone by its mirror image and both stay on the record.
--
-- The accounts are resolved by triggers on `transactions`, which is why every
-- money path written before this migration - the collection screen, share
-- sales, repayments, disbursements, expenses, reversals - posts to the right
-- account without a single one of those functions being rewritten. Where a
-- person chooses the account (the Record Collection form), the choice is passed
-- down as a transaction-local setting; otherwise the payment method decides:
-- mobile money -> the merchant account, cash -> Cash at Hand, bank transfer or
-- cheque -> the bank account.
--
-- Transfers and payments are documents with a life of their own - draft,
-- submitted, completed, rejected, cancelled, reversed - because a cashier's
-- merchant-to-bank transfer may need a manager's approval before it happens.
-- Nothing reaches the ledger until the document completes.
--
-- PHASE ONE IS MANUAL. Nothing here calls MTN, Airtel, a bank or any gateway.
-- A provider reference typed by a member of staff is recorded as typed; the
-- system never claims to have verified it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Capabilities
-- ---------------------------------------------------------------------------

/** Approving transfers, payments and expenses. */
create or replace function can_approve_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager');
$$;

/** Recording a reconciliation - the counted cash, the bank statement balance. */
create or replace function can_reconcile_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'accountant');
$$;

/** Creating and editing the merchant, bank and cash accounts themselves. */
create or replace function can_manage_finance_accounts()
returns boolean language sql stable security definer set search_path = public as $$
  select can_manage_settings();
$$;

grant execute on function can_approve_finance()         to authenticated;
grant execute on function can_reconcile_finance()       to authenticated;
grant execute on function can_manage_finance_accounts() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Small helpers
-- ---------------------------------------------------------------------------

/** "UGX 1,250,000" - for messages and audit summaries. */
create or replace function ugx(p numeric)
returns text language sql immutable as $$
  select 'UGX ' || to_char(coalesce(p, 0), 'FM999,999,999,999,990');
$$;

create or replace function payment_method_label(p payment_method)
returns text language sql immutable as $$
  select case p
           when 'cash'          then 'cash'
           when 'mobile_money'  then 'mobile money'
           when 'bank_transfer' then 'bank transfer'
           when 'cheque'        then 'cheque'
           else 'internal' end;
$$;

/**
 * Which way a ledger row moves money, from the SACCO's point of view.
 *   +1  money received into an account
 *   -1  money paid out of an account
 *    0  money moving between two of the SACCO's own accounts
 */
create or replace function txn_cash_direction(p_type txn_type)
returns smallint language sql immutable as $$
  select case
           when p_type in ('share_purchase', 'weekly_savings', 'monthly_savings',
                           'loan_repayment', 'deposit', 'income', 'fee', 'penalty') then 1
           when p_type in ('loan_disbursement', 'withdrawal', 'expense', 'payment') then -1
           else 0 end::smallint;
$$;

/** The kinds of account a payment method can arrive in or leave from. */
create or replace function finance_account_types_for_method(p_method payment_method)
returns finance_account_type[] language sql immutable as $$
  select case p_method
           when 'cash'          then array['cash']::finance_account_type[]
           when 'mobile_money'  then array['merchant']::finance_account_type[]
           when 'bank_transfer' then array['bank']::finance_account_type[]
           when 'cheque'        then array['bank']::finance_account_type[]
           else array['merchant', 'bank', 'cash']::finance_account_type[] end;
$$;

/** The payment method implied by the account money arrives in. */
create or replace function method_for_account_type(
  p_type      finance_account_type,
  p_preferred payment_method default null
) returns payment_method language sql immutable as $$
  select case p_type
           when 'cash'     then 'cash'::payment_method
           when 'merchant' then 'mobile_money'::payment_method
           else case when p_preferred in ('bank_transfer', 'cheque') then p_preferred
                     else 'bank_transfer'::payment_method end
         end;
$$;

create or replace function transfer_kind_for(
  p_source      finance_account_type,
  p_destination finance_account_type
) returns transfer_kind language sql immutable as $$
  select case
           when p_source = 'merchant' and p_destination = 'bank' then 'merchant_to_bank'::transfer_kind
           when p_source = 'cash'     and p_destination = 'bank' then 'cash_to_bank'::transfer_kind
           when p_source = 'bank'     and p_destination = 'cash' then 'bank_to_cash'::transfer_kind
           when p_source = 'bank'     and p_destination = 'bank' then 'bank_to_bank'::transfer_kind
         end;
$$;

grant execute on function ugx(numeric)                                        to authenticated;
grant execute on function payment_method_label(payment_method)                to authenticated;
grant execute on function txn_cash_direction(txn_type)                        to authenticated;
grant execute on function finance_account_types_for_method(payment_method)    to authenticated;
grant execute on function method_for_account_type(finance_account_type, payment_method) to authenticated;
grant execute on function transfer_kind_for(finance_account_type, finance_account_type) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The accounts
--
-- One row per real place money is held. A SACCO may run more than one bank
-- account, and nothing here assumes which bank: bank name, branch and number
-- are data. The merchant code is data too, readable only by the finance roles.
--
-- `opening_balance` is the balance on `opening_date`, the day the account was
-- brought into the system. It is fixed the moment the first entry posts
-- against the account; after that the balance is whatever the entries say.
-- ---------------------------------------------------------------------------
create table if not exists financial_accounts (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null check (code ~ '^[A-Z]{3}-[0-9]{3,}$'),
  name               text unique not null check (length(btrim(name)) > 0),
  account_type       finance_account_type not null,

  -- Merchant / mobile money
  provider           text,
  merchant_code      text,
  account_identifier text,          -- wallet phone number or account id

  -- Bank
  bank_name          text,
  branch             text,
  account_number     text,

  currency           text not null default 'UGX' check (currency ~ '^[A-Z]{3}$'),
  opening_balance    numeric(16,2) not null default 0 check (opening_balance >= 0),
  opening_date       date not null default current_date,
  status             finance_account_status not null default 'active',
  is_default         boolean not null default false,
  description        text,

  created_by         uuid references app_users (id),
  updated_by         uuid references app_users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint financial_accounts_merchant_details
    check (account_type <> 'merchant' or length(btrim(coalesce(provider, ''))) > 0),
  constraint financial_accounts_bank_details
    check (account_type <> 'bank'
           or (length(btrim(coalesce(bank_name, ''))) > 0
               and length(btrim(coalesce(account_number, ''))) > 0)),
  -- A default that cannot take postings would send the collection screen to a
  -- dead end.
  constraint financial_accounts_default_is_active
    check (not is_default or status = 'active')
);

-- At most one default account of each kind: the one mobile money, cash or a
-- bank transfer lands in when nobody chose.
create unique index if not exists financial_accounts_one_default_idx
  on financial_accounts (account_type) where is_default;

create index if not exists financial_accounts_type_idx
  on financial_accounts (account_type, status);

drop trigger if exists financial_accounts_updated on financial_accounts;
create trigger financial_accounts_updated
  before update on financial_accounts
  for each row execute function set_updated_at();

/** MER-001, BNK-002, CSH-001. */
create or replace function next_account_code(p_type finance_account_type)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_prefix text := case p_type when 'merchant' then 'MER' when 'bank' then 'BNK' else 'CSH' end;
  v_next   bigint;
begin
  insert into doc_counters (scope, last_value) values ('ACCT-' || v_prefix, 1)
  on conflict (scope) do update set last_value = doc_counters.last_value + 1
  returning last_value into v_next;
  return v_prefix || '-' || lpad(v_next::text, 3, '0');
end;
$$;

revoke all on function next_account_code(finance_account_type) from public;

-- ---------------------------------------------------------------------------
-- 4. The account ledger
--
-- One row per account a ledger transaction touched. `debit` is money into the
-- account, `credit` money out of it; exactly one of the two is non-zero.
-- `balance_after` is the account's balance immediately after this posting, in
-- posting order - an audit snapshot that lets anyone check the chain has not
-- been tampered with. Statements by date compute their running balance by
-- date instead (see `account_movements`).
-- ---------------------------------------------------------------------------
create table if not exists account_ledger_entries (
  id             bigserial primary key,
  transaction_id uuid not null references transactions (id) on delete restrict,
  account_id     uuid not null references financial_accounts (id) on delete restrict,
  entry_date     date not null,
  debit          numeric(16,2) not null default 0 check (debit >= 0),
  credit         numeric(16,2) not null default 0 check (credit >= 0),
  balance_after  numeric(16,2) not null,
  created_by     uuid references app_users (id),
  created_at     timestamptz not null default now(),

  constraint account_ledger_entries_one_side check ((debit > 0) <> (credit > 0)),
  -- A transaction touches an account once. This is also what makes a replayed
  -- trigger unable to post the same money twice.
  constraint account_ledger_entries_once unique (transaction_id, account_id)
);

create index if not exists account_ledger_entries_account_idx
  on account_ledger_entries (account_id, entry_date, id);
create index if not exists account_ledger_entries_account_seq_idx
  on account_ledger_entries (account_id, id desc);
create index if not exists account_ledger_entries_date_idx
  on account_ledger_entries (entry_date);

create or replace function guard_account_ledger_immutability()
returns trigger language plpgsql as $$
begin
  raise exception 'Account ledger entries cannot be changed or deleted. Post a reversal instead.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists account_ledger_entries_immutable on account_ledger_entries;
create trigger account_ledger_entries_immutable
  before update or delete on account_ledger_entries
  for each row execute function guard_account_ledger_immutability();

/** An account's opening balance and kind are fixed once money has moved through it. */
create or replace function guard_financial_account()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Accounts are never deleted. Close the account instead.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from account_ledger_entries where account_id = old.id) then
    if new.opening_balance is distinct from old.opening_balance then
      raise exception 'The opening balance of % cannot change once entries have been posted to it.', old.name
        using errcode = 'check_violation';
    end if;
    if new.account_type is distinct from old.account_type then
      raise exception '% has entries posted to it, so its type cannot change.', old.name
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists financial_accounts_guard on financial_accounts;
create trigger financial_accounts_guard
  before update or delete on financial_accounts
  for each row execute function guard_financial_account();

-- ---------------------------------------------------------------------------
-- 5. The ledger gains its accounts
-- ---------------------------------------------------------------------------
alter table transactions
  add column if not exists source_account_id      uuid references financial_accounts (id),
  add column if not exists destination_account_id uuid references financial_accounts (id);

create index if not exists transactions_source_account_idx
  on transactions (source_account_id) where source_account_id is not null;
create index if not exists transactions_destination_account_idx
  on transactions (destination_account_id) where destination_account_id is not null;

-- The 0002 immutability guard, extended: once a row names its accounts, those
-- cannot be rewritten either.
create or replace function guard_transaction_immutability()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Transactions cannot be deleted. Post a reversal instead (ref %).', old.reference
      using errcode = 'check_violation';
  end if;

  if new.reference      is distinct from old.reference
     or new.amount      is distinct from old.amount
     or new.type        is distinct from old.type
     or new.member_id   is distinct from old.member_id
     or new.occurred_on is distinct from old.occurred_on
     or new.created_at  is distinct from old.created_at
     or (old.source_account_id is not null
         and new.source_account_id is distinct from old.source_account_id)
     or (old.destination_account_id is not null
         and new.destination_account_id is distinct from old.destination_account_id)
  then
    raise exception 'Transaction % is immutable. Post a reversal instead.', old.reference
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Which account? - resolving and posting
-- ---------------------------------------------------------------------------

/**
 * The account of a given kind that money lands in when nobody chose one: the
 * default, or the only active account of that kind. Null when neither exists -
 * two bank accounts and no default is a question for a person, not a guess.
 */
create or replace function default_financial_account(p_type finance_account_type)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
  v_n  integer;
begin
  select id into v_id from financial_accounts
   where account_type = p_type and status = 'active' and is_default
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select count(*) into v_n from financial_accounts
   where account_type = p_type and status = 'active';
  if v_n = 1 then
    select id into v_id from financial_accounts
     where account_type = p_type and status = 'active';
    return v_id;
  end if;

  return null;
end;
$$;

grant execute on function default_financial_account(finance_account_type) to authenticated;

/**
 * The account a ledger row with this payment method posts against.
 *
 *   1. The account a person chose, passed down as `bnd.account_id`. It must be
 *      a kind of account that payment method can actually reach.
 *   2. For an 'internal' row - the loan fees withheld at disbursement - the
 *      account the row immediately before it in this database transaction
 *      used, so the fee lands where the disbursement left from.
 *   3. The default account for the method.
 */
create or replace function resolve_posting_account(p_method payment_method)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pick  text := nullif(current_setting('bnd.account_id', true), '');
  v_last  text := nullif(current_setting('bnd.last_account_id', true), '');
  v_types finance_account_type[] := finance_account_types_for_method(p_method);
  v_acct  financial_accounts;
  v_id    uuid;
begin
  if v_pick is not null then
    select * into v_acct from financial_accounts where id = v_pick::uuid;
    if not found then
      raise exception 'The chosen account no longer exists.' using errcode = 'no_data_found';
    end if;
    if not (v_acct.account_type = any (v_types)) then
      raise exception '% is a % account and cannot handle a % payment. Choose a matching account or change the payment method.',
        v_acct.name, v_acct.account_type, payment_method_label(p_method)
        using errcode = 'check_violation';
    end if;
    return v_acct.id;
  end if;

  if p_method = 'internal' then
    if v_last is null then
      raise exception 'An internal entry must follow a posting to one of the SACCO''s accounts.'
        using errcode = 'check_violation';
    end if;
    return v_last::uuid;
  end if;

  v_id := default_financial_account(v_types[1]);
  if v_id is null then
    raise exception '%',
      case v_types[1]
        when 'merchant' then 'No merchant account is set up to receive mobile money. A manager can add one under Finance > Accounts.'
        when 'bank'     then 'No bank account is set up (or none is marked as the default) for bank and cheque payments. A manager can set one under Finance > Accounts.'
        else                 'No Cash at Hand account is set up. A manager can add one under Finance > Accounts.'
      end
      using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;

revoke all on function resolve_posting_account(payment_method) from public;

/**
 * Post one debit or credit against one account, under a lock on the account
 * row, and refuse to take a balance below zero unless the SACCO has chosen to
 * allow that.
 */
create or replace function post_account_entry(
  p_transaction_id uuid,
  p_account_id     uuid,
  p_entry_date     date,
  p_debit          numeric,
  p_credit         numeric,
  p_is_reversal    boolean default false
) returns account_ledger_entries
language plpgsql security definer set search_path = public as $$
declare
  v_acct     financial_accounts;
  v_prev     numeric(16,2);
  v_new      numeric(16,2);
  v_row      account_ledger_entries;
  v_backfill boolean := coalesce(current_setting('bnd.backfill', true), '') = 'on';
begin
  select * into v_acct from financial_accounts where id = p_account_id for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'no_data_found';
  end if;

  if v_acct.status <> 'active' and not p_is_reversal and not v_backfill then
    raise exception '% is % and cannot take new entries.', v_acct.name, v_acct.status
      using errcode = 'check_violation';
  end if;

  -- The last posting's balance is the current balance, because the account row
  -- is locked and postings are strictly sequential per account.
  select balance_after into v_prev
    from account_ledger_entries
   where account_id = p_account_id
   order by id desc
   limit 1;
  v_prev := coalesce(v_prev, v_acct.opening_balance);
  v_new  := v_prev + coalesce(p_debit, 0) - coalesce(p_credit, 0);

  if v_new < 0 and not v_backfill
     and not coalesce(setting_bool('treasury.allow_negative_balances'), false) then
    raise exception '% holds %. Taking out % would leave it below zero.',
      v_acct.name, ugx(v_prev), ugx(p_credit)
      using errcode = 'check_violation';
  end if;

  insert into account_ledger_entries (transaction_id, account_id, entry_date,
                                      debit, credit, balance_after, created_by)
  values (p_transaction_id, p_account_id, p_entry_date,
          coalesce(p_debit, 0), coalesce(p_credit, 0), v_new, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function post_account_entry(uuid, uuid, date, numeric, numeric, boolean) from public;

-- ---------------------------------------------------------------------------
-- 7. Receipts
--
-- Every sum of money received into an account gets a receipt number,
-- BND-RCT-2026-000001, the moment it is posted. Everything else printed on the
-- receipt - payer, amount, category, account - is read from the ledger row, so
-- the receipt register can never disagree with the books.
-- ---------------------------------------------------------------------------
create table if not exists receipts (
  id             uuid primary key default gen_random_uuid(),
  receipt_no     text unique not null,
  transaction_id uuid unique not null references transactions (id) on delete restrict,
  payer_name     text,             -- for receipts from someone who is not a member
  created_by     uuid references app_users (id),
  created_at     timestamptz not null default now()
);

create index if not exists receipts_created_idx on receipts (created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Internal transfers
-- ---------------------------------------------------------------------------
create table if not exists internal_transfers (
  id                     uuid primary key default gen_random_uuid(),
  transfer_no            text unique not null,     -- BND-TRF- / BND-DEP- / BND-WD-
  kind                   transfer_kind not null,
  source_account_id      uuid not null references financial_accounts (id),
  destination_account_id uuid not null references financial_accounts (id),
  amount                 numeric(16,2) not null check (amount > 0),
  transfer_date          date not null,

  source_reference       text,    -- merchant withdrawal ref, bank withdrawal ref
  destination_reference  text,    -- bank deposit slip, transfer confirmation
  description            text not null check (length(btrim(description)) > 0),
  purpose                text,    -- why cash was drawn from the bank
  handled_by             text,    -- who physically deposited or withdrew it
  notes                  text,

  status                 finance_doc_status not null default 'submitted',
  requires_approval      boolean not null default false,

  transaction_id          uuid unique references transactions (id),
  reversal_transaction_id uuid references transactions (id),

  idempotency_key        text,

  created_by             uuid not null references app_users (id),
  created_at             timestamptz not null default now(),
  submitted_at           timestamptz,
  approved_by            uuid references app_users (id),
  approved_at            timestamptz,
  rejected_by            uuid references app_users (id),
  rejected_at            timestamptz,
  rejection_reason       text,
  cancelled_by           uuid references app_users (id),
  cancelled_at           timestamptz,
  cancellation_reason    text,
  completed_at           timestamptz,
  reversed_at            timestamptz,
  reversal_reason        text,
  updated_at             timestamptz not null default now(),

  constraint internal_transfers_distinct_accounts
    check (source_account_id <> destination_account_id),
  constraint internal_transfers_completed_has_txn
    check (status not in ('completed', 'reversed') or transaction_id is not null)
);

create unique index if not exists internal_transfers_idempotency_idx
  on internal_transfers (idempotency_key) where idempotency_key is not null;

-- The same deposit slip or merchant reference cannot be banked twice on the
-- same account while a live document carries it.
create unique index if not exists internal_transfers_source_ref_idx
  on internal_transfers (source_account_id, upper(source_reference))
  where source_reference is not null and status in ('draft', 'submitted', 'approved', 'completed');
create unique index if not exists internal_transfers_destination_ref_idx
  on internal_transfers (destination_account_id, upper(destination_reference))
  where destination_reference is not null and status in ('draft', 'submitted', 'approved', 'completed');

create index if not exists internal_transfers_status_idx on internal_transfers (status, transfer_date desc);
create index if not exists internal_transfers_date_idx   on internal_transfers (transfer_date desc, created_at desc);

drop trigger if exists internal_transfers_updated on internal_transfers;
create trigger internal_transfers_updated
  before update on internal_transfers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. Payments (money out that is not an operating expense) and their
--    categories. Expenses keep their own table and approval flow from 0002;
--    both carry a BND-PAY- number and both appear in the payment register.
-- ---------------------------------------------------------------------------
create table if not exists payment_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null check (length(btrim(name)) > 0),
  description text,
  is_active   boolean not null default true,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

insert into payment_categories (name, description) values
  ('Member refunds',  'Money returned to a member, such as an overpayment.'),
  ('Dividends',       'Dividends paid to members out of surplus.'),
  ('Asset purchases', 'Equipment and other assets. A purchase of an asset is not an operating expense.'),
  ('Other payments',  'Any payment that is not an operating expense and fits no other category.')
on conflict (name) do nothing;

-- Income and expense categories become editable through an audited function
-- rather than directly; they gain an active flag and a description.
alter table income_categories
  add column if not exists description text,
  add column if not exists is_active   boolean not null default true;
alter table expense_categories
  add column if not exists description text,
  add column if not exists is_active   boolean not null default true;

drop policy if exists income_categories_admin  on income_categories;
drop policy if exists expense_categories_admin on expense_categories;

create table if not exists payments (
  id                 uuid primary key default gen_random_uuid(),
  payment_no         text unique not null,
  payee              text not null check (length(btrim(payee)) > 0),
  member_id          uuid references members (id) on delete restrict,
  category_id        uuid not null references payment_categories (id),
  amount             numeric(16,2) not null check (amount > 0),
  payment_date       date not null,
  payment_account_id uuid not null references financial_accounts (id),
  method             payment_method not null,
  reference          text,
  description        text not null check (length(btrim(description)) > 0),
  notes              text,

  status             finance_doc_status not null default 'submitted',
  requires_approval  boolean not null default false,

  transaction_id          uuid unique references transactions (id),
  reversal_transaction_id uuid references transactions (id),
  idempotency_key    text,

  created_by         uuid not null references app_users (id),
  created_at         timestamptz not null default now(),
  submitted_at       timestamptz,
  approved_by        uuid references app_users (id),
  approved_at        timestamptz,
  rejected_by        uuid references app_users (id),
  rejected_at        timestamptz,
  rejection_reason   text,
  cancelled_by       uuid references app_users (id),
  cancelled_at       timestamptz,
  cancellation_reason text,
  completed_at       timestamptz,
  reversed_at        timestamptz,
  reversal_reason    text,
  updated_at         timestamptz not null default now(),

  constraint payments_completed_has_txn
    check (status not in ('completed', 'reversed') or transaction_id is not null)
);

create unique index if not exists payments_idempotency_idx
  on payments (idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_reference_idx
  on payments (payment_account_id, upper(reference))
  where reference is not null and status in ('draft', 'submitted', 'approved', 'completed');
create index if not exists payments_status_idx on payments (status, payment_date desc);

drop trigger if exists payments_updated on payments;
create trigger payments_updated
  before update on payments
  for each row execute function set_updated_at();

alter table expense_entries
  add column if not exists payment_account_id uuid references financial_accounts (id),
  add column if not exists payment_no         text unique,
  add column if not exists payee              text,
  add column if not exists reference          text,
  add column if not exists notes              text,
  add column if not exists rejection_reason   text,
  add column if not exists idempotency_key    text;

create unique index if not exists expense_entries_idempotency_idx
  on expense_entries (idempotency_key) where idempotency_key is not null;

-- The payment seam from 0023 numbered its intents BND-PAY-, the prefix the
-- payment register now owns. Intents take BND-PI- from here on; the body is
-- otherwise 0023's.
create or replace function settle_manual_payment(
  p_member_id      uuid,
  p_purpose        txn_type,
  p_amount         numeric,
  p_method         payment_method,
  p_schedule_id    uuid,
  p_loan_id        uuid,
  p_transaction_id uuid,
  p_external_ref   text,
  p_idempotency_key text
) returns payment_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent payment_intents;
begin
  select * into v_intent from payment_intents where transaction_id = p_transaction_id;
  if found then
    return v_intent;
  end if;

  insert into payment_intents (
    reference, member_id, purpose, amount, provider, method, state,
    provider_ref, schedule_id, loan_id, transaction_id, idempotency_key,
    initiated_by, settled_at
  ) values (
    next_document_no('PI'), p_member_id, p_purpose, p_amount,
    'manual', p_method, 'successful',
    p_external_ref, p_schedule_id, p_loan_id, p_transaction_id,
    p_idempotency_key, auth.uid(), now()
  )
  returning * into v_intent;

  return v_intent;
end;
$$;

revoke all on function settle_manual_payment(uuid, txn_type, numeric, payment_method,
                                             uuid, uuid, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- 10. Reconciliations
--
-- What the system says against what is actually there. A variance is recorded
-- with its reason; it is never "fixed" by quietly moving the system balance.
-- ---------------------------------------------------------------------------
create table if not exists reconciliations (
  id                  uuid primary key default gen_random_uuid(),
  reconciliation_no   text unique not null,
  account_id          uuid not null references financial_accounts (id),
  reconciliation_date date not null,
  system_balance      numeric(16,2) not null,
  actual_balance      numeric(16,2) not null,
  variance            numeric(16,2) generated always as (actual_balance - system_balance) stored,
  reason              text,
  statement_reference text,
  notes               text,
  reconciled_by       uuid not null references app_users (id),
  created_at          timestamptz not null default now(),

  constraint reconciliations_variance_explained
    check (actual_balance = system_balance or length(btrim(coalesce(reason, ''))) >= 5)
);

create index if not exists reconciliations_account_idx
  on reconciliations (account_id, reconciliation_date desc, created_at desc);

-- ---------------------------------------------------------------------------
-- 11. Supporting documents - deposit slips, transfer confirmations
-- ---------------------------------------------------------------------------
create table if not exists finance_documents (
  id           uuid primary key default gen_random_uuid(),
  owner_type   text not null check (owner_type in ('transfer', 'payment', 'expense', 'reconciliation')),
  owner_id     uuid not null,
  storage_path text unique not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   integer check (size_bytes is null or size_bytes >= 0),
  uploaded_by  uuid references app_users (id),
  created_at   timestamptz not null default now()
);

create index if not exists finance_documents_owner_idx on finance_documents (owner_type, owner_id);

-- A private bucket. Staff who record finance may add files; staff who can see
-- the books may read them; nobody may overwrite or delete one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-documents', 'finance-documents', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists finance_documents_insert on storage.objects;
create policy finance_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'finance-documents' and public.can_record_finance());

drop policy if exists finance_documents_read on storage.objects;
create policy finance_documents_read on storage.objects
  for select to authenticated
  using (bucket_id = 'finance-documents' and public.can_view_finance());

-- ---------------------------------------------------------------------------
-- 12. Settings - the "Cash & Bank" section
-- ---------------------------------------------------------------------------
select define_setting('treasury.require_approval', 'treasury',
  'Transfers and payments need approval', 'boolean', 'true'::jsonb,
  'When on, a transfer, bank withdrawal or payment recorded by someone who cannot approve it waits for a manager before any money moves. When off, it completes as soon as it is recorded.',
  null, null, null, null, true, 10);

select define_setting('treasury.approval_threshold', 'treasury',
  'Approval needed above', 'money', '0'::jsonb,
  'Only amounts above this need approval. Zero means every amount does.',
  'UGX', 0, null, null, true, 20);

select define_setting('treasury.four_eyes', 'treasury',
  'A second person approves every entry', 'boolean', 'false'::jsonb,
  'When on, even a manager''s own transfers and payments wait for a different person to approve them, and nobody may approve an entry they recorded themselves - expenses included.',
  null, null, null, null, true, 30);

select define_setting('treasury.allow_negative_balances', 'treasury',
  'Allow an account to go below zero', 'boolean', 'false'::jsonb,
  'When off, nothing may take Cash at Merchant, Cash at Hand or a bank account below zero - a payment larger than the money in the account is refused.',
  null, null, null, null, true, 40);

select define_setting('treasury.merchant_balance_alert', 'treasury',
  'Warn when Cash at Merchant exceeds', 'money', '0'::jsonb,
  'The finance dashboard flags the merchant balance once it is above this, as a prompt to move money to the bank. Zero turns the warning off.',
  'UGX', 0, null, null, false, 50);

select define_setting('treasury.cash_balance_alert', 'treasury',
  'Warn when Cash at Hand exceeds', 'money', '0'::jsonb,
  'The finance dashboard flags physical cash above this, as a prompt to deposit it. Zero turns the warning off.',
  'UGX', 0, null, null, false, 60);

select define_setting('treasury.large_withdrawal_alert', 'treasury',
  'Flag bank withdrawals of at least', 'money', '0'::jsonb,
  'Bank-to-cash withdrawals at or above this are highlighted on the finance dashboard. Zero turns the highlight off.',
  'UGX', 0, null, null, false, 70);

select define_setting('treasury.reconciliation_overdue_days', 'treasury',
  'Reconcile each account at least every', 'integer', '0'::jsonb,
  'An account not reconciled within this many days is flagged on the finance dashboard. Zero turns the reminder off; an account that has never been reconciled is always shown.',
  'days', 0, 366, null, false, 80);

-- ---------------------------------------------------------------------------
-- 13. The triggers that put every ledger row into its accounts
-- ---------------------------------------------------------------------------

/**
 * BEFORE INSERT: decide which account(s) the row touches and write them onto
 * the row, so the ledger row itself says where the money went.
 */
create or replace function transactions_resolve_accounts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_orig transactions;
  v_dir  smallint;
begin
  -- A reversal is the mirror image of the row it reverses.
  if new.status = 'reversal' and new.reverses_id is not null then
    select * into v_orig from transactions where id = new.reverses_id;
    new.source_account_id      := v_orig.destination_account_id;
    new.destination_account_id := v_orig.source_account_id;
    return new;
  end if;

  v_dir := txn_cash_direction(new.type);

  if v_dir = 1 then
    if new.source_account_id is not null then
      raise exception 'Money received has no source account inside the SACCO. Record a transfer instead.'
        using errcode = 'check_violation';
    end if;
    if new.destination_account_id is null then
      new.destination_account_id := resolve_posting_account(new.method);
    end if;
  elsif v_dir = -1 then
    if new.destination_account_id is not null then
      raise exception 'Money paid out has no destination account inside the SACCO. Record a transfer instead.'
        using errcode = 'check_violation';
    end if;
    if new.source_account_id is null then
      new.source_account_id := resolve_posting_account(new.method);
    end if;
  else
    if new.source_account_id is null or new.destination_account_id is null then
      raise exception 'An internal transfer needs both a source and a destination account.'
        using errcode = 'check_violation';
    end if;
    if new.source_account_id = new.destination_account_id then
      raise exception 'A transfer must move money between two different accounts.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

/**
 * AFTER INSERT: post the account entries, issue a receipt for money received,
 * and mark a reversed transfer or payment document as reversed.
 */
create or replace function transactions_post_account_entries()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reversal boolean := new.status = 'reversal';
begin
  -- Lock both accounts in a fixed order, so two transfers running in opposite
  -- directions at the same moment cannot deadlock each other.
  perform 1 from financial_accounts
   where id in (new.source_account_id, new.destination_account_id)
   order by id
   for update;

  if new.source_account_id is not null then
    perform post_account_entry(new.id, new.source_account_id, new.occurred_on,
                               0, new.amount, v_reversal);
  end if;
  if new.destination_account_id is not null then
    perform post_account_entry(new.id, new.destination_account_id, new.occurred_on,
                               new.amount, 0, v_reversal);
  end if;

  perform set_config('bnd.last_account_id',
                     coalesce(new.source_account_id, new.destination_account_id)::text, true);

  if new.status = 'posted' and txn_cash_direction(new.type) = 1 and new.method <> 'internal' then
    insert into receipts (receipt_no, transaction_id, created_by)
    values (next_document_no('RCT'), new.id, new.recorded_by)
    on conflict (transaction_id) do nothing;
  end if;

  if v_reversal and new.reverses_id is not null then
    update internal_transfers
       set status = 'reversed', reversal_transaction_id = new.id,
           reversed_at = now(), reversal_reason = new.reversal_reason
     where transaction_id = new.reverses_id;

    update payments
       set status = 'reversed', reversal_transaction_id = new.id,
           reversed_at = now(), reversal_reason = new.reversal_reason
     where transaction_id = new.reverses_id;
  end if;

  return null;
end;
$$;

drop trigger if exists transactions_accounts_resolve on transactions;
create trigger transactions_accounts_resolve
  before insert on transactions
  for each row execute function transactions_resolve_accounts();

drop trigger if exists transactions_accounts_post on transactions;
create trigger transactions_accounts_post
  after insert on transactions
  for each row execute function transactions_post_account_entries();

-- ---------------------------------------------------------------------------
-- 14. The Cash at Hand account every SACCO has
--
-- Seeded as configuration, with a zero opening balance: a manager records the
-- real opening count under Finance > Accounts before the first entry. Merchant
-- and bank accounts are NOT seeded - the provider, merchant code, bank and
-- account number are facts only the SACCO can supply, and inventing them would
-- put a fictional account on the balance sheet.
-- ---------------------------------------------------------------------------
insert into financial_accounts (code, name, account_type, currency, opening_balance,
                                opening_date, is_default, description)
select next_account_code('cash'), 'Cash at Hand', 'cash',
       coalesce((select value #>> '{}' from system_settings where key = 'financial.currency_code'), 'UGX'),
       0, current_date, true,
       'Physical cash held in the SACCO office.'
 where not exists (select 1 from financial_accounts where account_type = 'cash');

-- ---------------------------------------------------------------------------
-- 15. History recorded before this migration
--
-- A database that already holds transactions gets each one posted to the
-- account its payment method implies, oldest first, so balances start out
-- matching the books. Where history names a kind of account that does not yet
-- exist, one is created and clearly labelled for a manager to complete. The
-- zero-balance rule is suspended for this pass only: the past is recorded as
-- it happened, not re-judged. A fresh database has nothing to do here.
-- ---------------------------------------------------------------------------
do $backfill$
declare
  r      transactions;
  v_orig transactions;
  v_dir  smallint;
  v_type finance_account_type;
  v_acct uuid;
  v_src  uuid;
  v_dst  uuid;
begin
  if not exists (
    select 1 from transactions t
     where not exists (select 1 from account_ledger_entries e where e.transaction_id = t.id)
  ) then
    return;
  end if;

  perform set_config('bnd.backfill', 'on', true);

  for r in
    select * from transactions t
     where not exists (select 1 from account_ledger_entries e where e.transaction_id = t.id)
     order by t.created_at, t.id
  loop
    v_src := null;
    v_dst := null;

    if r.status = 'reversal' and r.reverses_id is not null then
      select * into v_orig from transactions where id = r.reverses_id;
      v_src := v_orig.destination_account_id;
      v_dst := v_orig.source_account_id;
    else
      v_dir := txn_cash_direction(r.type);
      if r.method = 'internal' then
        v_acct := nullif(current_setting('bnd.last_account_id', true), '')::uuid;
      else
        v_type := (finance_account_types_for_method(r.method))[1];
        v_acct := default_financial_account(v_type);
        if v_acct is null then
          insert into financial_accounts (code, name, account_type, provider, bank_name,
                                          account_number, currency, opening_date,
                                          is_default, description)
          values (next_account_code(v_type),
                  case v_type when 'merchant' then 'Merchant account (details to complete)'
                              when 'bank'     then 'Bank account (details to complete)'
                              else 'Cash at Hand' end,
                  v_type,
                  case when v_type = 'merchant' then 'To be completed' end,
                  case when v_type = 'bank' then 'To be completed' end,
                  case when v_type = 'bank' then 'To be completed' end,
                  'UGX', current_date, true,
                  'Created automatically for transactions recorded before accounts existed. Complete its details under Finance > Accounts.')
          returning id into v_acct;
        end if;
      end if;
      if v_dir = 1 then v_dst := v_acct; elsif v_dir = -1 then v_src := v_acct; end if;
    end if;

    update transactions
       set source_account_id = v_src, destination_account_id = v_dst
     where id = r.id;

    if v_src is not null then
      perform post_account_entry(r.id, v_src, r.occurred_on, 0, r.amount, true);
    end if;
    if v_dst is not null then
      perform post_account_entry(r.id, v_dst, r.occurred_on, r.amount, 0, true);
    end if;
    perform set_config('bnd.last_account_id', coalesce(v_src, v_dst)::text, true);

    if r.status in ('posted', 'reversed') and txn_cash_direction(r.type) = 1
       and r.method <> 'internal' then
      insert into receipts (receipt_no, transaction_id, created_by, created_at)
      values (next_document_no('RCT'), r.id, r.recorded_by, r.created_at)
      on conflict (transaction_id) do nothing;
    end if;
  end loop;

  perform set_config('bnd.backfill', '', true);
  perform set_config('bnd.last_account_id', '', true);
end;
$backfill$;

-- ---------------------------------------------------------------------------
-- 16. Balances
-- ---------------------------------------------------------------------------

/** An account's balance at the end of a day (today when no date is given). */
create or replace function account_balance_at(p_account_id uuid, p_on date default null)
returns numeric language sql stable security definer set search_path = public as $$
  select (a.opening_balance
          + coalesce((select sum(e.debit - e.credit)
                        from account_ledger_entries e
                       where e.account_id = a.id
                         and (p_on is null or e.entry_date <= p_on)), 0))::numeric(16,2)
    from financial_accounts a
   where a.id = p_account_id;
$$;

grant execute on function account_balance_at(uuid, date) to authenticated;

create or replace view financial_account_balances
with (security_invoker = true) as
select
  a.id, a.code, a.name, a.account_type, a.provider, a.merchant_code, a.account_identifier,
  a.bank_name, a.branch, a.account_number, a.currency, a.opening_balance, a.opening_date,
  a.status, a.is_default, a.description, a.created_at, a.updated_at,
  (a.opening_balance + coalesce(e.net, 0))::numeric(16,2) as balance,
  coalesce(e.entries, 0)::integer                          as entry_count,
  e.last_entry_at,
  r.reconciliation_date                                    as last_reconciled_on,
  r.variance                                               as last_variance,
  r.actual_balance                                         as last_actual_balance
from financial_accounts a
left join lateral (
  select sum(x.debit - x.credit) as net, count(*) as entries, max(x.created_at) as last_entry_at
    from account_ledger_entries x
   where x.account_id = a.id
) e on true
left join lateral (
  select rc.reconciliation_date, rc.variance, rc.actual_balance
    from reconciliations rc
   where rc.account_id = a.id
   order by rc.reconciliation_date desc, rc.created_at desc
   limit 1
) r on true;

-- ---------------------------------------------------------------------------
-- 17. Every account movement, classified
--
-- The one place that decides what a movement *is* for reporting:
--
--   collection      money from a member (savings, shares, repayments,
--                   deposits, fees a member paid)
--   other_receipt   other money received (income from non-members, fees
--                   withheld at loan disbursement)
--   transfer_in     arrived from another SACCO account
--   transfer_out    left for another SACCO account
--   expense         an approved operating expense
--   payment         any other money out: payments, loan disbursements,
--                   member withdrawals
--   reversal        a correcting entry
--
-- `running_balance` is by date, then posting order, so a statement for any
-- window reads correctly even when entries were back-dated.
-- ---------------------------------------------------------------------------
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
    when 'fee'               then 'Loan fees'
    when 'penalty'           then 'Penalties'
    when 'expense'           then coalesce(ec.name, 'Expenses')
    when 'payment'           then coalesce(pc.name, 'Payments')
    when 'withdrawal'        then 'Member withdrawals'
    when 'loan_disbursement' then 'Loan disbursements'
    else 'Internal transfer'
  end                   as category_label,
  (a.opening_balance
   + sum(e.debit - e.credit) over (partition by e.account_id order by e.entry_date, e.id))::numeric(16,2)
                        as running_balance
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
  select c.name from expense_entries xe
    join expense_categories c on c.id = xe.category_id
   where xe.transaction_id = coalesce(t.reverses_id, t.id)
   limit 1
) ec on t.type = 'expense'
left join lateral (
  select c.name from payments p
    join payment_categories c on c.id = p.category_id
   where p.transaction_id = coalesce(t.reverses_id, t.id)
   limit 1
) pc on t.type = 'payment';

-- ---------------------------------------------------------------------------
-- 18. Registers
-- ---------------------------------------------------------------------------
create or replace view receipt_register
with (security_invoker = true) as
select
  r.id,
  r.receipt_no,
  r.transaction_id,
  t.reference,
  t.occurred_on             as receipt_date,
  t.amount,
  t.method,
  t.status,
  t.type                    as txn_type,
  t.member_id,
  m.member_no,
  m.full_name               as member_name,
  coalesce(r.payer_name, m.full_name) as payer,
  case t.type
    when 'weekly_savings'  then 'Member Savings'
    when 'monthly_savings' then 'Member Savings'
    when 'deposit'         then 'Member Savings'
    when 'share_purchase'  then 'Share Purchase'
    when 'loan_repayment'  then 'Loan Repayment'
    when 'penalty'         then 'Penalties'
    else coalesce(ic.name, 'Other Income')
  end                       as category,
  t.destination_account_id  as receiving_account_id,
  a.name                    as receiving_account_name,
  a.account_type            as receiving_account_type,
  t.external_ref            as reference_no,
  t.description,
  t.recorded_by,
  u.full_name               as recorded_by_name,
  r.created_at
from receipts r
join transactions t            on t.id = r.transaction_id
left join members m            on m.id = t.member_id
left join financial_accounts a on a.id = t.destination_account_id
left join app_users u          on u.id = t.recorded_by
left join lateral (
  select c.name from income_entries ie
    join income_categories c on c.id = ie.category_id
   where ie.transaction_id = t.id and t.type = 'income'
   limit 1
) ic on true;

create or replace view transfer_register
with (security_invoker = true) as
select
  x.*,
  sa.name          as source_account_name,
  sa.account_type  as source_account_type,
  da.name          as destination_account_name,
  da.account_type  as destination_account_type,
  cu.full_name     as created_by_name,
  au.full_name     as approved_by_name,
  ru.full_name     as rejected_by_name,
  t.reference      as transaction_reference,
  rt.reference     as reversal_reference,
  (select count(*) from finance_documents d
    where d.owner_type = 'transfer' and d.owner_id = x.id)::integer as document_count
from internal_transfers x
join financial_accounts sa on sa.id = x.source_account_id
join financial_accounts da on da.id = x.destination_account_id
left join app_users cu     on cu.id = x.created_by
left join app_users au     on au.id = x.approved_by
left join app_users ru     on ru.id = x.rejected_by
left join transactions t   on t.id  = x.transaction_id
left join transactions rt  on rt.id = x.reversal_transaction_id;

/**
 * Everything the SACCO paid out as a document: payments and expenses side by
 * side, each with its BND-PAY- number.
 */
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
    where d.owner_type = 'payment' and d.owner_id = p.id)::integer as document_count
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
    where d.owner_type = 'expense' and d.owner_id = x.id)::integer
from expense_entries x
join expense_categories ec     on ec.id = x.category_id
left join financial_accounts a on a.id  = x.payment_account_id
left join app_users cu         on cu.id = x.recorded_by
left join app_users au         on au.id = x.approved_by
left join transactions t       on t.id  = x.transaction_id;

create or replace view reconciliation_register
with (security_invoker = true) as
select
  r.*,
  a.name          as account_name,
  a.account_type,
  u.full_name     as reconciled_by_name,
  case when r.variance = 0 then 'reconciled' else 'variance' end as outcome
from reconciliations r
join financial_accounts a on a.id = r.account_id
left join app_users u     on u.id = r.reconciled_by;

-- ---------------------------------------------------------------------------
-- 19. Row-level security
--
-- The finance roles read. Nobody writes directly - every change goes through
-- the audited functions below.
-- ---------------------------------------------------------------------------
alter table financial_accounts     enable row level security;
alter table account_ledger_entries enable row level security;
alter table receipts               enable row level security;
alter table internal_transfers     enable row level security;
alter table payment_categories     enable row level security;
alter table payments               enable row level security;
alter table reconciliations        enable row level security;
alter table finance_documents      enable row level security;

drop policy if exists financial_accounts_read on financial_accounts;
create policy financial_accounts_read on financial_accounts
  for select using (can_view_finance());

drop policy if exists account_ledger_entries_read on account_ledger_entries;
create policy account_ledger_entries_read on account_ledger_entries
  for select using (can_view_finance());

drop policy if exists receipts_read on receipts;
create policy receipts_read on receipts
  for select using (can_view_finance());

drop policy if exists internal_transfers_read on internal_transfers;
create policy internal_transfers_read on internal_transfers
  for select using (can_view_finance());

drop policy if exists payment_categories_read on payment_categories;
create policy payment_categories_read on payment_categories
  for select using (can_view_finance());

drop policy if exists payments_read on payments;
create policy payments_read on payments
  for select using (can_view_finance());

drop policy if exists reconciliations_read on reconciliations;
create policy reconciliations_read on reconciliations
  for select using (can_view_finance());

drop policy if exists finance_documents_read on finance_documents;
create policy finance_documents_read on finance_documents
  for select using (can_view_finance());

revoke all on financial_accounts, account_ledger_entries, receipts, internal_transfers,
              payment_categories, payments, reconciliations, finance_documents from anon;
revoke insert, update, delete, truncate
    on financial_accounts, account_ledger_entries, receipts, internal_transfers,
       payment_categories, payments, reconciliations, finance_documents from authenticated;
grant select on financial_accounts, account_ledger_entries, receipts, internal_transfers,
                payment_categories, payments, reconciliations, finance_documents to authenticated;

grant select on financial_account_balances, account_movements, receipt_register,
                transfer_register, payment_register, reconciliation_register to authenticated;
revoke all on financial_account_balances, account_movements, receipt_register,
              transfer_register, payment_register, reconciliation_register from anon;

-- ===========================================================================
-- 20. ACCOUNT ADMINISTRATION
-- ===========================================================================

create or replace function create_financial_account(
  p_account_type       finance_account_type,
  p_name               text,
  p_provider           text default null,
  p_merchant_code      text default null,
  p_account_identifier text default null,
  p_bank_name          text default null,
  p_branch             text default null,
  p_account_number     text default null,
  p_opening_balance    numeric default 0,
  p_opening_date       date default null,
  p_description        text default null,
  p_is_default         boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row      financial_accounts;
  v_currency text := setting_text('financial.currency_code');
  v_default  boolean;
begin
  perform assert_capability(can_manage_finance_accounts(), 'set up financial accounts');

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Enter a name for the account.' using errcode = 'check_violation';
  end if;
  if coalesce(p_opening_balance, 0) < 0 then
    raise exception 'An opening balance cannot be negative.' using errcode = 'check_violation';
  end if;
  if p_opening_date > current_date then
    raise exception 'The opening date cannot be in the future.' using errcode = 'check_violation';
  end if;
  if p_account_type = 'merchant' and coalesce(btrim(p_provider), '') = '' then
    raise exception 'Enter the mobile money provider for the merchant account.' using errcode = 'check_violation';
  end if;
  if p_account_type = 'bank' and (coalesce(btrim(p_bank_name), '') = ''
                                  or coalesce(btrim(p_account_number), '') = '') then
    raise exception 'Enter the bank name and the account number.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from financial_accounts where lower(name) = lower(btrim(p_name))) then
    raise exception 'An account called % already exists.', btrim(p_name) using errcode = 'unique_violation';
  end if;

  -- The first active account of a kind becomes its default automatically, so
  -- collections have somewhere to land from the start.
  v_default := coalesce(p_is_default, false)
               or not exists (select 1 from financial_accounts
                               where account_type = p_account_type and status = 'active' and is_default);
  if v_default then
    update financial_accounts set is_default = false
     where account_type = p_account_type and is_default;
  end if;

  insert into financial_accounts (code, name, account_type, provider, merchant_code,
                                  account_identifier, bank_name, branch, account_number,
                                  currency, opening_balance, opening_date, is_default,
                                  description, created_by, updated_by)
  values (next_account_code(p_account_type), btrim(p_name), p_account_type,
          nullif(btrim(coalesce(p_provider, '')), ''),
          nullif(btrim(coalesce(p_merchant_code, '')), ''),
          nullif(btrim(coalesce(p_account_identifier, '')), ''),
          nullif(btrim(coalesce(p_bank_name, '')), ''),
          nullif(btrim(coalesce(p_branch, '')), ''),
          nullif(btrim(coalesce(p_account_number, '')), ''),
          coalesce(v_currency, 'UGX'), coalesce(p_opening_balance, 0),
          coalesce(p_opening_date, current_date), v_default,
          nullif(btrim(coalesce(p_description, '')), ''), auth.uid(), auth.uid())
  returning * into v_row;

  perform write_audit('treasury.account_created', 'Finance', v_row.id::text,
    format('%s account %s (%s) created with an opening balance of %s',
           initcap(v_row.account_type::text), v_row.name, v_row.code, ugx(v_row.opening_balance)),
    null, to_jsonb(v_row), null);

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'name', v_row.name,
                            'is_default', v_row.is_default);
end;
$$;

create or replace function update_financial_account(
  p_id                 uuid,
  p_name               text,
  p_provider           text default null,
  p_merchant_code      text default null,
  p_account_identifier text default null,
  p_bank_name          text default null,
  p_branch             text default null,
  p_account_number     text default null,
  p_opening_balance    numeric default null,
  p_opening_date       date default null,
  p_description        text default null,
  p_is_default         boolean default null,
  p_reason             text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_old financial_accounts;
  v_new financial_accounts;
begin
  perform assert_capability(can_manage_finance_accounts(), 'edit financial accounts');

  select * into v_old from financial_accounts where id = p_id for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'no_data_found';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Enter a name for the account.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from financial_accounts
              where lower(name) = lower(btrim(p_name)) and id <> p_id) then
    raise exception 'An account called % already exists.', btrim(p_name) using errcode = 'unique_violation';
  end if;
  if coalesce(p_opening_balance, v_old.opening_balance) < 0 then
    raise exception 'An opening balance cannot be negative.' using errcode = 'check_violation';
  end if;
  if coalesce(p_opening_date, v_old.opening_date) > current_date then
    raise exception 'The opening date cannot be in the future.' using errcode = 'check_violation';
  end if;
  if p_is_default and v_old.status <> 'active' then
    raise exception 'Only an active account can be the default.' using errcode = 'check_violation';
  end if;

  if coalesce(p_is_default, false) and not v_old.is_default then
    update financial_accounts set is_default = false
     where account_type = v_old.account_type and is_default and id <> p_id;
  end if;

  update financial_accounts
     set name               = btrim(p_name),
         provider           = case when account_type = 'merchant'
                                   then nullif(btrim(coalesce(p_provider, '')), '') else provider end,
         merchant_code      = nullif(btrim(coalesce(p_merchant_code, '')), ''),
         account_identifier = nullif(btrim(coalesce(p_account_identifier, '')), ''),
         bank_name          = case when account_type = 'bank'
                                   then nullif(btrim(coalesce(p_bank_name, '')), '') else bank_name end,
         branch             = nullif(btrim(coalesce(p_branch, '')), ''),
         account_number     = case when account_type = 'bank'
                                   then nullif(btrim(coalesce(p_account_number, '')), '') else account_number end,
         opening_balance    = coalesce(p_opening_balance, opening_balance),
         opening_date       = coalesce(p_opening_date, opening_date),
         description        = nullif(btrim(coalesce(p_description, '')), ''),
         is_default         = coalesce(p_is_default, is_default),
         updated_by         = auth.uid()
   where id = p_id
  returning * into v_new;

  perform write_audit('treasury.account_updated', 'Finance', p_id::text,
    format('Account %s (%s) updated', v_new.name, v_new.code),
    to_jsonb(v_old), to_jsonb(v_new), nullif(btrim(coalesce(p_reason, '')), ''));

  return jsonb_build_object('id', v_new.id, 'code', v_new.code, 'name', v_new.name);
end;
$$;

create or replace function set_financial_account_status(
  p_id     uuid,
  p_status finance_account_status,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_old     financial_accounts;
  v_new     financial_accounts;
  v_balance numeric(16,2);
begin
  perform assert_capability(can_manage_finance_accounts(), 'change the status of an account');

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason - this is recorded in the audit log.' using errcode = 'check_violation';
  end if;

  select * into v_old from financial_accounts where id = p_id for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'no_data_found';
  end if;

  v_balance := account_balance_at(p_id);

  -- Closing an account that still holds money would make that money vanish
  -- from "where is the money". Move it first.
  if p_status = 'closed' and v_balance <> 0 then
    raise exception '% still holds %. Transfer it to another account before closing.',
      v_old.name, ugx(v_balance) using errcode = 'check_violation';
  end if;

  if p_status <> 'active' and (
       exists (select 1 from internal_transfers
                where status in ('draft', 'submitted', 'approved')
                  and p_id in (source_account_id, destination_account_id))
    or exists (select 1 from payments
                where status in ('draft', 'submitted', 'approved') and payment_account_id = p_id)
    or exists (select 1 from expense_entries
                where approval = 'pending' and payment_account_id = p_id)) then
    raise exception 'Transfers or payments waiting on % must be completed or cancelled first.', v_old.name
      using errcode = 'check_violation';
  end if;

  update financial_accounts
     set status     = p_status,
         is_default = case when p_status = 'active' then is_default else false end,
         updated_by = auth.uid()
   where id = p_id
  returning * into v_new;

  perform write_audit('treasury.account_' || p_status::text, 'Finance', p_id::text,
    format('Account %s (%s) marked %s, balance %s', v_new.name, v_new.code, p_status, ugx(v_balance)),
    to_jsonb(v_old), to_jsonb(v_new), p_reason);

  return jsonb_build_object('id', p_id, 'status', v_new.status);
end;
$$;

/**
 * Create or edit an income, expense or payment category.
 *
 * The two system income categories - loan interest and service charges - are
 * booked into by name from the loan functions, so they cannot be renamed or
 * retired.
 */
create or replace function save_finance_category(
  p_kind        text,             -- 'income' | 'expense' | 'payment'
  p_id          uuid,
  p_name        text,
  p_description text default null,
  p_is_active   boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_old    jsonb;
  v_id     uuid;
  v_system boolean;
  v_table  text;
begin
  perform assert_capability(can_manage_finance_accounts(), 'manage finance categories');

  if p_kind not in ('income', 'expense', 'payment') then
    raise exception 'Unknown category kind.' using errcode = 'check_violation';
  end if;
  if v_name = '' then
    raise exception 'Enter a name for the category.' using errcode = 'check_violation';
  end if;

  v_table := p_kind || '_categories';

  execute format('select exists (select 1 from %I where lower(name) = lower($1) and ($2 is null or id <> $2))', v_table)
    into v_system using v_name, p_id;
  if v_system then
    raise exception 'A category called % already exists.', v_name using errcode = 'unique_violation';
  end if;

  if p_id is null then
    execute format('insert into %I (name, description, is_active) values ($1, $2, $3) returning id', v_table)
      into v_id using v_name, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_is_active, true);

    perform write_audit('treasury.category_created', 'Finance', v_id::text,
      format('%s category %s created', initcap(p_kind), v_name), null,
      jsonb_build_object('kind', p_kind, 'name', v_name), null);
  else
    execute format('select to_jsonb(c), c.is_system from %I c where c.id = $1', v_table)
      into v_old, v_system using p_id;
    if v_old is null then
      raise exception 'Category not found.' using errcode = 'no_data_found';
    end if;
    if v_system and (v_name <> v_old ->> 'name' or not coalesce(p_is_active, true)) then
      raise exception '% is used by the loan functions and cannot be renamed or retired.', v_old ->> 'name'
        using errcode = 'check_violation';
    end if;

    execute format('update %I set name = $1, description = $2, is_active = $3 where id = $4', v_table)
      using v_name, nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_is_active, true), p_id;
    v_id := p_id;

    perform write_audit('treasury.category_updated', 'Finance', v_id::text,
      format('%s category %s updated%s', initcap(p_kind), v_name,
             case when not coalesce(p_is_active, true) then ' (retired)' else '' end),
      v_old, jsonb_build_object('kind', p_kind, 'name', v_name, 'is_active', coalesce(p_is_active, true)),
      null);
  end if;

  return jsonb_build_object('id', v_id, 'kind', p_kind, 'name', v_name);
end;
$$;

grant execute on function create_financial_account(finance_account_type, text, text, text, text, text, text, text, numeric, date, text, boolean) to authenticated;
grant execute on function update_financial_account(uuid, text, text, text, text, text, text, text, numeric, date, text, boolean, text) to authenticated;
grant execute on function set_financial_account_status(uuid, finance_account_status, text) to authenticated;
grant execute on function save_finance_category(text, uuid, text, text, boolean) to authenticated;

-- ===========================================================================
-- 21. COLLECTIONS AND OTHER RECEIPTS
-- ===========================================================================

/** Shared checks for the account money is arriving in or leaving from. */
create or replace function assert_account_usable(
  p_account_id uuid,
  p_method     payment_method
) returns financial_accounts
language plpgsql stable security definer set search_path = public as $$
declare
  v_acct financial_accounts;
begin
  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception 'Choose the account.' using errcode = 'no_data_found';
  end if;
  if v_acct.status <> 'active' then
    raise exception '% is % and cannot be used.', v_acct.name, v_acct.status using errcode = 'check_violation';
  end if;
  if p_method is not null and not (v_acct.account_type = any (finance_account_types_for_method(p_method))) then
    raise exception '% is a % account and cannot handle a % payment.',
      v_acct.name, v_acct.account_type, payment_method_label(p_method) using errcode = 'check_violation';
  end if;
  return v_acct;
end;
$$;

revoke all on function assert_account_usable(uuid, payment_method) from public;

/**
 * Record money a member paid, into a chosen account.
 *
 * One entry point for the Record Collection and Record Merchant Collection
 * forms. The member side is done by the function that has always done it -
 * `record_scheduled_savings`, `buy_shares`, `record_loan_repayment`,
 * `record_cash_movement`, `record_income` - so the savings schedule, the share
 * lot, the loan allocation and the member's balance move exactly as they do
 * from every other screen. This function adds the account: it validates it,
 * hands it down to the posting trigger, and returns the receipt.
 *
 * The provider reference is recorded as typed. Nothing here contacts MTN,
 * Airtel or a bank, and nothing marks a payment verified by a provider.
 */
create or replace function record_member_collection(
  p_member_id          uuid,
  p_collection_type    text,          -- savings | shares | loan_repayment | deposit | fee
  p_amount             numeric,
  p_account_id         uuid,
  p_paid_on            date default null,
  p_method             payment_method default null,
  p_external_ref       text default null,
  p_description        text default null,
  p_notes              text default null,
  p_savings_kind       savings_kind default null,
  p_loan_id            uuid default null,
  p_income_category_id uuid default null,
  p_idempotency_key    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acct     financial_accounts;
  v_member   members;
  v_method   payment_method;
  v_ref      text := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_on       date := coalesce(p_paid_on, current_date);
  v_replay   boolean := false;
  v_res      jsonb;
  v_txn_id   uuid;
  v_txn      transactions;
  v_kind     savings_kind;
  v_period   savings_periods;
  v_price    numeric;
  v_loan_id  uuid;
  v_cat      income_categories;
  v_receipt  text;
  v_label    text;
begin
  perform assert_capability(can_record_finance() or can_record_savings(), 'record collections');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  if v_on > current_date then
    raise exception 'A payment cannot be dated in the future.' using errcode = 'check_violation';
  end if;

  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception 'Choose the account the money was received into.' using errcode = 'no_data_found';
  end if;

  v_method := coalesce(p_method, method_for_account_type(v_acct.account_type));
  v_acct   := assert_account_usable(p_account_id, v_method);

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if p_idempotency_key is not null
     and exists (select 1 from transactions where idempotency_key = p_idempotency_key) then
    v_replay := true;
  end if;

  if not v_replay then
    if v_acct.account_type in ('merchant', 'bank') and v_ref is null then
      raise exception '%',
        case when v_acct.account_type = 'merchant'
             then 'Enter the mobile money transaction reference from the confirmation message.'
             else 'Enter the bank transfer or deposit slip reference.' end
        using errcode = 'check_violation';
    end if;
    if v_ref is not null and exists (
      select 1 from transactions where upper(external_ref) = upper(v_ref) and status <> 'reversed'
    ) then
      raise exception 'Reference % has already been recorded against another transaction.', v_ref
        using errcode = 'unique_violation';
    end if;
  end if;

  -- Hand the chosen account to the posting trigger for this database
  -- transaction only.
  perform set_config('bnd.account_id', p_account_id::text, true);

  case p_collection_type
    when 'savings' then
      v_kind := coalesce(p_savings_kind, (member_savings_category(p_member_id)).frequency);
      if v_kind is null then
        raise exception 'Choose weekly or monthly savings - this member has no savings category.'
          using errcode = 'check_violation';
      end if;
      if v_member.status <> 'active' then
        raise exception 'Savings cannot be recorded for a % member.', v_member.status
          using errcode = 'check_violation';
      end if;
      v_period := ensure_savings_period(p_member_id, v_kind, v_on);
      if v_period.status = 'waived' then
        raise exception 'This period has been waived. Remove the waiver before recording a payment.'
          using errcode = 'check_violation';
      end if;
      -- On a replay the original row already carries the reference, and the
      -- duplicate-reference check inside would mistake the retry for a second
      -- payment; the idempotency key alone finds the original.
      v_res := record_scheduled_savings(v_period.id, p_amount, v_on, v_method,
                                        case when v_replay then null else v_ref end,
                                        coalesce(p_notes, p_description), p_idempotency_key);
      v_label := 'savings';

    when 'shares' then
      v_price := share_unit_price();
      if v_price is null or v_price <= 0 then
        raise exception 'The share price has not been set.' using errcode = 'check_violation';
      end if;
      if mod(p_amount, v_price) <> 0 then
        raise exception '% is not a whole number of shares at % each.', ugx(p_amount), ugx(v_price)
          using errcode = 'check_violation';
      end if;
      v_res := buy_shares(p_member_id, (p_amount / v_price)::integer, v_method, v_on,
                          coalesce(p_notes, p_description), p_idempotency_key);
      v_label := 'share purchase';

    when 'loan_repayment' then
      v_loan_id := p_loan_id;
      if v_loan_id is null then
        select id into v_loan_id from loans
         where member_id = p_member_id and status in ('active', 'disbursed', 'defaulted')
         order by disbursed_on desc nulls last
         limit 1;
      end if;
      if v_loan_id is null then
        raise exception 'This member has no loan being repaid.' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from loans where id = v_loan_id and member_id = p_member_id) then
        raise exception 'That loan does not belong to this member.' using errcode = 'check_violation';
      end if;
      v_res := record_loan_repayment(v_loan_id, p_amount, v_on, v_method, p_idempotency_key);
      v_label := 'loan repayment';

    when 'deposit' then
      v_res := record_cash_movement(p_member_id, 'deposit', p_amount, v_method, v_on,
                                    coalesce(p_description, 'Deposit'), p_idempotency_key);
      v_label := 'deposit';

    when 'fee' then
      select * into v_cat from income_categories where id = p_income_category_id;
      if not found or not v_cat.is_active then
        raise exception 'Choose what the member is paying for.' using errcode = 'check_violation';
      end if;
      v_res := record_income(v_cat.id, p_amount,
                             coalesce(nullif(btrim(coalesce(p_description, '')), ''),
                                      v_cat.name || ' - ' || v_member.full_name),
                             v_on, v_method, p_member_id, p_idempotency_key);
      v_label := lower(v_cat.name);

    else
      raise exception 'Unknown collection type %.', p_collection_type using errcode = 'check_violation';
  end case;

  perform set_config('bnd.account_id', '', true);

  v_txn_id := (v_res ->> 'transaction_id')::uuid;
  select * into v_txn from transactions where id = v_txn_id;

  if v_txn.destination_account_id is distinct from p_account_id then
    raise exception 'This payment was already recorded into %, not the account chosen now.',
      (select name from financial_accounts where id = v_txn.destination_account_id)
      using errcode = 'check_violation';
  end if;

  if v_ref is not null and v_txn.external_ref is null then
    update transactions set external_ref = v_ref where id = v_txn_id;
  end if;

  select receipt_no into v_receipt from receipts where transaction_id = v_txn_id;

  -- Only a posting made now is audited; an idempotent replay returns the
  -- original without writing a second line to the log.
  if v_txn.created_at = now() then
    perform write_audit('treasury.collection', 'Finance', v_txn_id::text,
      format('%s received for %s (%s) into %s%s', initcap(v_label) || ' of ' || ugx(p_amount),
             v_member.full_name, v_member.member_no, v_acct.name,
             case when v_ref is not null then ', ref ' || v_ref else '' end),
      null,
      jsonb_build_object('transaction_id', v_txn_id, 'reference', v_txn.reference,
                         'receipt_no', v_receipt, 'account_id', p_account_id,
                         'account', v_acct.name, 'amount', p_amount, 'method', v_method,
                         'external_ref', v_ref, 'collection_type', p_collection_type),
      p_notes);
  end if;

  return jsonb_build_object(
    'transaction_id',  v_txn_id,
    'reference',       v_txn.reference,
    'receipt_no',      v_receipt,
    'account_id',      p_account_id,
    'account_name',    v_acct.name,
    'account_balance', account_balance_at(p_account_id),
    'member_name',     v_member.full_name,
    'member_no',       v_member.member_no,
    'collection_type', p_collection_type,
    'amount',          p_amount,
    'duplicate',       v_txn.created_at <> now()
  );
end;
$$;

/**
 * Money received that is not a member contribution - interest on the SACCO's
 * own deposits, a grant, rent from a tenant, a non-member's fee. It is SACCO
 * income, booked into an income category and into the account it arrived in.
 */
create or replace function record_other_receipt(
  p_account_id      uuid,
  p_category_id     uuid,
  p_amount          numeric,
  p_received_on     date default null,
  p_payer_name      text default null,
  p_member_id       uuid default null,
  p_method          payment_method default null,
  p_reference       text default null,
  p_description     text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acct    financial_accounts;
  v_method  payment_method;
  v_ref     text := nullif(btrim(coalesce(p_reference, '')), '');
  v_cat     income_categories;
  v_res     jsonb;
  v_txn     transactions;
  v_receipt text;
  v_on      date := coalesce(p_received_on, current_date);
  v_replay  boolean := false;
begin
  perform assert_capability(can_record_finance(), 'record receipts');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  if v_on > current_date then
    raise exception 'A receipt cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  if p_member_id is null and coalesce(btrim(p_payer_name), '') = '' then
    raise exception 'Enter who paid.' using errcode = 'check_violation';
  end if;

  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception 'Choose the account the money was received into.' using errcode = 'no_data_found';
  end if;
  v_method := coalesce(p_method, method_for_account_type(v_acct.account_type));
  v_acct   := assert_account_usable(p_account_id, v_method);

  select * into v_cat from income_categories where id = p_category_id;
  if not found or not v_cat.is_active then
    raise exception 'Choose an income category.' using errcode = 'check_violation';
  end if;

  if p_idempotency_key is not null
     and exists (select 1 from transactions where idempotency_key = p_idempotency_key) then
    v_replay := true;
  end if;

  if not v_replay and v_ref is not null and exists (
    select 1 from transactions where upper(external_ref) = upper(v_ref) and status <> 'reversed'
  ) then
    raise exception 'Reference % has already been recorded against another transaction.', v_ref
      using errcode = 'unique_violation';
  end if;

  perform set_config('bnd.account_id', p_account_id::text, true);
  v_res := record_income(v_cat.id, p_amount,
                         coalesce(nullif(btrim(coalesce(p_description, '')), ''), v_cat.name),
                         v_on, v_method, p_member_id, p_idempotency_key);
  perform set_config('bnd.account_id', '', true);

  select * into v_txn from transactions where id = (v_res ->> 'transaction_id')::uuid;

  if v_ref is not null and v_txn.external_ref is null then
    update transactions set external_ref = v_ref where id = v_txn.id;
  end if;

  update receipts set payer_name = nullif(btrim(coalesce(p_payer_name, '')), '')
   where transaction_id = v_txn.id and payer_name is null and p_payer_name is not null;

  select receipt_no into v_receipt from receipts where transaction_id = v_txn.id;

  if v_txn.created_at = now() then
    perform write_audit('treasury.receipt', 'Finance', v_txn.id::text,
      format('%s received into %s (%s)%s', ugx(p_amount), v_acct.name, v_cat.name,
             case when p_payer_name is not null then ' from ' || btrim(p_payer_name) else '' end),
      null,
      jsonb_build_object('transaction_id', v_txn.id, 'receipt_no', v_receipt,
                         'account', v_acct.name, 'amount', p_amount, 'category', v_cat.name,
                         'reference', v_ref),
      p_description);
  end if;

  return jsonb_build_object('transaction_id', v_txn.id, 'reference', v_txn.reference,
                            'receipt_no', v_receipt, 'account_name', v_acct.name,
                            'account_balance', account_balance_at(p_account_id));
end;
$$;

grant execute on function record_member_collection(uuid, text, numeric, uuid, date, payment_method, text, text, text, savings_kind, uuid, uuid, text) to authenticated;
grant execute on function record_other_receipt(uuid, uuid, numeric, date, text, uuid, payment_method, text, text, text) to authenticated;

-- ===========================================================================
-- 22. APPROVAL RULES
-- ===========================================================================

/**
 * Does an entry of this amount, recorded by the caller, need someone else's
 * approval before money moves? Read from the Cash & Bank settings every time,
 * so changing a rule changes behaviour immediately.
 */
create or replace function treasury_requires_approval(p_amount numeric)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_threshold numeric := setting_number('treasury.approval_threshold');
begin
  if not setting_bool('treasury.require_approval') then
    return false;
  end if;
  if v_threshold > 0 and p_amount <= v_threshold then
    return false;
  end if;
  if can_approve_finance() and not setting_bool('treasury.four_eyes') then
    return false;
  end if;
  return true;
end;
$$;

/** The approver must be allowed to approve, and - under four eyes - not be the recorder. */
create or replace function assert_can_approve(p_recorded_by uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(can_approve_finance(), 'approve financial transactions');
  if p_recorded_by = auth.uid() and setting_bool('treasury.four_eyes') then
    raise exception 'You recorded this entry, so a different person has to approve it.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

grant execute on function treasury_requires_approval(numeric) to authenticated;
revoke all on function assert_can_approve(uuid) from public;

-- ===========================================================================
-- 23. INTERNAL TRANSFERS
-- ===========================================================================

/** Put a transfer on the ledger: one row, both accounts, one statement. */
create or replace function post_internal_transfer(p_id uuid)
returns internal_transfers
language plpgsql security definer set search_path = public as $$
declare
  v_row internal_transfers;
  v_txn transactions;
begin
  select * into v_row from internal_transfers where id = p_id for update;

  perform assert_account_usable(v_row.source_account_id, null);
  perform assert_account_usable(v_row.destination_account_id, null);

  insert into transactions (reference, member_id, type, status, amount, method, occurred_on,
                            description, source_account_id, destination_account_id,
                            idempotency_key, recorded_by)
  values (v_row.transfer_no, null, 'transfer', 'posted', v_row.amount, 'internal',
          v_row.transfer_date, v_row.description,
          v_row.source_account_id, v_row.destination_account_id,
          'transfer:' || v_row.id::text, auth.uid())
  returning * into v_txn;

  update internal_transfers
     set status = 'completed', transaction_id = v_txn.id, completed_at = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function post_internal_transfer(uuid) from public;

create or replace function transfer_result(p_row internal_transfers)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                p_row.id,
    'transfer_no',       p_row.transfer_no,
    'kind',              p_row.kind,
    'status',            p_row.status,
    'amount',            p_row.amount,
    'requires_approval', p_row.requires_approval,
    'transaction_id',    p_row.transaction_id,
    'source_account',    (select name from financial_accounts where id = p_row.source_account_id),
    'destination_account', (select name from financial_accounts where id = p_row.destination_account_id),
    'source_balance',    account_balance_at(p_row.source_account_id),
    'destination_balance', account_balance_at(p_row.destination_account_id)
  );
$$;

revoke all on function transfer_result(internal_transfers) from public;

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
  v_prefix := case v_kind when 'cash_to_bank' then 'DEP' when 'bank_to_cash' then 'WD' else 'TRF' end;

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

create or replace function submit_internal_transfer(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row   internal_transfers;
  v_old   jsonb;
  v_needs boolean;
begin
  perform assert_capability(can_record_finance(), 'submit transfers');

  select * into v_row from internal_transfers where id = p_id for update;
  if not found then
    raise exception 'Transfer not found.' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Only a draft can be submitted (this one is %).', v_row.status using errcode = 'check_violation';
  end if;
  if v_row.created_by <> auth.uid() and not can_approve_finance() then
    raise exception 'Only the person who drafted this transfer can submit it.' using errcode = 'insufficient_privilege';
  end if;

  v_old   := to_jsonb(v_row);
  v_needs := treasury_requires_approval(v_row.amount);

  update internal_transfers
     set status = 'submitted', submitted_at = now(), requires_approval = v_needs
   where id = p_id
  returning * into v_row;

  if not v_needs then
    v_row := post_internal_transfer(p_id);
  end if;

  perform write_audit('treasury.transfer_' || v_row.status::text, 'Finance', p_id::text,
    format('%s %s', v_row.transfer_no,
           case when v_needs then 'submitted for approval' else 'submitted and completed' end),
    v_old, to_jsonb(v_row), null);

  return transfer_result(v_row);
end;
$$;

create or replace function decide_internal_transfer(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row internal_transfers;
  v_old jsonb;
begin
  select * into v_row from internal_transfers where id = p_id for update;
  if not found then
    raise exception 'Transfer not found.' using errcode = 'no_data_found';
  end if;

  perform assert_can_approve(v_row.created_by);

  if v_row.status <> 'submitted' then
    raise exception 'Only a transfer awaiting approval can be decided (this one is %).', v_row.status
      using errcode = 'check_violation';
  end if;

  v_old := to_jsonb(v_row);

  if p_approve then
    update internal_transfers
       set approved_by = auth.uid(), approved_at = now()
     where id = p_id;
    v_row := post_internal_transfer(p_id);
  else
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Give a reason for rejecting the transfer.' using errcode = 'check_violation';
    end if;
    update internal_transfers
       set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
           rejection_reason = btrim(p_reason)
     where id = p_id
    returning * into v_row;
  end if;

  perform write_audit('treasury.transfer_' || case when p_approve then 'approved' else 'rejected' end,
    'Finance', p_id::text,
    format('%s %s: %s', v_row.transfer_no,
           case when p_approve then 'approved and completed' else 'rejected' end, ugx(v_row.amount)),
    v_old, to_jsonb(v_row), p_reason);

  return transfer_result(v_row);
end;
$$;

create or replace function cancel_internal_transfer(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row internal_transfers;
  v_old jsonb;
begin
  perform assert_capability(can_record_finance(), 'cancel transfers');

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for cancelling.' using errcode = 'check_violation';
  end if;

  select * into v_row from internal_transfers where id = p_id for update;
  if not found then
    raise exception 'Transfer not found.' using errcode = 'no_data_found';
  end if;
  if v_row.status not in ('draft', 'submitted') then
    raise exception 'A % transfer cannot be cancelled. A completed transfer is corrected by reversing it.', v_row.status
      using errcode = 'check_violation';
  end if;
  if v_row.created_by <> auth.uid() and not can_approve_finance() then
    raise exception 'Only the person who recorded this transfer, or an approver, can cancel it.'
      using errcode = 'insufficient_privilege';
  end if;

  v_old := to_jsonb(v_row);
  update internal_transfers
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancellation_reason = btrim(p_reason)
   where id = p_id
  returning * into v_row;

  perform write_audit('treasury.transfer_cancelled', 'Finance', p_id::text,
    format('%s cancelled (%s)', v_row.transfer_no, ugx(v_row.amount)), v_old, to_jsonb(v_row), p_reason);

  return transfer_result(v_row);
end;
$$;

grant execute on function create_internal_transfer(uuid, uuid, numeric, date, text, text, text, text, text, text, boolean, text) to authenticated;
grant execute on function submit_internal_transfer(uuid)                  to authenticated;
grant execute on function decide_internal_transfer(uuid, boolean, text)   to authenticated;
grant execute on function cancel_internal_transfer(uuid, text)            to authenticated;

-- ===========================================================================
-- 24. PAYMENTS
-- ===========================================================================

create or replace function post_payment(p_id uuid)
returns payments language plpgsql security definer set search_path = public as $$
declare
  v_row payments;
  v_cat text;
  v_txn transactions;
begin
  select * into v_row from payments where id = p_id for update;
  select name into v_cat from payment_categories where id = v_row.category_id;

  perform assert_account_usable(v_row.payment_account_id, v_row.method);

  insert into transactions (reference, member_id, type, status, amount, method, occurred_on,
                            description, source_account_id, external_ref, idempotency_key, recorded_by)
  values (v_row.payment_no, v_row.member_id, 'payment', 'posted', v_row.amount, v_row.method,
          v_row.payment_date, v_cat || ': ' || v_row.description || ' (' || v_row.payee || ')',
          v_row.payment_account_id, null, 'payment:' || v_row.id::text, auth.uid())
  returning * into v_txn;

  update payments
     set status = 'completed', transaction_id = v_txn.id, completed_at = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function post_payment(uuid) from public;

create or replace function payment_result(p_row payments)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                p_row.id,
    'payment_no',        p_row.payment_no,
    'status',            p_row.status,
    'amount',            p_row.amount,
    'requires_approval', p_row.requires_approval,
    'transaction_id',    p_row.transaction_id,
    'account',           (select name from financial_accounts where id = p_row.payment_account_id),
    'account_balance',   account_balance_at(p_row.payment_account_id)
  );
$$;

revoke all on function payment_result(payments) from public;

create or replace function create_payment(
  p_payee           text,
  p_category_id     uuid,
  p_amount          numeric,
  p_account_id      uuid,
  p_payment_date    date default null,
  p_member_id       uuid default null,
  p_method          payment_method default null,
  p_reference       text default null,
  p_description     text default null,
  p_notes           text default null,
  p_submit          boolean default true,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acct    financial_accounts;
  v_method  payment_method;
  v_row     payments;
  v_cat     payment_categories;
  v_on      date := coalesce(p_payment_date, current_date);
  v_ref     text := nullif(btrim(coalesce(p_reference, '')), '');
  v_needs   boolean;
  v_balance numeric;
begin
  perform assert_capability(can_record_finance(), 'record payments');

  if p_idempotency_key is not null then
    select * into v_row from payments where idempotency_key = p_idempotency_key;
    if found then
      return payment_result(v_row) || jsonb_build_object('duplicate', true);
    end if;
  end if;

  if coalesce(btrim(p_payee), '') = '' then
    raise exception 'Enter who is being paid.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'Describe what the payment is for.' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  if v_on > current_date then
    raise exception 'A payment cannot be dated in the future.' using errcode = 'check_violation';
  end if;

  select * into v_cat from payment_categories where id = p_category_id;
  if not found or not v_cat.is_active then
    raise exception 'Choose a payment category.' using errcode = 'check_violation';
  end if;

  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception 'Choose the account the payment is made from.' using errcode = 'no_data_found';
  end if;
  v_method := coalesce(p_method, method_for_account_type(v_acct.account_type));
  v_acct   := assert_account_usable(p_account_id, v_method);

  if p_member_id is not null and not exists (select 1 from members where id = p_member_id) then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if v_acct.account_type in ('merchant', 'bank') and v_ref is null then
    raise exception 'Enter the transaction, cheque or transfer reference for this payment.'
      using errcode = 'check_violation';
  end if;
  if v_ref is not null and exists (
    select 1 from payments where payment_account_id = p_account_id and upper(reference) = upper(v_ref)
       and status in ('draft', 'submitted', 'approved', 'completed')) then
    raise exception 'Reference % has already been used for a payment from %.', v_ref, v_acct.name
      using errcode = 'unique_violation';
  end if;

  v_balance := account_balance_at(p_account_id);
  if p_amount > v_balance and not setting_bool('treasury.allow_negative_balances') then
    raise exception '% holds %. It cannot pay %.', v_acct.name, ugx(v_balance), ugx(p_amount)
      using errcode = 'check_violation';
  end if;

  v_needs := treasury_requires_approval(p_amount);

  insert into payments (payment_no, payee, member_id, category_id, amount, payment_date,
                        payment_account_id, method, reference, description, notes, status,
                        requires_approval, idempotency_key, created_by, submitted_at)
  values (next_document_no('PAY'), btrim(p_payee), p_member_id, p_category_id, p_amount, v_on,
          p_account_id, v_method, v_ref, btrim(p_description),
          nullif(btrim(coalesce(p_notes, '')), ''),
          case when coalesce(p_submit, true) then 'submitted'::finance_doc_status
               else 'draft'::finance_doc_status end,
          v_needs, p_idempotency_key, auth.uid(),
          case when coalesce(p_submit, true) then now() end)
  returning * into v_row;

  perform write_audit('treasury.payment_' || v_row.status::text, 'Finance', v_row.id::text,
    format('%s %s: %s to %s from %s (%s)', v_row.payment_no,
           case v_row.status when 'draft' then 'saved as draft'
                             else case when v_needs then 'submitted for approval' else 'recorded' end end,
           ugx(p_amount), v_row.payee, v_acct.name, v_cat.name),
    null, to_jsonb(v_row), p_notes);

  if v_row.status = 'submitted' and not v_needs then
    v_row := post_payment(v_row.id);
    perform write_audit('treasury.payment_completed', 'Finance', v_row.id::text,
      format('%s completed: %s paid to %s from %s', v_row.payment_no, ugx(p_amount),
             v_row.payee, v_acct.name),
      jsonb_build_object('status', 'submitted'), to_jsonb(v_row), null);
  end if;

  return payment_result(v_row) || jsonb_build_object('duplicate', false);
end;
$$;

create or replace function submit_payment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row   payments;
  v_old   jsonb;
  v_needs boolean;
begin
  perform assert_capability(can_record_finance(), 'submit payments');

  select * into v_row from payments where id = p_id for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Only a draft can be submitted (this one is %).', v_row.status using errcode = 'check_violation';
  end if;
  if v_row.created_by <> auth.uid() and not can_approve_finance() then
    raise exception 'Only the person who drafted this payment can submit it.' using errcode = 'insufficient_privilege';
  end if;

  v_old   := to_jsonb(v_row);
  v_needs := treasury_requires_approval(v_row.amount);

  update payments set status = 'submitted', submitted_at = now(), requires_approval = v_needs
   where id = p_id returning * into v_row;

  if not v_needs then
    v_row := post_payment(p_id);
  end if;

  perform write_audit('treasury.payment_' || v_row.status::text, 'Finance', p_id::text,
    format('%s %s', v_row.payment_no,
           case when v_needs then 'submitted for approval' else 'submitted and completed' end),
    v_old, to_jsonb(v_row), null);

  return payment_result(v_row);
end;
$$;

create or replace function decide_payment(p_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row payments;
  v_old jsonb;
begin
  select * into v_row from payments where id = p_id for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'no_data_found';
  end if;

  perform assert_can_approve(v_row.created_by);

  if v_row.status <> 'submitted' then
    raise exception 'Only a payment awaiting approval can be decided (this one is %).', v_row.status
      using errcode = 'check_violation';
  end if;

  v_old := to_jsonb(v_row);

  if p_approve then
    update payments set approved_by = auth.uid(), approved_at = now() where id = p_id;
    v_row := post_payment(p_id);
  else
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Give a reason for rejecting the payment.' using errcode = 'check_violation';
    end if;
    update payments
       set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
           rejection_reason = btrim(p_reason)
     where id = p_id
    returning * into v_row;
  end if;

  perform write_audit('treasury.payment_' || case when p_approve then 'approved' else 'rejected' end,
    'Finance', p_id::text,
    format('%s %s: %s to %s', v_row.payment_no,
           case when p_approve then 'approved and paid' else 'rejected' end, ugx(v_row.amount), v_row.payee),
    v_old, to_jsonb(v_row), p_reason);

  return payment_result(v_row);
end;
$$;

create or replace function cancel_payment(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row payments;
  v_old jsonb;
begin
  perform assert_capability(can_record_finance(), 'cancel payments');

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for cancelling.' using errcode = 'check_violation';
  end if;

  select * into v_row from payments where id = p_id for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'no_data_found';
  end if;
  if v_row.status not in ('draft', 'submitted') then
    raise exception 'A % payment cannot be cancelled. A completed payment is corrected by reversing it.', v_row.status
      using errcode = 'check_violation';
  end if;
  if v_row.created_by <> auth.uid() and not can_approve_finance() then
    raise exception 'Only the person who recorded this payment, or an approver, can cancel it.'
      using errcode = 'insufficient_privilege';
  end if;

  v_old := to_jsonb(v_row);
  update payments
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancellation_reason = btrim(p_reason)
   where id = p_id
  returning * into v_row;

  perform write_audit('treasury.payment_cancelled', 'Finance', p_id::text,
    format('%s cancelled (%s to %s)', v_row.payment_no, ugx(v_row.amount), v_row.payee),
    v_old, to_jsonb(v_row), p_reason);

  return payment_result(v_row);
end;
$$;

grant execute on function create_payment(text, uuid, numeric, uuid, date, uuid, payment_method, text, text, text, boolean, text) to authenticated;
grant execute on function submit_payment(uuid)                 to authenticated;
grant execute on function decide_payment(uuid, boolean, text)  to authenticated;
grant execute on function cancel_payment(uuid, text)           to authenticated;

-- ===========================================================================
-- 25. EXPENSES, now paid from a named account
--
-- The two-step flow from 0002 is unchanged in spirit: recording files a
-- request, and only approval posts the money. What changes is that the
-- request names the account the money will leave, carries a BND-PAY- number,
-- and - under four eyes - cannot be approved by the person who filed it.
-- ===========================================================================
drop function if exists record_expense(uuid, numeric, text, date, payment_method, text, text);

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
          next_document_no('PAY'), nullif(btrim(coalesce(p_payee, '')), ''),
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
    values (coalesce(v_row.payment_no, next_document_no('PAY')), null, 'expense', 'posted',
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

grant execute on function record_expense(uuid, numeric, text, date, payment_method, text, text, uuid, text, text, text) to authenticated;
grant execute on function approve_expense(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- 26. REVERSALS, with a reversal date
--
-- 0002's function with one addition: the date the reversal is booked on. The
-- account side needs nothing here - the posting trigger mirrors the original
-- row's accounts, and marks a reversed transfer or payment document.
-- ===========================================================================
drop function if exists reverse_transaction(uuid, text);

create or replace function reverse_transaction(
  p_transaction_id uuid,
  p_reason         text,
  p_reversal_date  date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_orig      transactions;
  v_rev       transactions;
  v_on        date := coalesce(p_reversal_date, current_date);
  v_period_id uuid;
  v_paid      numeric(16,2);
  v_exp       numeric(16,2);
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
  if v_on > current_date then
    raise exception 'A reversal cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  if v_on < v_orig.occurred_on then
    raise exception 'A reversal cannot be dated before the transaction it reverses (%).',
      to_char(v_orig.occurred_on, 'DD Mon YYYY') using errcode = 'check_violation';
  end if;

  insert into transactions (reference, member_id, type, status, amount, method,
                            occurred_on, description, loan_id, savings_id, share_lot_id,
                            income_id, expense_id, reverses_id, reversal_reason, recorded_by)
  values (next_document_no('TX'), v_orig.member_id, v_orig.type, 'reversal', v_orig.amount,
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
    update loans
       set status = case when status = 'completed' then 'active'::loan_status else status end,
           completed_on = case when status = 'completed' then null else completed_on end
     where id = v_orig.loan_id;
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

grant execute on function reverse_transaction(uuid, text, date) to authenticated;

-- ===========================================================================
-- 27. RECONCILIATION
-- ===========================================================================
create or replace function record_reconciliation(
  p_account_id          uuid,
  p_reconciliation_date date,
  p_actual_balance      numeric,
  p_reason              text default null,
  p_statement_reference text default null,
  p_notes               text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acct   financial_accounts;
  v_system numeric(16,2);
  v_row    reconciliations;
  v_on     date := coalesce(p_reconciliation_date, current_date);
begin
  perform assert_capability(can_reconcile_finance(), 'reconcile accounts');

  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception 'Account not found.' using errcode = 'no_data_found';
  end if;
  if p_actual_balance is null then
    raise exception 'Enter the actual balance.' using errcode = 'check_violation';
  end if;
  if v_on > current_date then
    raise exception 'A reconciliation cannot be dated in the future.' using errcode = 'check_violation';
  end if;

  v_system := account_balance_at(p_account_id, v_on);

  if p_actual_balance <> v_system and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'The actual balance differs from the system balance by %. Explain the variance.',
      ugx(p_actual_balance - v_system) using errcode = 'check_violation';
  end if;

  insert into reconciliations (reconciliation_no, account_id, reconciliation_date, system_balance,
                               actual_balance, reason, statement_reference, notes, reconciled_by)
  values (next_document_no('REC'), p_account_id, v_on, v_system, p_actual_balance,
          nullif(btrim(coalesce(p_reason, '')), ''),
          nullif(btrim(coalesce(p_statement_reference, '')), ''),
          nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_row;

  perform write_audit(
    case when v_row.variance = 0 then 'treasury.reconciled' else 'treasury.reconciliation_variance' end,
    'Finance', v_row.id::text,
    format('%s reconciled as at %s: system %s, actual %s, variance %s', v_acct.name,
           to_char(v_on, 'DD Mon YYYY'), ugx(v_system), ugx(p_actual_balance), ugx(v_row.variance)),
    null, to_jsonb(v_row), p_reason);

  return jsonb_build_object('id', v_row.id, 'reconciliation_no', v_row.reconciliation_no,
                            'system_balance', v_row.system_balance,
                            'actual_balance', v_row.actual_balance,
                            'variance', v_row.variance,
                            'outcome', case when v_row.variance = 0 then 'reconciled' else 'variance' end);
end;
$$;

grant execute on function record_reconciliation(uuid, date, numeric, text, text, text) to authenticated;

-- ===========================================================================
-- 28. SUPPORTING DOCUMENTS
-- ===========================================================================
create or replace function attach_finance_document(
  p_owner_type   text,
  p_owner_id     uuid,
  p_storage_path text,
  p_file_name    text,
  p_mime_type    text default null,
  p_size_bytes   integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row    finance_documents;
  v_exists boolean;
  v_label  text;
begin
  perform assert_capability(can_record_finance(), 'attach documents');

  v_exists := case p_owner_type
    when 'transfer'       then exists (select 1 from internal_transfers where id = p_owner_id)
    when 'payment'        then exists (select 1 from payments where id = p_owner_id)
    when 'expense'        then exists (select 1 from expense_entries where id = p_owner_id)
    when 'reconciliation' then exists (select 1 from reconciliations where id = p_owner_id)
    else false end;
  if not v_exists then
    raise exception 'The record this document belongs to was not found.' using errcode = 'no_data_found';
  end if;

  -- The path is where the bucket policy let the file be written; it must sit
  -- under the record it claims to support.
  if p_storage_path not like p_owner_type || 's/' || p_owner_id::text || '/%' then
    raise exception 'That document path does not belong to this record.' using errcode = 'check_violation';
  end if;

  insert into finance_documents (owner_type, owner_id, storage_path, file_name, mime_type,
                                 size_bytes, uploaded_by)
  values (p_owner_type, p_owner_id, p_storage_path, btrim(p_file_name), p_mime_type,
          p_size_bytes, auth.uid())
  returning * into v_row;

  v_label := case p_owner_type
    when 'transfer' then (select transfer_no from internal_transfers where id = p_owner_id)
    when 'payment'  then (select payment_no from payments where id = p_owner_id)
    when 'expense'  then (select payment_no from expense_entries where id = p_owner_id)
    else (select reconciliation_no from reconciliations where id = p_owner_id) end;

  perform write_audit('treasury.document_attached', 'Finance', p_owner_id::text,
    format('Document %s attached to %s', v_row.file_name, coalesce(v_label, p_owner_type)),
    null, to_jsonb(v_row), null);

  return jsonb_build_object('id', v_row.id, 'storage_path', v_row.storage_path);
end;
$$;

grant execute on function attach_finance_document(text, uuid, text, text, text, integer) to authenticated;

-- ===========================================================================
-- 29. THE FINANCE DASHBOARD, THE CASH & BANK REPORT, THE CHARTS
-- ===========================================================================

/**
 * Everything the finance dashboard shows, in one round trip, for one day.
 *
 * Balances are live. The day's figures are the account movements dated that
 * day, grouped by what they were - the page decides how to lay them out, but
 * never computes a figure of its own.
 */
create or replace function treasury_summary(p_on date default current_date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_on   date := coalesce(p_on, current_date);
  v_days integer := setting_int('treasury.reconciliation_overdue_days');
  v_large numeric := setting_number('treasury.large_withdrawal_alert');
begin
  perform assert_capability(can_view_finance(), 'view the finance dashboard');

  return jsonb_build_object(
    'as_of', v_on,
    'accounts', (
      select coalesce(jsonb_agg(to_jsonb(b) order by
               case b.account_type when 'merchant' then 1 when 'bank' then 2 else 3 end,
               b.is_default desc, b.name), '[]'::jsonb)
        from financial_account_balances b
       where b.status <> 'closed' or b.balance <> 0
    ),
    'totals', (
      select jsonb_build_object(
        'merchant', coalesce(sum(balance) filter (where account_type = 'merchant'), 0),
        'bank',     coalesce(sum(balance) filter (where account_type = 'bank'), 0),
        'cash',     coalesce(sum(balance) filter (where account_type = 'cash'), 0),
        'total',    coalesce(sum(balance), 0))
        from financial_account_balances
    ),
    'movements', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select account_type, movement_class, counter_account_type, txn_type,
               sum(money_in)::numeric(16,2) as money_in, sum(money_out)::numeric(16,2) as money_out,
               count(*)::integer as entries
          from account_movements
         where entry_date = v_on
         group by account_type, movement_class, counter_account_type, txn_type
      ) x
    ),
    'pending', jsonb_build_object(
      'transfers',        (select count(*) from internal_transfers where status = 'submitted'),
      'transfers_amount', (select coalesce(sum(amount), 0) from internal_transfers where status = 'submitted'),
      'deposits',         (select count(*) from internal_transfers
                            where status in ('draft', 'submitted')
                              and kind in ('merchant_to_bank', 'cash_to_bank')),
      'deposits_amount',  (select coalesce(sum(amount), 0) from internal_transfers
                            where status in ('draft', 'submitted')
                              and kind in ('merchant_to_bank', 'cash_to_bank')),
      'payments',         (select count(*) from payments where status = 'submitted'),
      'payments_amount',  (select coalesce(sum(amount), 0) from payments where status = 'submitted'),
      'expenses',         (select count(*) from expense_entries where approval = 'pending'),
      'expenses_amount',  (select coalesce(sum(amount), 0) from expense_entries where approval = 'pending'),
      'drafts',           (select count(*) from internal_transfers where status = 'draft')
                          + (select count(*) from payments where status = 'draft')
    ),
    'reversals_this_month', (
      select count(*) from transactions
       where status = 'reversal' and occurred_on >= date_trunc('month', v_on)::date
         and occurred_on <= v_on
    ),
    'large_withdrawals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id, 'transfer_no', x.transfer_no, 'amount', x.amount,
               'transfer_date', x.transfer_date, 'status', x.status) order by x.amount desc), '[]'::jsonb)
        from internal_transfers x
       where v_large > 0 and x.kind = 'bank_to_cash' and x.amount >= v_large
         and (x.status in ('draft', 'submitted')
              or (x.status = 'completed' and x.transfer_date >= v_on - 6))
    ),
    'unreconciled', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name, 'account_type', b.account_type,
               'last_reconciled_on', b.last_reconciled_on) order by b.name), '[]'::jsonb)
        from financial_account_balances b
       where b.status = 'active' and b.entry_count > 0
         and (b.last_reconciled_on is null
              or (v_days > 0 and b.last_reconciled_on < v_on - v_days))
    ),
    'variances', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name, 'account_type', b.account_type,
               'last_reconciled_on', b.last_reconciled_on, 'variance', b.last_variance)
               order by abs(b.last_variance) desc), '[]'::jsonb)
        from financial_account_balances b
       where b.status <> 'closed' and coalesce(b.last_variance, 0) <> 0
    ),
    'thresholds', jsonb_build_object(
      'merchant_balance_alert', setting_number('treasury.merchant_balance_alert'),
      'cash_balance_alert',     setting_number('treasury.cash_balance_alert'),
      'large_withdrawal_alert', v_large,
      'reconciliation_overdue_days', v_days
    )
  );
end;
$$;

/**
 * The Cash & Bank report for a window: each account's opening balance, what
 * came in and went out grouped by what it was, and the closing balance.
 * Opening + in - out = closing holds for every account by construction.
 */
create or replace function cash_bank_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(can_view_finance(), 'view the cash and bank report');

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid period.' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'accounts', (
      select coalesce(jsonb_agg(x order by x.type_order, x.name), '[]'::jsonb) from (
        select a.id, a.code, a.name, a.account_type, a.status,
               case a.account_type when 'merchant' then 1 when 'bank' then 2 else 3 end as type_order,
               (a.opening_balance
                + coalesce(sum(e.debit - e.credit) filter (where e.entry_date < p_from), 0))::numeric(16,2) as opening,
               coalesce(sum(e.debit)  filter (where e.entry_date between p_from and p_to), 0)::numeric(16,2) as money_in,
               coalesce(sum(e.credit) filter (where e.entry_date between p_from and p_to), 0)::numeric(16,2) as money_out,
               (a.opening_balance
                + coalesce(sum(e.debit - e.credit) filter (where e.entry_date <= p_to), 0))::numeric(16,2) as closing
          from financial_accounts a
          left join account_ledger_entries e on e.account_id = a.id
         group by a.id
        having a.status <> 'closed' or coalesce(sum(e.debit + e.credit), 0) <> 0
      ) x
    ),
    'movements', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select account_id, account_type, movement_class, counter_account_type, txn_type,
               category_label,
               sum(money_in)::numeric(16,2)  as money_in,
               sum(money_out)::numeric(16,2) as money_out,
               count(*)::integer             as entries
          from account_movements
         where entry_date between p_from and p_to
         group by account_id, account_type, movement_class, counter_account_type, txn_type, category_label
      ) x
    ),
    'generated_at', now()
  );
end;
$$;

/**
 * Month by month: money received against money paid (internal transfers
 * excluded - they are not money in or out of the SACCO), merchant collections
 * against merchant-to-bank transfers, and money into the bank against
 * bank-to-cash withdrawals. Reversed entries and their reversals are both left
 * out, so a corrected mistake does not show as activity.
 */
create or replace function treasury_monthly_flow(p_months integer default 6)
returns table (
  bucket date, label text,
  money_in numeric, money_out numeric,
  merchant_collections numeric, merchant_to_bank numeric,
  bank_in numeric, bank_to_cash numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(can_view_finance(), 'view finance charts');

  return query
  with months as (
    select generate_series(
             date_trunc('month', current_date) - ((greatest(least(p_months, 24), 1) - 1) || ' month')::interval,
             date_trunc('month', current_date),
             '1 month')::date as bucket
  ),
  mv as (
    select date_trunc('month', entry_date)::date as bucket, *
      from account_movements
     where txn_status = 'posted'
       and entry_date >= (select min(m.bucket) from months m)
  )
  select m.bucket,
         to_char(m.bucket, 'Mon'),
         coalesce(sum(mv.money_in)  filter (where mv.txn_type <> 'transfer'), 0)::numeric,
         coalesce(sum(mv.money_out) filter (where mv.txn_type <> 'transfer'), 0)::numeric,
         coalesce(sum(mv.money_in)  filter (where mv.account_type = 'merchant'
                                              and mv.movement_class in ('collection', 'other_receipt')), 0)::numeric,
         coalesce(sum(mv.money_out) filter (where mv.account_type = 'merchant'
                                              and mv.movement_class = 'transfer_out'
                                              and mv.counter_account_type = 'bank'), 0)::numeric,
         coalesce(sum(mv.money_in)  filter (where mv.account_type = 'bank'), 0)::numeric,
         coalesce(sum(mv.money_out) filter (where mv.account_type = 'bank'
                                              and mv.movement_class = 'transfer_out'
                                              and mv.counter_account_type = 'cash'), 0)::numeric
    from months m
    left join mv on mv.bucket = m.bucket
   group by m.bucket
   order by m.bucket;
end;
$$;

/** Receipts and payments by category for a window, from the account ledger. */
create or replace function receipts_and_payments(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(can_view_finance(), 'view receipts and payments');

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid period.' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'receipts', (
      select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select category_label as category, sum(money_in)::numeric(16,2) as total, count(*)::integer as entries
          from account_movements
         where entry_date between p_from and p_to and txn_type <> 'transfer'
           and movement_class <> 'reversal' and money_in > 0
         group by category_label
      ) x
    ),
    'payments', (
      select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select category_label as category, sum(money_out)::numeric(16,2) as total, count(*)::integer as entries
          from account_movements
         where entry_date between p_from and p_to and txn_type <> 'transfer'
           and movement_class <> 'reversal' and money_out > 0
         group by category_label
      ) x
    ),
    'reversals', (
      select jsonb_build_object(
        'money_in',  coalesce(sum(money_in), 0)::numeric(16,2),
        'money_out', coalesce(sum(money_out), 0)::numeric(16,2),
        'entries',   count(*)::integer)
        from account_movements
       where entry_date between p_from and p_to and movement_class = 'reversal'
         and txn_type <> 'transfer'
    ),
    'transfers', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select kind, count(*)::integer as entries, sum(amount)::numeric(16,2) as total
          from internal_transfers
         where status in ('completed', 'reversed') and transfer_date between p_from and p_to
         group by kind
      ) x
    )
  );
end;
$$;

grant execute on function treasury_summary(date)             to authenticated;
grant execute on function cash_bank_report(date, date)       to authenticated;
grant execute on function treasury_monthly_flow(integer)     to authenticated;
grant execute on function receipts_and_payments(date, date)  to authenticated;

-- ---------------------------------------------------------------------------
-- 30. The cashbook counts only what stands
--
-- 0011's cashbook summed income and approved expenses whether or not their
-- ledger row had since been reversed, so a corrected mistake stayed in the
-- profit and loss. Now an entry counts only while its transaction is posted.
-- ---------------------------------------------------------------------------
create or replace function cashbook(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform assert_capability(can_view_finance(), 'view the cashbook');

  with inc as (
    select i.*, c.name as category
      from income_entries i
      join income_categories c on c.id = i.category_id
      left join transactions t on t.id = i.transaction_id
     where i.received_on between p_from and p_to
       and coalesce(t.status, 'posted') = 'posted'
  ),
  exp as (
    select e.*, c.name as category
      from expense_entries e
      join expense_categories c on c.id = e.category_id
      left join transactions t on t.id = e.transaction_id
     where e.spent_on between p_from and p_to
       and e.approval = 'approved'
       and coalesce(t.status, 'posted') = 'posted'
  )
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'income', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                 select category, sum(amount) as total, count(*) as entries from inc group by category) x),
    'expenses', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                 select category, sum(amount) as total, count(*) as entries from exp group by category) x),
    'total_income',   (select coalesce(sum(amount), 0) from inc),
    'total_expenses', (select coalesce(sum(amount), 0) from exp)
  ) into v;

  return v || jsonb_build_object(
    'net_surplus', (v ->> 'total_income')::numeric - (v ->> 'total_expenses')::numeric
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 31. Receipts print their receipt number and the accounts
-- ---------------------------------------------------------------------------
create or replace function receipt_for_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_txn transaction_feed;
  v_row transactions;
begin
  select * into v_txn from transaction_feed where id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found.' using errcode = 'no_data_found';
  end if;

  if not (can_view_operations() or v_txn.member_id = current_member_id()) then
    raise exception 'You may only view your own receipts.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from transactions where id = p_transaction_id;

  return jsonb_build_object(
    'transaction',   to_jsonb(v_txn),
    'sacco_name',    sacco_legal_name(),
    'receipt_no',    coalesce((select receipt_no from receipts where transaction_id = p_transaction_id),
                              replace(v_txn.reference, 'BND-TX-', 'BND-RCP-')),
    'external_ref',  v_row.external_ref,
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
    -- The accounts are shown to staff only; a member's receipt says how they
    -- paid, not which of the SACCO's wallets it landed in.
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

grant execute on function receipt_for_transaction(uuid) to authenticated;
