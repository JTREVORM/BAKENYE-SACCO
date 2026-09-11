-- ===========================================================================
-- BUD-SACCO - 0031 - The accounts a counter may receive money into
--
-- Registering a member takes the registration fees into Cash at Merchant,
-- Cash at Bank or Cash at Hand, and whoever takes the money has to say which.
-- `financial_accounts` is readable only with `finance.view`, because it sits
-- next to the SACCO's balances. The people who take money at the counter - a
-- registering officer, a fee collector, a savings collector - need the names
-- of the accounts, not the books.
--
-- This returns exactly that: active accounts, their kind and their public
-- identifiers (merchant code, bank and account number, which are printed on
-- payment instructions anyway). No balance, no ledger.
-- ===========================================================================

create or replace function collection_accounts()
returns table (
  id            uuid,
  code          text,
  name          text,
  account_type  finance_account_type,
  is_default    boolean,
  provider      text,
  merchant_code text,
  bank_name     text,
  account_number text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(
    has_permission('members.create') or has_permission('fees.collect')
      or has_permission('savings.record') or has_permission('finance.record'),
    'see the accounts money is received into');

  return query
  select a.id, a.code, a.name, a.account_type, a.is_default,
         a.provider, a.merchant_code, a.bank_name, a.account_number
    from financial_accounts a
   where a.status = 'active'
   order by case a.account_type when 'merchant' then 0 when 'bank' then 1 else 2 end,
            a.is_default desc, a.name;
end;
$$;

revoke execute on function collection_accounts() from public, anon;
grant execute on function collection_accounts() to authenticated;
