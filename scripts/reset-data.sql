-- ===========================================================================
-- Full data reset: removes every person, login and business record, and keeps
-- the schema and the SACCO's configuration (roles, permissions, settings,
-- share/savings categories, income/expense/payment categories, the Cash at
-- Hand account). Fees, loan products and merchant/bank accounts are set up by
-- the SACCO after installation, so they go with the data.
--
--   node scripts/db-exec.mjs scripts/reset-data.sql
--
-- DESTRUCTIVE. Run it only on a database whose data you intend to discard.
-- It runs as one transaction: either everything is removed or nothing is.
--
-- TRUNCATE is used for the business tables because the ledger tables refuse
-- row DELETEs by trigger (they are append-only in normal operation). All of
-- them are named in one statement, so the foreign keys between them are
-- satisfied, and no table outside the list references one inside it.
-- ===========================================================================
begin;

truncate table
  account_ledger_entries,
  audit_logs,
  expense_entries,
  fee_payment_lines,
  fees,
  finance_documents,
  income_entries,
  internal_transfers,
  loan_documents,
  loan_guarantors,
  loan_repayments,
  loan_schedule,
  loans,
  loan_products,
  login_attempts,
  member_fees,
  member_profile_changes,
  members,
  notifications,
  payment_intents,
  payments,
  receipts,
  reconciliations,
  savings_payments,
  savings_periods,
  savings_plans,
  share_lots,
  transactions
restart identity;

-- Merchant and bank accounts are set up by a manager, so they go with the
-- data. Only the seeded Cash at Hand account is structural; it keeps no
-- balance of its own (a balance is its entries, all removed above).
-- financial_accounts_guard refuses every DELETE in normal operation, so it is
-- switched off for this statement only, inside this transaction.
alter table financial_accounts disable trigger financial_accounts_guard;
delete from financial_accounts where code <> 'CSH-001';
update financial_accounts
   set opening_balance = 0, is_default = true, status = 'active',
       created_by = null, updated_by = null
 where code = 'CSH-001';
alter table financial_accounts enable trigger financial_accounts_guard;

-- Configuration rows keep no link to a person who is about to be removed.
update roles              set created_by = null, updated_by = null where created_by is not null or updated_by is not null;
update role_permissions   set granted_by = null where granted_by is not null;
update system_settings    set updated_by = null where updated_by is not null;
update sacco_settings     set updated_by = null where updated_by is not null;
update share_categories   set created_by = null where created_by is not null;
update savings_categories set created_by = null where created_by is not null;

-- Every login, including every administrator. app_users, identities, sessions
-- and refresh tokens go with them (ON DELETE CASCADE).
delete from auth.users;
delete from auth.audit_log_entries;
delete from auth.flow_state;
delete from auth.one_time_tokens;

-- Uploaded documents cannot be deleted from SQL (Supabase refuses direct
-- deletes on storage tables). Empty the finance-documents bucket from the
-- Storage dashboard or API first; the check below refuses to finish otherwise.

-- Document numbering starts again. The Cash at Hand account keeps its code.
delete from doc_counters
 where scope not in (select 'ACCT-' || split_part(code, '-', 1) from financial_accounts);

do $$
declare
  leftover text;
begin
  select string_agg(format('%s=%s', t, n), ', ') into leftover from (
    select 'auth.users' t, count(*) n from auth.users union all
    select 'auth.identities', count(*) from auth.identities union all
    select 'auth.sessions', count(*) from auth.sessions union all
    select 'app_users', count(*) from app_users union all
    select 'members', count(*) from members union all
    select 'transactions', count(*) from transactions union all
    select 'account_ledger_entries', count(*) from account_ledger_entries union all
    select 'loans', count(*) from loans union all
    select 'savings_payments', count(*) from savings_payments union all
    select 'share_lots', count(*) from share_lots union all
    select 'audit_logs', count(*) from audit_logs union all
    select 'login_attempts', count(*) from login_attempts union all
    select 'notifications', count(*) from notifications union all
    select 'receipts', count(*) from receipts union all
    select 'income_entries', count(*) from income_entries union all
    select 'expense_entries', count(*) from expense_entries union all
    select 'reconciliations', count(*) from reconciliations union all
    select 'fees', count(*) from fees union all
    select 'loan_products', count(*) from loan_products union all
    select 'savings_periods', count(*) from savings_periods union all
    select 'merchant/bank accounts', count(*) from financial_accounts where code <> 'CSH-001' union all
    select 'storage.objects', count(*) from storage.objects
  ) x where n > 0;
  if leftover is not null then
    raise exception 'Reset incomplete, rolled back: %', leftover;
  end if;
end $$;

commit;
