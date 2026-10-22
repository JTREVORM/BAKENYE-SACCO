-- Accounting invariants and reconciliation checks. Read-only.
\pset pager off
\echo '== I1. every posted cash-affecting transaction has a ledger entry =='
select t.type, count(*) as txns_without_ledger_entry
  from transactions t
 where t.status in ('posted','reversal')
   and not exists (select 1 from account_ledger_entries e where e.transaction_id = t.id)
 group by t.type order by 1;

\echo '== I2. ledger balance_after vs recomputed date-ordered running balance =='
select a.name, a.code,
       (a.opening_balance + coalesce(sum(e.debit - e.credit),0))::numeric(16,2) as recomputed,
       (select e2.balance_after from account_ledger_entries e2
         where e2.account_id = a.id order by e2.id desc limit 1) as stored_latest_balance_after
  from financial_accounts a left join account_ledger_entries e on e.account_id = a.id
 group by a.id, a.name, a.code, a.opening_balance order by a.name;

\echo '== I3. financial_account_balances view vs ledger sum =='
select b.name, b.balance as view_balance,
       (select (a.opening_balance + coalesce(sum(e.debit-e.credit),0))::numeric(16,2)
          from financial_accounts a left join account_ledger_entries e on e.account_id=a.id
         where a.id = b.id group by a.opening_balance) as ledger_balance
  from financial_account_balances b order by b.name;

\echo '== I4. balance_after is NOT date-monotonic where entries are backdated =='
with seq as (
  select e.*, a.name,
         row_number() over (partition by e.account_id order by e.id) as by_insert,
         row_number() over (partition by e.account_id order by e.entry_date, e.id) as by_date
    from account_ledger_entries e join financial_accounts a on a.id=e.account_id)
select count(*) as entries_where_insert_order_differs_from_date_order
  from seq where by_insert <> by_date;

\echo '== I5. duplicate transaction references =='
select reference, count(*) from transactions group by reference having count(*)>1;

\echo '== I6. duplicate external references on non-reversed transactions =='
select upper(external_ref) as ref, count(*) from transactions
 where external_ref is not null and status <> 'reversed'
 group by 1 having count(*)>1;

\echo '== I7. member savings balance negative, or below configured minimum =='
select m.member_no, f.savings_balance from member_financials f join members m on m.id=f.id
 where f.savings_balance < 0;

\echo '== I8. savings_periods.paid_amount vs posted savings_payments =='
select p.id, m.member_no, p.paid_amount as cached,
       coalesce(sum(sp.amount),0) as from_posted_payments
  from savings_periods p join members m on m.id=p.member_id
  left join savings_payments sp on sp.period_id=p.id
  left join transactions t on t.id=sp.transaction_id and t.status='posted'
 group by p.id, m.member_no, p.paid_amount
having p.paid_amount <> coalesce(sum(case when t.id is not null then sp.amount else 0 end),0);

\echo '== I9. loan_schedule sums vs loan totals =='
select l.loan_no, l.principal, l.interest_amount, l.total_payable,
       sum(s.principal_due) as sched_principal, sum(s.interest_due) as sched_interest,
       sum(s.total_due) as sched_total
  from loans l join loan_schedule s on s.loan_id=l.id
 group by l.id, l.loan_no, l.principal, l.interest_amount, l.total_payable
having sum(s.principal_due) <> l.principal
    or sum(s.interest_due)  <> l.interest_amount
    or sum(s.total_due)     <> l.total_payable;

\echo '== I10. loan_balances outstanding vs total_payable minus posted repayments =='
select l.loan_no, l.status, lb.outstanding,
       (l.total_payable - coalesce((select sum(r.amount) from loan_repayments r
          join transactions t on t.id=r.transaction_id
         where r.loan_id=l.id and t.status='posted'),0))::numeric(16,2) as expected
  from loans l join loan_balances lb on lb.loan_id=l.id
 where l.status in ('active','completed');

\echo '== I11. orphans =='
select 'savings_payments without txn' k, count(*) from savings_payments s where not exists (select 1 from transactions t where t.id=s.transaction_id)
union all select 'share_lots without txn', count(*) from share_lots s where s.transaction_id is not null and not exists (select 1 from transactions t where t.id=s.transaction_id)
union all select 'loan_repayments without txn', count(*) from loan_repayments r where not exists (select 1 from transactions t where t.id=r.transaction_id)
union all select 'members w/o membership fee charge', count(*) from members m where not exists (select 1 from member_fees f where f.member_id=m.id)
union all select 'receipts without txn', count(*) from receipts r where not exists (select 1 from transactions t where t.id=r.transaction_id)
union all select 'ledger entries w/o txn', count(*) from account_ledger_entries e where not exists (select 1 from transactions t where t.id=e.transaction_id);

\echo '== I12. reversal pairing integrity =='
select 'reversed without reversed_by' k, count(*) from transactions where status='reversed' and reversed_by_id is null
union all select 'reversal without reverses_id', count(*) from transactions where status='reversal' and reverses_id is null
union all select 'reversal amount mismatch', count(*) from transactions r join transactions o on o.id=r.reverses_id where r.status='reversal' and r.amount<>o.amount
union all select 'reversed txn still has ledger net effect', count(*) from (
  select o.id from transactions o join transactions r on r.reverses_id=o.id
   where o.status='reversed'
     and (select coalesce(sum(e.debit-e.credit),0) from account_ledger_entries e where e.transaction_id=o.id)
       + (select coalesce(sum(e.debit-e.credit),0) from account_ledger_entries e where e.transaction_id=r.id) <> 0) x;

\echo '== I13. share capital: lots vs posted share_purchase transactions =='
select (select coalesce(sum(sl.total_value),0) from share_lots sl join transactions t on t.id=sl.transaction_id and t.status='posted') as lots_value,
       (select coalesce(sum(amount),0) from transactions where type='share_purchase' and status='posted') as txn_value;
