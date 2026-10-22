/** Authorization matrix: real role identities against sensitive RPCs and RLS reads.
 *  Disposable local DB, synthetic accounts. Everything rolls back. */
import pg from 'pg';
const URL = 'postgresql://postgres@127.0.0.1:55432/budsacco_clean';
const a = new pg.Client({connectionString:URL}); await a.connect();

// Synthetic logins, one per role, plus a member login bound to a seeded member.
const ROLES = ['member','viewer','cashier','field_officer','loan_officer','accountant','admin','manager','super_admin'];
const ids = {};
for (const role of ROLES) {
  const { rows } = await a.query(`
    with m as (select id from members where user_id is null and status='active' order by member_no limit 1)
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select gen_random_uuid(),'authenticated','authenticated', $2, 'x', now(),
           case when $1 = 'member' then jsonb_build_object('member_id',(select id from m))
                else jsonb_build_object('role',$1) end,
           jsonb_build_object('full_name', 'Synthetic ' || $1), now(), now()
    returning id`, [role, `synth.${role}@test.invalid`]);
  ids[role] = rows[0].id;
  await a.query(`update app_users set must_change_password=false, password_set_at=now() where id=$1`, [rows[0].id]);
}
// A second member, to test cross-member isolation.
const { rows: m2 } = await a.query(`
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select gen_random_uuid(),'authenticated','authenticated','synth.member2@test.invalid','x',now(),
         jsonb_build_object('member_id',(select id from members where user_id is null and status='active' order by member_no limit 1)),
         jsonb_build_object('full_name','Synthetic member2'),now(),now() returning id`);
await a.query(`update app_users set must_change_password=false, password_set_at=now() where id=$1`, [m2[0].id]);
ids['member2'] = m2[0].id;

const { rows: who } = await a.query(`select u.id, u.role, m.member_no from app_users u left join members m on m.user_id=u.id where u.email like 'synth.%' or u.id = any($1::uuid[])`, [Object.values(ids)]);
console.log('synthetic identities:'); for (const w of who) console.log(`   ${w.role.padEnd(14)} ${w.member_no ?? ''}`);

async function as(role, sql, params=[]) {
  const c = new pg.Client({connectionString:URL}); await c.connect();
  try {
    await c.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub: ids[role], role:'authenticated'})]);
    await c.query('set role authenticated');
    await c.query('begin');
    const r = await c.query(sql, params);
    await c.query('rollback');
    return { ok: true, rows: r.rows };
  } catch (e) { try{await c.query('rollback');}catch{} return { ok:false, err: e.message.split('\n')[0].slice(0,80) }; }
  finally { await c.end(); }
}

const { rows: fixt } = await a.query(`
  select (select id from financial_accounts where account_type='cash' limit 1) cash,
         (select id from financial_accounts where account_type='bank' limit 1) bank,
         (select id from members order by member_no limit 1) m1,
         (select id from loan_products where is_active limit 1) prod,
         (select id from loans where status='active' limit 1) loan,
         (select id from transactions where status='posted' and type='monthly_savings' limit 1) txn`);
const F = fixt[0];

const PROBES = [
  ['read all members',            `select count(*) n from members`],
  ['read all transactions',       `select count(*) n from transactions`],
  ['read account_ledger_entries', `select count(*) n from account_ledger_entries`],
  ['read financial_accounts',     `select count(*) n from financial_accounts`],
  ['read audit_logs',             `select count(*) n from audit_logs`],
  ['read app_users',              `select count(*) n from app_users`],
  ['read login_attempts',         `select count(*) n from login_attempts`],
  ['read other members loans',    `select count(*) n from loans`],
  ['change share price',          `select update_share_settings(999999, 1)`],
  ['change SACCO settings',       `select update_settings('{"security.session_timeout_minutes":"999"}'::jsonb,'audit probe')`],
  ['create financial account',    `select create_financial_account('cash','probe',null,null,null,null,null,null,0,current_date,null,false)`],
  ['record a savings collection', `select record_member_collection($1,'savings',1000,$2,current_date,'cash',null,'probe',null,'monthly',null,null,'probe-'||gen_random_uuid(),null,null)`, [F.m1, F.cash]],
  ['record an expense',           `select record_expense((select id from expense_categories limit 1),1000,'probe',current_date,'cash','x','probe-'||gen_random_uuid(),$1,'payee','ref','n',null)`, [F.cash]],
  ['reverse a transaction',       `select reverse_transaction($1,'audit probe',current_date)`, [F.txn]],
  ['disburse a loan',             `select disburse_loan((select id from loans where status='approved' limit 1),'cash',current_date,'probe-'||gen_random_uuid())`],
  ['grant itself a permission',   `select set_role_permissions('member', array['transactions.reverse'],'audit probe')`],
  ['change its own role',         `select set_user_role($1,'super_admin','audit probe')`, [null]],
  ['issue a temporary password',  `select issue_temporary_password($1)`, [null]],
  ['read the whole ledger view',  `select count(*) n from account_movements`],
  ['run the cashbook report',     `select cashbook(current_date - 30, current_date)`],
];

const header = ['probe'.padEnd(30), ...ROLES.map(r=>r.slice(0,9).padEnd(10))].join('');
console.log('\n' + header);
console.log('-'.repeat(header.length));
const results = {};
for (const [label, sql, params] of PROBES) {
  const line = [label.padEnd(30)];
  results[label] = {};
  for (const role of ROLES) {
    let p = params;
    if (label === 'change its own role' || label === 'issue a temporary password') p = [ids[role]];
    const r = await as(role, sql, p ?? []);
    let cell;
    if (!r.ok) cell = /permission|privilege|not allowed|cannot|only|may only/i.test(r.err) ? 'DENIED' : 'err';
    else if (r.rows[0] && 'n' in r.rows[0]) cell = String(r.rows[0].n);
    else cell = 'ALLOWED';
    results[label][role] = { cell, err: r.err };
    line.push(cell.padEnd(10));
  }
  console.log(line.join(''));
}

// Cross-member isolation, explicitly.
console.log('\n-- cross-member isolation --');
for (const role of ['member','member2']) {
  const r = await as(role, `select (select count(*) from members) members_visible,
                                   (select count(*) from transactions) txns_visible,
                                   (select member_no from members limit 1) which`);
  console.log(`   ${role}: ${JSON.stringify(r.ok ? r.rows[0] : r.err)}`);
}
const own = await as('member', `select current_member_id() mine`);
const other = await as('member', `select member_statement((select id from members where id <> current_member_id() limit 1), current_date-365, current_date)`);
console.log(`   member current_member_id -> ${own.rows?.[0]?.mine}`);
console.log(`   member reading ANOTHER member's statement -> ${other.ok ? 'ALLOWED (!!)' : 'DENIED: ' + other.err}`);

await a.query(`delete from auth.users where email like 'synth.%'`);
await a.end();
