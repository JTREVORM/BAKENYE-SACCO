/** Compare real dashboard RPCs to the disposable member/account registers. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8')),results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log(`PASS ${name}`);}catch(e){results.push({name,pass:false,detail:e.message});console.log(`FAIL ${name}: ${e.message}`);}}
async function actor(key){const c=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});const r=await c.auth.signInWithPassword({email:users[key].email,password:users[key].password});assert.equal(r.error,null);return c;}
const val=r=>{assert.equal(r.error,null);return r.data;};
try{
 const expected=(await db.query("select count(*) filter(where status='active') total_members,coalesce(sum(savings_balance),0) total_savings,coalesce(sum(share_value),0) share_capital,coalesce(sum(shares_owned),0) shares_issued,coalesce(sum(loan_balance),0) outstanding_loans,coalesce(sum(savings_this_month),0) savings_this_month,count(*) filter(where savings_this_month>0) savers_this_month from member_financials")).rows[0];
 for(const key of ['super_admin','admin','manager','loan_officer','cashier','accountant','field_officer','viewer'])await test(`${key}: seven dashboard metrics reconcile with member registers`,async()=>{
  const c=await actor(key),m=val(await c.rpc('dashboard_metrics'));for(const field of Object.keys(expected))assert.equal(Number(m[field]),Number(expected[field]),field);
 });
 await test('Administration: active staff, member logins and temporary-password counts equal account records',async()=>{
  const c=await actor('super_admin'),m=val(await c.rpc('security_overview'));
  const expected=(await db.query("select count(*) filter(where r.kind='staff' and u.is_active) staff_accounts,count(*) filter(where r.kind='member' and u.is_active) member_logins,count(*) filter(where u.is_active and u.must_change_password) must_change from app_users u join roles r on r.key=u.role")).rows[0];
  for(const key of Object.keys(expected))assert.equal(Number(m[key]),Number(expected[key]),key);
 });
 await test('Collections: selected member savings and shares equal authorized member records',async()=>{
  const c=await actor('field_officer');
  for(const key of ['member_a','member_b']){
   const actual=val(await c.rpc('member_collection_view',{p_member_id:users[key].memberId}));
   const expected=(await db.query('select savings_balance,share_value,shares_owned,savings_this_month from member_financials where id=$1',[users[key].memberId])).rows[0];
   for(const field of Object.keys(expected))assert.equal(Number(actual.member[field]),Number(expected[field]),field);
  }
 });
 await test('Finance: total and account-type dashboard balances equal account ledger registers',async()=>{
  const c=await actor('accountant'),actual=val(await c.rpc('treasury_summary'));
  const rows=(await db.query('select account_type,sum(balance) balance from financial_account_balances group by account_type')).rows;
  for(const row of rows)assert.equal(Number(actual.totals[row.account_type]),Number(row.balance));
  assert.equal(Number(actual.totals.total),rows.reduce((n,r)=>n+Number(r.balance),0));
 });
}finally{await db.end();await writeFile(`${root}/metrics-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));}
console.log(`${results.filter(r=>r.pass).length} passed, ${results.filter(r=>!r.pass).length} failed`);process.exitCode=results.some(r=>!r.pass)?1:0;
