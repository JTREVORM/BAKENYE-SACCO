/** Authenticated browser regression against a guarded disposable stack only. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {createClient} from '@supabase/supabase-js';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8'));
assert.equal(s.app,'http://localhost:3100');
const results=[],out=`${root}/screenshots`;
const selected=process.argv.slice(2).find(v=>!v.startsWith('--'))?.split(',')??[];
const logoutOnly=process.argv.includes('--logout-only');
const sessionsOnly=process.argv.includes('--sessions-only');
const coreOnly=process.argv.includes('--core-only')||sessionsOnly;
assert.ok(selected.every(k=>/^[a-z_]+$/.test(k)),'Role filter contains only role identifiers');
const resultFile=`${root}/browser${sessionsOnly?'-sessions':coreOnly?'-core':logoutOnly?`-logout${selected.length?`-${selected.join('-')}`:''}`:selected.length?`-${selected.join('-')}`:''}-results.json`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log(`PASS ${name}`);}catch(e){results.push({name,pass:false,detail:e.message});console.log(`FAIL ${name}: ${e.message}`);}await writeFile(resultFile,JSON.stringify({date:new Date().toISOString(),results},null,2));}
async function context(width=1440){
 const c=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),fonts=new Map();
 if(process.env.HTTPS_PROXY)await c.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{
  try{const url=route.request().url();if(!fonts.has(url))fonts.set(url,(async()=>{const r=await c.request.get(url);return{status:r.status(),headers:r.headers(),body:await r.body()};})());await route.fulfill(await fonts.get(url));}catch{await route.abort();}
 });
 return c;
}
async function login(page,key,password=users[key].password,next=''){
 await page.goto(`${s.app}/login${next}`,{waitUntil:'networkidle'});
 await page.fill('input[name="identifier"]',users[key].memberNo||users[key].email);
 await page.fill('input[name="password"]',password);
 await page.locator('button[type="submit"]').click();
 // Next's route announcer also has role=alert; only the form's actual error
 // may complete a refused sign-in. Do not race navigation against it.
 await Promise.race([page.waitForURL(u=>u.pathname!=='/login',{timeout:30000}),page.locator('form [role="alert"]').waitFor({state:'visible',timeout:30000})]);
 await page.waitForLoadState('networkidle');
 if(new URL(page.url()).pathname!=='/login'&&new URL(page.url()).pathname!=='/change-password')await page.getByRole('button',{name:'Not Now',exact:true}).click({timeout:4000}).catch(()=>{});
 return new URL(page.url()).pathname;
}
async function logout(page){
 await settled(page);
 await page.getByRole('button',{name:'Not Now',exact:true}).click({timeout:2000}).catch(()=>{});
 const menu=page.getByRole('button',{name:'Account menu',exact:true});
 if(await menu.count()){await menu.click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();}
 else{await load(page,'/more');await page.locator('form[action="/auth/signout"] button[type="submit"]:visible').first().click();}
 await page.waitForURL(u=>u.pathname==='/login');await page.waitForLoadState('networkidle');
}
async function settled(page){await page.getByRole('status').filter({hasText:/^Loading…$/}).first().waitFor({state:'hidden'});await page.locator('.skeleton').first().waitFor({state:'hidden'});}
async function load(page,path){const response=await page.goto(s.app+path,{waitUntil:'networkidle',timeout:60000});await settled(page);assert.ok(response.status()<400,`HTTP ${response.status()} ${path}`);assert.doesNotMatch(await page.locator('body').innerText(),/Application error|Unhandled Runtime Error|Unable to load|Something went wrong/i);}
const homes={super_admin:'/staff/admin',admin:'/staff/admin',manager:'/staff',loan_officer:'/staff/loans-desk',cashier:'/staff/desk',accountant:'/staff/finance',field_officer:'/staff/savings/collect',viewer:'/staff',member_a:'/',member_b:'/'};
assert.ok(selected.every(key=>key in homes),'Every filtered role must have an existing fixture');
const guarded=[['/staff/users','users.manage'],['/staff/roles','roles.manage'],['/staff/settings','settings.view'],['/staff/audit','audit.view'],['/staff/finance','finance.view'],['/staff/members','members.view'],['/staff/loans-desk','loans.view'],['/staff/savings/collect','savings.view'],['/staff/reports','reports.view'],['/staff/transactions','transactions.view']];
try{
 if(!selected.length&&!logoutOnly&&!sessionsOnly){
 await test('Collections: real mobile review, post and receipt match the database',async()=>{
  const ctx=await context(390),page=await ctx.newPage();try{
   const mid=users.member_a.memberId,before=Number((await db.query('select savings_balance from member_financials where id=$1',[mid])).rows[0].savings_balance);
   await login(page,'field_officer');await load(page,`/staff/savings/collect?q=Certification&member=${mid}`);
   await page.getByRole('button',{name:'Record savings',exact:true}).first().click();
   const dialog=page.getByRole('dialog',{name:'Record savings',exact:true});await dialog.getByLabel('Amount received').fill('11250');
   const cash=(await db.query("select id from financial_accounts where account_type='cash' and is_default")).rows[0].id;
   await dialog.locator('select[name="account_id"]').selectOption(cash);const key=await dialog.locator('input[name="idempotency_key"]').inputValue();
   await dialog.getByRole('button',{name:'Review',exact:true}).click();
   await page.getByRole('dialog',{name:'Confirm these savings'}).getByRole('button',{name:'Record savings',exact:true}).click();
   const done=page.getByRole('dialog',{name:'Savings recorded',exact:true});await done.waitFor({state:'visible',timeout:30000});
   const tx=(await db.query('select id from transactions where idempotency_key=$1',[key])).rows[0];assert.ok(tx);
   assert.equal(Number((await db.query('select savings_balance from member_financials where id=$1',[mid])).rows[0].savings_balance),before+11250);
   assert.equal((await db.query('select count(*) n from receipts where transaction_id=$1',[tx.id])).rows[0].n,'1');
   await done.getByRole('link',{name:'View receipt',exact:true}).click();await page.waitForURL(`**/staff/transactions/${tx.id}`);await page.waitForLoadState('networkidle');await settled(page);assert.match(await page.locator('body').innerText(),/11,250/);
  }finally{await ctx.close();}
 });
 await test('Manager: real browser expense approval posts the pending entry once',async()=>{
  const cashier=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await cashier.auth.signInWithPassword({email:users.cashier.email,password:users.cashier.password});assert.equal(auth.error,null);
  const cash=(await db.query("select id from financial_accounts where account_type='cash' and is_default")).rows[0].id;
  const category=(await db.query("select id from expense_categories where is_active and lower(name)<>'other' order by name limit 1")).rows[0].id;
  const description=`Disposable browser approval ${Date.now()}`;
  const r=await cashier.rpc('record_expense',{p_category_id:category,p_amount:2500,p_description:description,p_payment_account_id:cash,p_method:'cash',p_idempotency_key:description});assert.equal(r.error,null);
  const before=Number((await db.query('select balance from financial_account_balances where id=$1',[cash])).rows[0].balance);
  const ctx=await context(),page=await ctx.newPage();try{
   await login(page,'manager');await load(page,'/staff/finance/expenses?status=submitted');
   const row=page.locator('li').filter({hasText:description});assert.equal(await row.count(),1);
   await row.getByRole('button',{name:'Approve',exact:true}).click();await row.getByRole('button',{name:'Approve UGX 2,500',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('button:disabled[type="submit"]'));await page.waitForTimeout(500);
   const entry=(await db.query('select approval,transaction_id from expense_entries where id=$1',[r.data.expense_id])).rows[0];assert.equal(entry.approval,'approved');assert.ok(entry.transaction_id);
   assert.equal(Number((await db.query('select balance from financial_account_balances where id=$1',[cash])).rows[0].balance),before-2500);
  }finally{await ctx.close();}
 });
 }
 for(const [key,home]of Object.entries(homes).filter(([key])=>!coreOnly&&(!selected.length||selected.includes(key)))){
  const ctx=await context(),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const client=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await client.auth.signInWithPassword({email:users[key].email,password:users[key].password});if(signed.error)throw signed.error;
  const session=(await client.rpc('my_session')).data;
  await test(`${key}: real form login lands on assigned dashboard`,async()=>assert.equal(await login(page,key),home));
  if(!logoutOnly){
  for(const width of [1440,390,320])await test(`${key}: authenticated ${width}px dashboard and keyboard drawer`,async()=>{
   await page.setViewportSize({width,height:900});await load(page,home);
   if(key==='field_officer')await load(page,`${home}?q=Certification&member=${users.member_a.memberId}`);
   assert.equal(new URL(page.url()).pathname,home);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   if(key.startsWith('member_')){
    const m=(await db.query('select savings_balance,share_value,loan_balance from member_financials where id=$1',[users[key].memberId])).rows[0];
    const cards=await page.locator('[data-member-balance]').allTextContents();
    for(const [i,field]of ['savings_balance','share_value','loan_balance'].entries())assert.ok(cards[i].replace(/\s/g,'').includes(`UGX${Number(m[field]).toLocaleString('en-UG')}`),`${field} visible amount matches database`);
    assert.ok(!(await page.locator('body').innerText()).includes(users[key==='member_a'?'member_b':'member_a'].memberNo));
   }
   if(session.permissions.includes('finance.view')&&home!=='/staff/finance'&&home!=='/staff/savings/collect'&&home!=='/staff/loans-desk'){
    const total=Number((await db.query('select sum(balance) total from financial_account_balances')).rows[0].total);
    assert.ok((await page.getByRole('region',{name:'SACCO funds'}).innerText()).replace(/\s/g,'').includes(`UGX${total.toLocaleString('en-UG')}`),'Visible staff funds match database');
   }
   await page.screenshot({path:`${out}/${key}-${width}.jpg`,type:'jpeg',quality:72,fullPage:true});
   if(width<768){
    const trigger=page.getByRole('button',{name:'Open menu',exact:true});await trigger.focus();await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Navigation'});assert.ok(await dialog.isVisible());
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(e=>e.contains(document.activeElement)));}
    await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.ok(await trigger.evaluate(e=>e===document.activeElement));
   }
   assert.deepEqual(errors,[]);
  });
  await page.setViewportSize({width:1440,height:900});
  for(const [path,permission]of guarded)await test(`${key}: direct ${path} follows ${permission}`,async()=>{
   await load(page,path);const expected=session.permissions.includes(permission)?path:home;
   assert.equal(new URL(page.url()).pathname,expected);
  });
  if(key==='super_admin'){
   for(const path of ['/dev/preview','/dev/preview/dashboard','/dev/preview/member','/dev/preview/certification','/dev/preview/staff/finance'])await test(`production preview ${path}: authenticated request reaches Not Found without fixtures`,async()=>{
    const r=await page.goto(s.app+path,{waitUntil:'networkidle'});await settled(page);assert.ok([200,404].includes(r.status()));
    // Next streams the global loading boundary with HTTP 200 before notFound.
    assert.ok(await page.getByRole('heading',{name:'We could not find that page',exact:true}).isVisible());
    assert.doesNotMatch(await page.locator('body').innerText(),/Nakabugo Christine|SAV260830004|MP2609\.4471/);
   });
   await test('Super Admin: Overview / Administration navigation and financial range filter',async()=>{
    await load(page,'/staff');assert.ok(await page.locator('[data-overview-dashboard]').count());
    await load(page,'/staff/admin');assert.ok(await page.locator('[data-admin-dashboard]').count());
    await page.locator('details').filter({has:page.locator('a[href="/staff/admin?flow=12"]')}).locator('summary').click();
    await page.getByRole('link',{name:'12 months',exact:true}).click();await page.waitForFunction(()=>new URL(location.href).searchParams.get('flow')==='12');await settled(page);assert.equal(new URL(page.url()).searchParams.get('flow'),'12');
   });
   // Follow every configured first-level navigation destination in a real session.
   const links=[...new Set(await page.locator('aside a[href^="/staff"]').evaluateAll(es=>es.map(e=>e.getAttribute('href'))))];
   for(const href of links)await test(`Super Admin: navigation ${href}`,async()=>load(page,href));
  }
  if(key.startsWith('member_')){
   for(const path of ['/profile','/savings','/shares','/loans','/transactions','/statements','/reports','/guarantees','/notifications','/more'])await test(`${key}: authorized portal ${path}`,async()=>{await load(page,path);assert.equal(new URL(page.url()).pathname,path);});
   await test(`${key}: peer transaction direct URL denied`,async()=>{
    const peer=users[key==='member_a'?'member_b':'member_a'].memberId;
    const tx=(await db.query('select id from transactions where member_id=$1 limit 1',[peer])).rows[0];
    const r=await page.goto(`${s.app}/transactions/${tx.id}`,{waitUntil:'networkidle'});await settled(page);
    const body=await page.locator('body').innerText();assert.ok(r.status()===404||new URL(page.url()).pathname==='/'||/not found|could not find|not available|cannot|no access/i.test(body));
   });
  }
  }
  await test(`${key}: logout / Back / direct revisit clears access`,async()=>{await load(page,home);await logout(page);await page.goBack({waitUntil:'networkidle'});await page.waitForURL(u=>u.pathname==='/login');await page.reload({waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/login');await page.goto(s.app+home,{waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/login');});
  await ctx.close();
 }
 if(!selected.length&&!logoutOnly){
 await test('member notifications persist read state without changing peer notifications',async()=>{
  const ids=[];for(const key of ['member_a','member_b'])ids.push((await db.query("insert into notifications(user_id,title,body) values($1,$2,'Synthetic certification notification') returning id",[users[key].id,`Certification ${key} private notice`])).rows[0].id);
  const ctx=await context(390),page=await ctx.newPage();
  try{
   await login(page,'member_a');await load(page,'/notifications');assert.ok((await page.locator('body').innerText()).includes('Certification member_a private notice'));assert.ok(!(await page.locator('body').innerText()).includes('Certification member_b private notice'));
   await page.getByRole('button',{name:'Mark all read'}).click();await page.getByRole('button',{name:'Mark all read'}).waitFor({state:'hidden'});
   const rows=(await db.query('select id,read_at from notifications where id=any($1::uuid[])',[ids])).rows;
   assert.ok(rows.find(r=>r.id===ids[0]).read_at);assert.equal(rows.find(r=>r.id===ids[1]).read_at,null);
  }finally{await ctx.close();}
 });
 await test('inactive and suspended accounts refused by actual login form',async()=>{
  const ctx=await context(),page=await ctx.newPage();
  try{
   assert.equal(await login(page,'inactive'),'/login');
   await db.query("update members set status='suspended' where id=$1",[users.member_b.memberId]);
   assert.equal(await login(page,'member_b'),'/login');assert.match(await page.locator('body').innerText(),/suspended/i);
  }finally{await db.query("update members set status='active' where id=$1",[users.member_b.memberId]);await ctx.close();}
 });
 await test('idle timeout redirects and clears real session cookies',async()=>{
  const ctx=await context(),page=await ctx.newPage();try{
   await login(page,'viewer');await ctx.addCookies([{name:'bnd_idle_min',value:'1',url:s.app,httpOnly:true},{name:'bnd_last_seen',value:String(Date.now()-120000),url:s.app,httpOnly:true}]);
   await page.goto(s.app+'/staff',{waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/login');assert.equal(new URL(page.url()).searchParams.get('reason'),'timeout');
   await page.goto(s.app+'/staff',{waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/login');
  }finally{await ctx.close();}
 });
 await test('temporary password: redirects, required form change, old password rejected',async()=>{
  const ctx=await context(390),page=await ctx.newPage();try{
   assert.equal(await login(page,'temporary'),'/change-password');
   await page.goto(s.app+'/staff/desk',{waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/change-password');
   const previous=users.temporary.password,next=`Chosen!${randomBytes(12).toString('hex')}7z`;
   await page.fill('input[name="current_password"]',users.temporary.password);await page.fill('input[name="password"]',next);await page.fill('input[name="confirm"]',next);
   await page.getByRole('button',{name:'Save password and continue'}).click();await page.waitForURL('**/staff/desk');await page.waitForLoadState('networkidle');
   users.temporary.password=next;await writeFile(`${root}/accounts.json`,JSON.stringify(users,null,2),{mode:0o600});
   await logout(page);assert.equal(await login(page,'temporary',previous),'/login');
   assert.equal(await login(page,'temporary'),'/staff/desk');
  }finally{await ctx.close();}
 });
 }
}finally{
 await browser.close();await db.end();await writeFile(resultFile,JSON.stringify({date:new Date().toISOString(),results},null,2));
}
console.log(`${results.filter(r=>r.pass).length} passed, ${results.filter(r=>!r.pass).length} failed`);process.exitCode=results.some(r=>!r.pass)?1:0;
