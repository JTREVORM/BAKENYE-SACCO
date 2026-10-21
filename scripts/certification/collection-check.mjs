/** Savings collection through the real browser: every submission must end in a
 * stated outcome, and the ledger must hold exactly one row per submission.
 * Normal completion, slow answers, double clicks, lost answers, reloads and
 * rechecks. No retry replaces a failed attempt in this suite. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8')),results=[];
assert.equal(s.app,'http://localhost:3100');
const ACTORS=[['field_officer','/staff/savings/collect'],['cashier','/staff/desk'],['manager','/staff']];
const VIEWPORTS=[['mobile',{width:390,height:900}],['desktop',{width:1440,height:900}]];
const ATTEMPTS=Number(process.env.COLLECTION_ATTEMPTS||6);
const file=process.env.COLLECTION_RESULT_FILE||'collection-results.json';
const MEMBER=users.member_a.memberId;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
const save=()=>writeFile(`${root}/${file}`,JSON.stringify({date:new Date().toISOString(),results},null,2));
const record=(name,pass,extra={})=>{results.push({name,pass,...extra});console.log(`${pass?'PASS':'FAIL'} ${name}${extra.detail?`: ${extra.detail}`:''}`);};
/** Every ledger row this submission produced. Exactly one is the whole point. */
const rowsFor=async key=>(await db.query('select id,reference,amount,status from transactions where idempotency_key=$1',[key])).rows;
const savings=async()=>Number((await db.query('select savings_balance from member_financials where id=$1',[MEMBER])).rows[0].savings_balance);
const cashAccount=async()=>(await db.query("select id from financial_accounts where account_type='cash' and is_default")).rows[0].id;

