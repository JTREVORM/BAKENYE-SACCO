/** Real GoTrue + PostgREST checks. Requires the disposable DB identity guard. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database();
assert.equal(s.tokenSeconds,60,'Run auth-tokens short before API expiry tests; use standard tokens for browser tests');
const users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8'));
const results=[],clients={};
const make=()=>createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});
const value=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log(`PASS ${name}`);}catch(e){results.push({name,pass:false,detail:e.message});console.log(`FAIL ${name}: ${e.message}`);}}
const dashboards={super_admin:'administration',admin:'administration',manager:'overview',loan_officer:'loans',cashier:'cashier',accountant:'finance',field_officer:'collections',viewer:'overview',member_a:'portal',member_b:'portal'};
try{
 for(const [key,dashboard]of Object.entries(dashboards))await test(`${key}: native Auth and authoritative session`,async()=>{
  const c=make();value(await c.auth.signInWithPassword({email:users[key].email,password:users[key].password}));clients[key]=c;
  const session=value(await c.rpc('my_session'));assert.equal(session.role,users[key].role);assert.equal(session.role_dashboard,dashboard);assert.equal(session.must_change_password,false);
  if(users[key].memberId)assert.equal(session.member.id,users[key].memberId);
 });
 const a=users.member_a.memberId,b=users.member_b.memberId;
 for(const [key,own,other]of [['member_a',a,b],['member_b',b,a]]){
  const c=clients[key];
  for(const [table,column]of [['members','id'],['member_financials','id'],['member_share_progress','member_id'],['savings_payments','member_id'],['transactions','member_id'],['loans','member_id'],['payment_intents','member_id']])await test(`${key}: RLS hides peer ${table}`,async()=>assert.equal(value(await c.from(table).select('*').eq(column,other)).length,0));
  await test(`${key}: own financial values equal database`,async()=>{
   const actual=value(await c.from('member_financials').select('id,savings_balance,shares_owned,share_value,loan_balance').eq('id',own).single());
   const expected=(await db.query('select id,savings_balance,shares_owned,share_value,loan_balance from member_financials where id=$1',[own])).rows[0];
   for(const k of Object.keys(expected))assert.equal(k==='id'?actual[k]:Number(actual[k]),k==='id'?expected[k]:Number(expected[k]));
  });
  for(const table of ['audit_logs','income_entries','account_ledger_entries','financial_account_balances'])await test(`${key}: no staff ${table}`,async()=>assert.equal(value(await c.from(table).select('*')).length,0));
  await test(`${key}: peer statement denied`,async()=>assert.ok((await c.rpc('member_statement',{p_member_id:other,p_from:'2026-01-01',p_to:'2026-12-31'})).error));
  await test(`${key}: own statement accessible`,async()=>assert.ok(value(await c.rpc('member_statement',{p_member_id:own,p_from:'2026-01-01',p_to:'2026-12-31'}))));
  await test(`${key}: cannot elevate role directly`,async()=>{
   const r=await c.from('app_users').update({role:'super_admin'}).eq('id',users[key].id).select('role');assert.ok(r.error||r.data?.length===0);
   assert.equal((await db.query('select role from app_users where id=$1',[users[key].id])).rows[0].role,'member');
  });
 }
 const cash=(await db.query("select id from financial_accounts where account_type='cash' and is_default limit 1")).rows[0].id;
 for(const key of ['viewer','loan_officer','member_a','member_b'])await test(`${key}: unauthorized collection denied without mutation`,async()=>{
  const before=(await db.query('select count(*) n from transactions')).rows[0].n;
  assert.ok((await clients[key].rpc('record_member_collection',{p_member_id:a,p_collection_type:'savings',p_amount:1000,p_account_id:cash,p_method:'cash',p_idempotency_key:`cert:denied:${key}`})).error);
  assert.equal((await db.query('select count(*) n from transactions')).rows[0].n,before);
 });
 for(const key of ['cashier','field_officer','viewer','member_a'])await test(`${key}: security overview denied`,async()=>assert.ok((await clients[key].rpc('security_overview')).error));
 for(const key of ['inactive','temporary'])await test(`${key}: native login does not grant data access`,async()=>{
  const c=make();value(await c.auth.signInWithPassword({email:users[key].email,password:users[key].password}));clients[key]=c;
  assert.equal(value(await c.rpc('has_permission',{p_key:'dashboard.staff'})),false);
  assert.equal(value(await c.from('member_financials').select('*')).length,0);
 });
 await test('temporary password cannot be bypassed by calling completion RPC',async()=>{
  const c=clients.temporary;
  try{
   assert.ok((await c.rpc('log_password_changed')).error,'retired RPC must deny client execution');
   assert.equal(value(await c.rpc('has_permission',{p_key:'dashboard.staff'})),false,'unchanged temporary password gained staff permissions');
  }finally{
   // Restore this disposable account so the browser independently verifies the real form.
   await db.query('update app_users set must_change_password=true,password_set_at=null where id=$1',[users.temporary.id]);
  }
 });
 for(const key of ['member_a','member_b'])await test(`${key}: suspended member loses existing-token data access`,async()=>{
  try{
   await db.query("update members set status='suspended' where id=$1",[users[key].memberId]);
   assert.equal(value(await clients[key].rpc('current_member_id')),null);
   assert.equal(value(await clients[key].from('member_financials').select('*')).length,0);
  }finally{await db.query("update members set status='active' where id=$1",[users[key].memberId]);}
 });
 await test('cashier collection, receipt, replay and reversal reconcile with ledger',async()=>{
  const c=clients.cashier,admin=clients.super_admin;
  const before=Number((await db.query('select savings_balance from member_financials where id=$1',[a])).rows[0].savings_balance);
  const args={p_member_id:a,p_collection_type:'savings',p_amount:17500,p_account_id:cash,p_method:'cash',p_description:'Disposable API certification savings',p_idempotency_key:`cert:api:${Date.now()}`};
  const first=value(await c.rpc('record_member_collection',args));assert.ok(first.receipt_no);assert.ok(first.transaction_id);
  const replay=value(await c.rpc('record_member_collection',args));assert.equal(replay.transaction_id,first.transaction_id);
  assert.equal(Number((await db.query('select savings_balance from member_financials where id=$1',[a])).rows[0].savings_balance),before+17500);
  assert.equal((await db.query('select count(*) n from receipts where transaction_id=$1',[first.transaction_id])).rows[0].n,'1');
  const entry=(await db.query('select sum(debit-credit) n from account_ledger_entries where transaction_id=$1',[first.transaction_id])).rows[0];assert.equal(Number(entry.n),17500);
  value(await admin.rpc('reverse_transaction',{p_transaction_id:first.transaction_id,p_reason:'Disposable certification reversal'}));
  assert.equal(Number((await db.query('select savings_balance from member_financials where id=$1',[a])).rows[0].savings_balance),before);
 });
 await test('finance summary equals underlying account ledger',async()=>{
  const api=value(await clients.accountant.rpc('treasury_summary'));
  const totals=(await db.query('select sum(balance) total from financial_account_balances')).rows[0];assert.equal(Number(api.totals.total),Number(totals.total));
  const rows=(await db.query('select b.id,b.balance,b.opening_balance+coalesce(sum(e.debit-e.credit),0) expected from financial_account_balances b left join account_ledger_entries e on e.account_id=b.id group by b.id,b.balance,b.opening_balance')).rows;
  for(const r of rows)assert.equal(Number(r.balance),Number(r.expected));
 });
 await test('native logout revokes refresh token',async()=>{
  const c=make(),session=value(await c.auth.signInWithPassword({email:users.viewer.email,password:users.viewer.password})).session;
  value(await c.auth.signOut());assert.ok((await make().auth.refreshSession({refresh_token:session.refresh_token})).error);
 });
 await test('native access-token expiry is enforced and refresh restores session',async()=>{
  const c=make(),session=value(await c.auth.signInWithPassword({email:users.viewer.email,password:users.viewer.password})).session;
  const pause=Math.max(0,session.expires_at*1000-Date.now()+32000);console.log(`Waiting ${Math.ceil(pause/1000)}s for native JWT expiry plus PostgREST's 30-second clock-skew allowance`);
  for(let left=pause;left>0;left-=31000){await new Promise(r=>setTimeout(r,Math.min(left,31000)));console.log('Native token expiry check progressing');}
  const expired=await fetch(`${s.api}/rest/v1/rpc/my_session`,{method:'POST',headers:{apikey:s.anon,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(expired.status,401);
  value(await c.auth.refreshSession({refresh_token:session.refresh_token}));assert.equal(value(await c.rpc('my_session')).role,'viewer');
 });
}finally{
 await db.end();await writeFile(`${root}/api-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));
 for(const c of Object.values(clients))c.auth.stopAutoRefresh();
}
console.log(`${results.filter(r=>r.pass).length} passed, ${results.filter(r=>!r.pass).length} failed`);
process.exitCode=results.some(r=>!r.pass)?1:0;
