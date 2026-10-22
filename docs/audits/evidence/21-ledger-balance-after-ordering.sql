-- Finding F-15: account_ledger_entries.balance_after is an INSERTION-order
-- running balance, not a date-order one, so it is wrong for any backdated entry.
-- The ledger and statement screens read the recomputed `running_balance`
-- column instead, which is why this is latent rather than live.
with seq as (
  select e.*, a.name,
         row_number() over (partition by e.account_id order by e.id)              as by_insert,
         row_number() over (partition by e.account_id order by e.entry_date, e.id) as by_date
    from account_ledger_entries e join financial_accounts a on a.id = e.account_id)
select count(*) filter (where by_insert <> by_date) as entries_out_of_date_order,
       count(*)                                     as entries_total
  from seq;

-- Side by side on one account: the stored column against the recomputed one.
select entry_date, money_in, money_out, balance_after, running_balance
  from account_movements
 where account_name = 'Cash at Hand'
 order by entry_date, entry_id
 limit 15;
