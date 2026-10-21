/** The signed-in change-password form, through the real browser against the
 * disposable stack: repeated refusals must always say so, every other outcome
 * must be reported accurately, and nothing may change on a refused attempt.
 * No retry replaces a failed attempt in this suite. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createClient} from '@supabase/supabase-js';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8')),results=[];
assert.equal(s.app,'http://localhost:3100');
// Four staff roles and a member, each on a phone and on a desktop. member_b is
// never signed in here, so this suite does not depend on the lockout suite.
const ACTORS=[['viewer','/staff','/staff/profile'],['accountant','/staff/finance','/staff/profile'],['manager','/staff','/staff/profile'],['cashier','/staff/desk','/staff/profile'],['member_a','/','/profile']];
const VIEWPORTS=[['mobile',{width:390,height:900}],['desktop',{width:1440,height:900}]];
const ATTEMPTS=Number(process.env.PASSWORD_FORM_ATTEMPTS||5);
const file=process.env.PASSWORD_FORM_RESULT_FILE||'password-form-results.json';
const WRONG='Incorrect!7password';
const strong=()=>`Chosen!${randomBytes(12).toString('hex')}7z`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
const save=()=>writeFile(`${root}/${file}`,JSON.stringify({date:new Date().toISOString(),results},null,2));
const record=(name,pass,extra={})=>{results.push({name,pass,...extra});console.log(`${pass?'PASS':'FAIL'} ${name}${extra.detail?`: ${extra.detail}`:''}`);};
const audits=async id=>(await db.query("select count(*) n from audit_logs where actor_id=$1 and action='auth.password_changed'",[id])).rows[0].n;
/** The account row the form must never touch. */
const account=async id=>(await db.query('select role,is_active,must_change_password from app_users where id=$1',[id])).rows[0];
const signsIn=async(key,password)=>{
 const c=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});
 return !(await c.auth.signInWithPassword({email:users[key].email,password})).error;
};
/** The form's own submit control, whatever its label reads at the time. */
const control=page=>page.locator('form:has(input#current_password) button[type="submit"]');
async function session(actor,home,path,viewport){
 const u=users[actor],c=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await c.newPage(),fonts=new Map();
 if(process.env.HTTPS_PROXY)await c.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{
  try{const url=route.request().url();if(!fonts.has(url))fonts.set(url,(async()=>{const r=await c.request.get(url);return{status:r.status(),headers:r.headers(),body:await r.body()};})());await route.fulfill(await fonts.get(url));}catch{await route.abort();}
 });
 await page.goto(s.app+'/login',{waitUntil:'networkidle'});
 await page.fill('input[name="identifier"]',u.memberNo||u.email);
 await page.fill('input[name="password"]',u.password);
 await page.locator('button[type="submit"]').click();
 await page.waitForURL(url=>url.pathname===home,{timeout:30000});await page.waitForLoadState('networkidle');
 await page.getByRole('button',{name:'Not Now',exact:true}).click({timeout:4000}).catch(()=>{});
 await page.goto(s.app+path,{waitUntil:'networkidle',timeout:60000});
 await page.locator('.skeleton').first().waitFor({state:'hidden'}).catch(()=>{});
 return {c,page,user:u,
  submit:async(current,next,confirm=next)=>{
   await page.fill('input[name="current_password"]',current);
   await page.fill('input[name="password"]',next);
   await page.fill('input[name="confirm"]',confirm);
   await control(page).click();
  }};
}
/** The message shown under one field, with the field marked invalid. */
async function fieldError(page,id){
 const field=page.locator(`div:has(> input#${id})`).first();
 const error=field.locator('p.text-error').first();
 await error.waitFor({state:'visible',timeout:20000});
 // The error paragraph starts with an aria-hidden Material icon whose ligature
 // text is "error"; the message is what follows it.
 const text=(await error.textContent()??'').replace(/^\s*error/,'').trim();
 return {text,invalid:await page.locator(`input#${id}`).getAttribute('aria-invalid')};
}
/** The control must be usable again once the request has settled. */
async function settledControl(page){
 const button=control(page);
 await button.waitFor({state:'visible',timeout:20000});
 await page.getByRole('button',{name:'Change password',exact:true}).waitFor({state:'visible',timeout:20000});
 assert.equal(await button.getAttribute('aria-busy'),null,'the control stayed busy after the request settled');
 assert.equal(await button.isEnabled(),true,'the control stayed disabled after the request settled');
}
try{
 /* A refused password must always say so, and change nothing. */
 for(const [actor,home,path] of ACTORS)for(const [label,viewport] of VIEWPORTS)for(let attempt=1;attempt<=ATTEMPTS;attempt++){
  const name=`${actor} ${label}: wrong current password ${attempt}/${ATTEMPTS} is reported on the field`;
  let ctx;
  try{
   ctx=await session(actor,home,path,viewport);
   const before=await audits(ctx.user.id),account0=await account(ctx.user.id),rejected=strong();
   await ctx.submit(WRONG,rejected);
   const shown=await fieldError(ctx.page,'current_password');
   assert.equal(shown.text,'Your current password is incorrect.');
   assert.equal(shown.invalid,'true','the current-password field was not marked invalid');
   await settledControl(ctx.page);
   assert.equal(await audits(ctx.user.id),before,'a refused attempt wrote a password audit');
   assert.deepEqual(await account(ctx.user.id),account0,'a refused attempt changed the account row');
   assert.equal(await signsIn(actor,rejected),false,'the refused new password was accepted');
   assert.equal(await signsIn(actor,ctx.user.password),true,'the existing password stopped working');
   record(name,true);
  }catch(e){record(name,false,{detail:e.message.slice(0,300)});}
  finally{await ctx?.c.close();await save();}
 }
 /* Each remaining outcome, on a staff page and on a member page. */
 for(const [actor,home,path] of [ACTORS[0],ACTORS[4]]){
  const cases=[
   ['the two passwords do not match',async ctx=>{
    await ctx.submit(ctx.user.password,strong(),strong());
    const shown=await fieldError(ctx.page,'confirm_password');
    assert.equal(shown.text,'The two passwords do not match.');
    assert.equal(shown.invalid,'true');
   }],
   ['a new password below the policy is refused',async ctx=>{
    await ctx.submit(ctx.user.password,'short');
    const shown=await fieldError(ctx.page,'new_password');
    assert.match(shown.text,/at least|letter|number/i);
    assert.equal(shown.invalid,'true');
   }],
   ['reusing the current password is refused',async ctx=>{
    await ctx.submit(ctx.user.password,ctx.user.password);
    const shown=await fieldError(ctx.page,'new_password');
    assert.equal(shown.text,'Choose a password different from your current one.');
   }],
   ['an expired session is reported, not silently ignored',async ctx=>{
    await ctx.c.clearCookies();
    await ctx.submit(WRONG,strong());
    const alert=ctx.page.getByRole('alert').filter({hasText:/\S/}).first();
    await alert.waitFor({timeout:20000});
    assert.match((await alert.textContent()??'').trim(),/session has expired/i);
   }],
   ['a dropped request is reported and the form comes back',async ctx=>{
    const before=await audits(ctx.user.id);
    await ctx.page.route(u=>u.pathname===path,async route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
    await ctx.submit(ctx.user.password,strong());
    const alert=ctx.page.getByRole('alert').filter({hasText:/\S/}).first();
    await alert.waitFor({timeout:20000});
    assert.match((await alert.textContent()??'').trim(),/something went wrong/i);
    await settledControl(ctx.page);
    assert.equal(await audits(ctx.user.id),before,'a dropped request still changed the password');
   }],
   ['a server failure is reported and the form comes back',async ctx=>{
    const before=await audits(ctx.user.id);
    await ctx.page.route(u=>u.pathname===path,async route=>route.request().method()==='POST'
     ?route.fulfill({status:500,contentType:'text/plain',body:'certification fault injection'}):route.continue());
    await ctx.submit(ctx.user.password,strong());
    const alert=ctx.page.getByRole('alert').filter({hasText:/\S/}).first();
    await alert.waitFor({timeout:20000});
    assert.match((await alert.textContent()??'').trim(),/something went wrong/i);
    await settledControl(ctx.page);
    assert.equal(await audits(ctx.user.id),before,'a failed request still changed the password');
   }],
   ['a second submit during the request posts no duplicate change',async ctx=>{
    let posts=0;
    await ctx.page.route(u=>u.pathname===path,async route=>{
     if(route.request().method()!=='POST')return route.continue();
     posts+=1;await new Promise(r=>setTimeout(r,2500));return route.continue();
    });
    await ctx.submit(WRONG,strong());
    await ctx.page.waitForTimeout(500);
    // The control is already disabled, so submit the form itself: that is what
    // tests the in-flight guard rather than the disabled attribute.
    assert.equal(await control(ctx.page).isDisabled(),true,'the control was not disabled while the request was open');
    await ctx.page.evaluate(()=>document.querySelector('form:has(input#current_password)')?.requestSubmit());
    await fieldError(ctx.page,'current_password');
    assert.equal(posts,1,`the change was posted ${posts} times`);
   }],
  ];
  for(const [title,run] of cases){
   const name=`${actor}: ${title}`;
   let ctx;
   try{ctx=await session(actor,home,path,VIEWPORTS[0][1]);await run(ctx);record(name,true);}
   catch(e){record(name,false,{detail:e.message.slice(0,300)});}
   finally{await ctx?.c.close();await save();}
  }
 }
 /* The successful change, last: it is the one case that alters an account. */
 for(const [actor,home,path] of [ACTORS[1],ACTORS[4]]){
  const name=`${actor}: a correct current password changes it, audits it and retires the old one`;
  let ctx;
  try{
   ctx=await session(actor,home,path,VIEWPORTS[1][1]);
   const old=ctx.user.password,next=strong(),before=await audits(ctx.user.id),account0=await account(ctx.user.id);
   await ctx.submit(old,next);
   // Save the new credential as soon as Auth confirms it, so later suites and
   // retries use the password the account actually has.
   const deadline=Date.now()+30000;let accepted=false;
   do{accepted=await signsIn(actor,next);if(accepted)break;await ctx.page.waitForTimeout(500);}while(Date.now()<deadline);
   assert.equal(accepted,true,'the new password was not accepted by Auth');
   users[actor].password=next;await writeFile(`${root}/accounts.json`,JSON.stringify(users,null,2),{mode:0o600});
   // A success banner is a status region, not an alert.
   const banner=ctx.page.getByRole('status').filter({hasText:/password has been changed/i}).first();
   await banner.waitFor({timeout:20000});
   assert.match((await banner.textContent()??'').trim(),/password has been changed/i);
   assert.equal(await ctx.page.locator('input#current_password').inputValue(),'','the saved password was left in the form');
   await settledControl(ctx.page);
   assert.equal(await audits(ctx.user.id),String(Number(before)+1),'the change was not audited');
   assert.equal(await signsIn(actor,old),false,'the previous password still works');
   assert.deepEqual(await account(ctx.user.id),account0,'the change altered the account row');
   record(name,true);
  }catch(e){record(name,false,{detail:e.message.slice(0,300)});}
  finally{await ctx?.c.close();await save();}
 }
}finally{await browser.close();await db.end();await save();}
console.log(`${results.filter(r=>r.pass).length}/${results.length} change-password checks pass`);
process.exitCode=results.some(r=>!r.pass)?1:0;
