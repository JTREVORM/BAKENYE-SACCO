/** Run after other browser tests: deliberately lock one disposable identifier. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8')),results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log(`PASS ${name}`);}catch(e){results.push({name,pass:false,detail:e.message});console.log(`FAIL ${name}: ${e.message}`);}}
const c=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});
const signed=await c.auth.signInWithPassword({email:users.member_b.email,password:users.member_b.password});assert.equal(signed.error,null);
try{
 await test('anonymous API cannot read member or financial records',async()=>{
  const anon=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const table of ['members','member_financials','transactions','account_ledger_entries','receipts']){const r=await anon.from(table).select('*');assert.ok(r.error||r.data.length===0);}
  assert.ok((await anon.auth.admin.listUsers()).error);
 });
 for(const key of ['super_admin','admin','manager','loan_officer','cashier','accountant','field_officer','viewer'])await test(`${key}: direct finance API follows authoritative permission`,async()=>{
  const actor=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});
  assert.equal((await actor.auth.signInWithPassword({email:users[key].email,password:users[key].password})).error,null);
  const session=await actor.rpc('my_session');assert.equal(session.error,null);
  const ledger=await actor.from('account_ledger_entries').select('id');
  if(session.data.permissions.includes('finance.view')){assert.equal(ledger.error,null);assert.ok(ledger.data.length>0);}
  else assert.ok(ledger.error||ledger.data.length===0);
 });
 for(const status of ['suspended','inactive','archived','exited'])await test(`existing-token member restriction: ${status}`,async()=>{
  try{
   await db.query('update members set status=$1 where id=$2',[status,users.member_b.memberId]);
   const identity=await c.rpc('current_member_id');assert.equal(identity.error,null);assert.equal(identity.data,null);
   const financials=await c.from('member_financials').select('*');assert.equal(financials.error,null);assert.equal(financials.data.length,0);
  }finally{await db.query("update members set status='active' where id=$1",[users.member_b.memberId]);}
 });
 await test('real login form: generic credentials errors and configured lockout',async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
  try{
   const page=await browser.newPage();
   const submit=async(identifier,password)=>{
    await page.goto(s.app+'/login',{waitUntil:'networkidle'});await page.fill('input[name="identifier"]',identifier);await page.fill('input[name="password"]',password);await page.locator('button[type="submit"]').click();
    const error=page.locator('form [role="alert"]').first();await error.waitFor({state:'visible'});assert.equal(new URL(page.url()).pathname,'/login');return error.innerText();
   };
   const unknown=await submit('BND99998','Wrong!Disposable123');const wrong=await submit(users.member_b.memberNo,'Wrong!Disposable123');assert.equal(unknown,wrong);assert.match(wrong,/Invalid login credentials/i);
   const max=Number((await db.query("select value from system_settings where key='security.login_max_attempts'")).rows[0].value);assert.ok(max>0&&max<=20,'bounded fixture lockout setting');
   for(let i=1;i<max;i++)await submit(users.member_b.memberNo,'Wrong!Disposable123');
   const locked=await submit(users.member_b.memberNo,users.member_b.password);assert.match(locked,/paused|too many|try again/i);
  }finally{await browser.close();}
 });
}finally{await db.end();await writeFile(`${root}/restrictions-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));}
console.log(`${results.filter(r=>r.pass).length} passed, ${results.filter(r=>!r.pass).length} failed`);process.exitCode=results.some(r=>!r.pass)?1:0;
