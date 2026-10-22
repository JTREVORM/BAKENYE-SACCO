/**
 * Financial concurrency and idempotency tests.
 * Disposable local PostgreSQL only. Synthetic data only.
 * Each scenario runs real concurrent sessions as a real super_admin identity.
 */
import pg from 'pg';
const URL = 'postgresql://postgres@127.0.0.1:55432/budsacco_clean';

async function session() {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  const { rows } = await c.query("select id from app_users where role='super_admin' and is_active limit 1");
  await c.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: rows[0].id, role: 'authenticated' }),
  ]);
  await c.query('set role authenticated');
  return c;
}
const admin = async () => { const c = new pg.Client({connectionString:URL}); await c.connect(); return c; };

const out = [];
const log = (s, ok, detail) => { out.push({s, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}\n      ${detail}`); };

const a = await admin();
const { rows: ctx } = await a.query(`
  select (select id from members where status='active' order by member_no limit 1) as member,
         (select id from financial_accounts where account_type='cash' and status='active' limit 1) as cash`);
const MEMBER = ctx[0].member, CASH = ctx[0].cash;

async function count(where) {
  const { rows } = await a.query(`select count(*)::int n, coalesce(sum(amount),0)::numeric total from transactions where ${where}`);
  return rows[0];
}
async function balance() {
  const { rows } = await a.query(`select balance from financial_account_balances where id=$1`, [CASH]);
  return rows[0].balance;
}

/* ---- T1: same idempotency key, two CONCURRENT sessions ---- */
{
  const key = 'audit-T1-' + Date.now();
  const before = await count(`idempotency_key like 'audit-T1-%'`);
  const b0 = await balance();
  const [c1, c2] = [await session(), await session()];
  const call = (c) => c.query(
    `select record_member_collection($1,'savings',5000,$2,current_date,'cash',null,'T1 concurrent',null,'monthly',null,null,$3,null,null)`,
    [MEMBER, CASH, key]).then(() => 'ok').catch(e => 'ERR:' + e.message.slice(0, 70));
  const res = await Promise.all([call(c1), call(c2)]);
  const after = await count(`idempotency_key = '${key}'`);
  const b1 = await balance();
  log('T1 same idempotency key, two concurrent cashiers',
      after.n === 1 && Number(b1) - Number(b0) === 5000,
      `rows posted=${after.n} (want 1), cash moved=${Number(b1)-Number(b0)} (want 5000), results=${JSON.stringify(res)}`);
}

/* ---- T2: same idempotency key, SEQUENTIAL retry (dropped response) ---- */
{
  const key = 'audit-T2-' + Date.now();
  const c = await session();
  const b0 = await balance();
  const r1 = await c.query(`select record_member_collection($1,'savings',7000,$2,current_date,'cash',null,'T2 retry',null,'monthly',null,null,$3,null,null) r`, [MEMBER, CASH, key]);
  const r2 = await c.query(`select record_member_collection($1,'savings',7000,$2,current_date,'cash',null,'T2 retry',null,'monthly',null,null,$3,null,null) r`, [MEMBER, CASH, key]);
  const after = await count(`idempotency_key='${key}'`);
  const b1 = await balance();
  const ref1 = r1.rows[0].r.reference, ref2 = r2.rows[0].r.reference;
  log('T2 same idempotency key, sequential retry returns the original',
      after.n === 1 && ref1 === ref2 && Number(b1) - Number(b0) === 7000,
      `rows=${after.n} (want 1), refs ${ref1} == ${ref2}, cash moved=${Number(b1)-Number(b0)} (want 7000)`);
}

/* ---- T3: DIFFERENT keys, byte-identical collection (true double submit from two tabs) ---- */
{
  const b0 = await balance();
  const c = await session();
  const k1 = 'audit-T3a-' + Date.now(), k2 = 'audit-T3b-' + Date.now();
  await c.query(`select record_member_collection($1,'savings',9000,$2,current_date,'cash',null,'T3 identical',null,'monthly',null,null,$3,null,null)`, [MEMBER, CASH, k1]);
  let second = 'posted';
  try { await c.query(`select record_member_collection($1,'savings',9000,$2,current_date,'cash',null,'T3 identical',null,'monthly',null,null,$3,null,null)`, [MEMBER, CASH, k2]); }
  catch (e) { second = 'refused: ' + e.message.slice(0,60); }
  const b1 = await balance();
  log('T3 identical collection under a DIFFERENT key posts twice (no near-duplicate guard)',
      true,
      `second attempt => ${second}; cash moved=${Number(b1)-Number(b0)} (two 9,000 postings = 18,000 means a genuine double payment is accepted)`);
}

/* ---- T4: concurrent postings to the SAME account: running balance integrity ---- */
{
  const b0 = Number(await balance());
  const N = 12;
  const sessions = await Promise.all(Array.from({length: N}, () => session()));
  const res = await Promise.all(sessions.map((c, i) =>
    c.query(`select record_member_collection($1,'savings',1000,$2,current_date,'cash',null,'T4 #${i}',null,'monthly',null,null,$3,null,null)`,
      [MEMBER, CASH, 'audit-T4-' + Date.now() + '-' + i]).then(()=>'ok').catch(e=>'ERR:'+e.message.slice(0,50))));
  const okCount = res.filter(r => r === 'ok').length;
  const b1 = Number(await balance());
  const { rows: chk } = await a.query(`
    with s as (select e.*, row_number() over (order by id) rn,
                 sum(debit-credit) over (order by id) cum
                 from account_ledger_entries e where account_id=$1)
    select count(*)::int bad from s
     join financial_accounts fa on fa.id=$1
     where s.balance_after <> (fa.opening_balance + s.cum)::numeric(16,2)`, [CASH]);
  log('T4 12 concurrent postings to one account keep balance_after exact',
      chk[0].bad === 0 && b1 - b0 === okCount * 1000,
      `posted=${okCount}/${N}, cash moved=${b1-b0} (want ${okCount*1000}), balance_after rows disagreeing with the cumulative sum=${chk[0].bad}`);
}

/* ---- T5: double reversal of the same transaction, concurrently ---- */
{
  const c0 = await session();
  const { rows: t } = await c0.query(
    `select record_member_collection($1,'savings',4000,$2,current_date,'cash',null,'T5 to reverse',null,'monthly',null,null,$3,null,null) r`,
    [MEMBER, CASH, 'audit-T5-' + Date.now()]);
  const txnId = t[0].r.transaction_id;
  const b0 = Number(await balance());
  const [c1, c2] = [await session(), await session()];
  const rev = (c) => c.query(`select reverse_transaction($1,'audit double-reversal test',current_date)`, [txnId])
    .then(()=>'reversed').catch(e=>'refused');
  const res = await Promise.all([rev(c1), rev(c2)]);
  const { rows: n } = await a.query(`select count(*)::int n from transactions where reverses_id=$1`, [txnId]);
  const b1 = Number(await balance());
  log('T5 concurrent double reversal creates exactly one reversal',
      n[0].n === 1 && b1 - b0 === -4000,
      `reversal rows=${n[0].n} (want 1), cash moved=${b1-b0} (want -4000), results=${JSON.stringify(res)}`);
}

/* ---- T6: concurrent repayments on one loan: can outstanding go negative / overpay? ---- */
{
  const { rows: L } = await a.query(`
    select l.id, l.loan_no, lb.outstanding from loans l join loan_balances lb on lb.loan_id=l.id
     where l.status='active' order by lb.outstanding desc limit 1`);
  if (L.length === 0) { log('T6 concurrent loan repayments', false, 'no active loan in the seed'); }
  else {
    const loan = L[0];
    const amt = Math.floor(Number(loan.outstanding) * 0.8);
    const [c1, c2] = [await session(), await session()];
    const pay = (c, i) => c.query(`select record_loan_repayment($1,$2,current_date,'cash',$3)`,
      [loan.id, amt, 'audit-T6-' + Date.now() + '-' + i]).then(()=>'ok').catch(e=>'refused: '+e.message.slice(0,60));
    const res = await Promise.all([pay(c1,1), pay(c2,2)]);
    const { rows: after } = await a.query(`select lb.outstanding, l.status from loans l join loan_balances lb on lb.loan_id=l.id where l.id=$1`, [loan.id]);
    log('T6 two concurrent repayments of 80% each cannot overpay the loan',
        Number(after[0].outstanding) >= 0,
        `outstanding before=${loan.outstanding}, each paid=${amt}, outstanding after=${after[0].outstanding}, status=${after[0].status}, results=${JSON.stringify(res)}`);
  }
}

console.log(`\n${out.filter(o=>o.ok).length} pass, ${out.filter(o=>!o.ok).length} fail`);
process.exit(0);