const settled=async page=>{
 await page.getByRole('status').filter({hasText:/^Loading…$/}).first().waitFor({state:'hidden',timeout:30000}).catch(()=>{});
 await page.locator('.skeleton').first().waitFor({state:'hidden',timeout:30000}).catch(()=>{});
};
async function session(actor,home,viewport){
 const u=users[actor],c=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await c.newPage(),fonts=new Map();
 if(process.env.HTTPS_PROXY)await c.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{
  try{const url=route.request().url();if(!fonts.has(url))fonts.set(url,(async()=>{const r=await c.request.get(url);return{status:r.status(),headers:r.headers(),body:await r.body()};})());await route.fulfill(await fonts.get(url));}catch{await route.abort();}
 });
 await page.goto(s.app+'/login',{waitUntil:'networkidle'});
 await page.fill('input[name="identifier"]',u.email);
 await page.fill('input[name="password"]',u.password);
 await page.locator('button[type="submit"]').click();
 await page.waitForURL(url=>url.pathname===home,{timeout:30000});await page.waitForLoadState('networkidle');
 await page.getByRole('button',{name:'Not Now',exact:true}).click({timeout:4000}).catch(()=>{});
 await page.goto(`${s.app}/staff/savings/collect?q=Certification&member=${MEMBER}`,{waitUntil:'networkidle',timeout:60000});
 await settled(page);
 // The member panel streams in behind the search; the dialog trigger is in it.
 await page.getByRole('button',{name:'Record savings',exact:true}).first().waitFor({state:'visible',timeout:30000});
 return {c,page};
}
/** Fill the dialog and stop on the confirmation step, holding the key it will post. */
async function review(page,amount){
 await page.getByRole('button',{name:'Record savings',exact:true}).first().click();
 const dialog=page.getByRole('dialog',{name:'Record savings',exact:true});
 await dialog.getByLabel('Amount received').fill(String(amount));
 await dialog.locator('select[name="account_id"]').selectOption(await cashAccount());
 const key=await dialog.locator('input[name="idempotency_key"]').inputValue();
 await dialog.getByRole('button',{name:'Review',exact:true}).click();
 const confirm=page.getByRole('dialog',{name:'Confirm these savings'});
 await confirm.waitFor({state:'visible',timeout:20000});
 return {key,post:()=>confirm.getByRole('button',{name:'Record savings',exact:true}).click()};
}
const done=page=>page.getByRole('dialog',{name:'Savings recorded',exact:true});
const unresolved=page=>page.getByRole('dialog',{name:'Savings not confirmed',exact:true});
/** The outcome the screen is actually stating. Never "nothing". */
async function outcome(page,timeout=30000){
 const deadline=Date.now()+timeout;
 for(;;){
  if(await done(page).isVisible().catch(()=>false))return 'recorded';
  if(await unresolved(page).isVisible().catch(()=>false))return 'unresolved';
  if(await page.getByText('Payment not recorded').isVisible().catch(()=>false))return 'refused';
  if(Date.now()>deadline)return 'silent';
  await page.waitForTimeout(250);
 }
}
try{
 /* The ordinary path, repeated across roles and both viewports. */
 for(const [actor,home] of ACTORS)for(const [label,viewport] of VIEWPORTS)for(let attempt=1;attempt<=ATTEMPTS;attempt++){
  const name=`${actor} ${label}: collection ${attempt}/${ATTEMPTS} is recorded, confirmed and receipted`;
  let ctx,key;
  try{
   ctx=await session(actor,home,viewport);
   const before=await savings(),amount=1000+attempt;
   const r=await review(ctx.page,amount);key=r.key;
   await r.post();
   assert.equal(await outcome(ctx.page),'recorded','the screen did not confirm a posted collection');
   const rows=await rowsFor(key);
   assert.equal(rows.length,1,`${rows.length} ledger rows for one submission`);
   assert.equal(Number(rows[0].amount),amount);
   const shown=await done(ctx.page).innerText();
   assert.ok(shown.includes(rows[0].reference),'the reference on screen is not the ledger reference');
   await done(ctx.page).getByRole('link',{name:'View receipt',exact:true}).waitFor({state:'visible'});
   assert.equal(await savings(),before+amount,'the member balance did not move by the amount recorded');
   record(name,true,{reference:rows[0].reference});
  }catch(e){record(name,false,{detail:e.message.slice(0,300),ledgerRows:key?(await rowsFor(key)).length:null});}
  finally{await ctx?.c.close();await save();}
 }
 /* Everything that can go wrong on the way back, on a phone and on a desktop. */
 for(const [label,viewport] of VIEWPORTS){
  const cases=[
   ['a slow answer still confirms, and the control stays busy until it does',async(page)=>{
    await page.route(u=>u.pathname.startsWith('/staff/savings/collect'),async route=>{
     if(route.request().method()!=='POST')return route.continue();
     await new Promise(r=>setTimeout(r,4000));return route.continue();
    });
    const before=await savings(),r=await review(page,1301);
    await r.post();
    await page.waitForTimeout(1200);
    const busy=page.getByRole('button',{name:'Recording…',exact:true});
    assert.equal(await busy.count(),1,'the control did not show it was working');
    assert.equal(await busy.isDisabled(),true,'the control stayed pressable while working');
    assert.equal(await outcome(page),'recorded');
    const rows=await rowsFor(r.key);
    assert.equal(rows.length,1,`${rows.length} ledger rows for one submission`);
    assert.equal(await savings(),before+1301);
   }],
   ['three clicks during one slow request post one row',async(page)=>{
    let posts=0;
    await page.route(u=>u.pathname.startsWith('/staff/savings/collect'),async route=>{
     if(route.request().method()!=='POST')return route.continue();
     posts+=1;await new Promise(r=>setTimeout(r,3000));return route.continue();
    });
    const before=await savings(),r=await review(page,1302);
    await r.post();
    await page.waitForTimeout(400);
    const form=page.locator('form:has(input[name="idempotency_key"])');
    // Submitted directly: the control is already disabled, so this is what
    // tests the guard rather than the disabled attribute.
    for(let i=0;i<2;i++){await form.first().evaluate(f=>f.requestSubmit()).catch(()=>{});await page.waitForTimeout(200);}
    assert.equal(await outcome(page),'recorded');
    assert.equal(posts,1,`the collection was posted ${posts} times`);
    const rows=await rowsFor(r.key);
    assert.equal(rows.length,1,`${rows.length} ledger rows for one submission`);
    assert.equal(await savings(),before+1302);
   }],
   ['a lost answer is never called a failure, and the recheck finds the posting',async(page)=>{
    // The request reaches the server and posts; only the answer is thrown away.
    let drop=true;
    await page.route(u=>u.pathname.startsWith('/staff/savings/collect'),async route=>{
     if(route.request().method()!=='POST')return route.continue();
     if(!drop)return route.continue();
     drop=false;await route.fetch();return route.abort('connectionreset');
    });
    const before=await savings(),r=await review(page,1303);
    await r.post();
    assert.equal(await outcome(page),'unresolved','a lost answer was not reported as unresolved');
    const panel=await unresolved(page).innerText();
    assert.doesNotMatch(panel,/failed|not recorded|try again/i,'the screen guessed that it had failed');
    let rows=await rowsFor(r.key);
    assert.equal(rows.length,1,'the posting that happened is not in the ledger');
    // The recheck re-sends the same submission; the database answers with the
    // row it already made.
    await unresolved(page).getByRole('button',{name:'Check the result',exact:true}).click();
    assert.equal(await outcome(page),'recorded','the recheck did not report the posting');
    rows=await rowsFor(r.key);
    assert.equal(rows.length,1,`${rows.length} ledger rows after the recheck`);
    assert.equal(await savings(),before+1303,'the recheck moved the balance a second time');
   }],
   ['a lost answer for a request that never arrived records it once on recheck',async(page)=>{
    let drop=true;
    await page.route(u=>u.pathname.startsWith('/staff/savings/collect'),async route=>{
     if(route.request().method()!=='POST')return route.continue();
     if(!drop)return route.continue();
     drop=false;return route.abort('connectionreset');
    });
    const before=await savings(),r=await review(page,1304);
    await r.post();
    assert.equal(await outcome(page),'unresolved');
    assert.equal((await rowsFor(r.key)).length,0,'a request that never arrived still posted');
    await unresolved(page).getByRole('button',{name:'Check the result',exact:true}).click();
    assert.equal(await outcome(page),'recorded');
    const rows=await rowsFor(r.key);
    assert.equal(rows.length,1,`${rows.length} ledger rows for one submission`);
    assert.equal(await savings(),before+1304);
   }],
   ['a refusal states the reason and posts nothing',async(page)=>{
    const before=await savings();
    // A future payment date is refused by the posting function itself.
    await page.getByRole('button',{name:'Record savings',exact:true}).first().click();
    const dialog=page.getByRole('dialog',{name:'Record savings',exact:true});
    await dialog.getByLabel('Amount received').fill('1305');
    await dialog.locator('select[name="account_id"]').selectOption(await cashAccount());
    const key=await dialog.locator('input[name="idempotency_key"]').inputValue();
    await dialog.locator('input[name="paid_on"]').evaluate(el=>{
     const d=new Date();d.setDate(d.getDate()+5);
     const v=d.toISOString().slice(0,10);
     const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
     setter.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await dialog.getByRole('button',{name:'Review',exact:true}).click();
    const shown=await page.locator('body').innerText();
    assert.match(shown,/cannot be dated in the future/i,'a future-dated payment was not refused');
    assert.equal((await rowsFor(key)).length,0);
    assert.equal(await savings(),before,'a refused payment moved the balance');
   }],
   ['reloading after a confirmed collection does not post it again',async(page)=>{
    const before=await savings(),r=await review(page,1306);
    await r.post();
    assert.equal(await outcome(page),'recorded');
    await page.reload({waitUntil:'networkidle'});
    await page.waitForTimeout(1500);
    const rows=await rowsFor(r.key);
    assert.equal(rows.length,1,`${rows.length} ledger rows after a reload`);
    assert.equal(await savings(),before+1306);
   }],
  ];
  for(const [title,run] of cases){
   const name=`field_officer ${label}: ${title}`;
   let ctx;
   try{ctx=await session('field_officer','/staff/savings/collect',viewport);await run(ctx.page);record(name,true);}
   catch(e){record(name,false,{detail:e.message.slice(0,300)});}
   finally{await ctx?.c.close();await save();}
  }
 }
}finally{await browser.close();await db.end();await save();}
const silent=results.filter(r=>!r.pass&&/silent/.test(r.detail??'')).length;
console.log(`${results.filter(r=>r.pass).length}/${results.length} collection checks pass${silent?`; ${silent} ended with no outcome on screen`:''}`);
process.exitCode=results.some(r=>!r.pass)?1:0;
