/** Repeated real browser notification actions: own updates, peer isolation,
 * visible completion, duplicate refusal and error recovery. Members and staff,
 * mobile and desktop. No retry replaces a failed attempt in this suite. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8')),results=[];
assert.equal(s.tokenSeconds,3600);
// A member and four staff roles, each on a phone and on a desktop, so the
// repeated count covers both areas and both layouts of the control. member_b
// is never signed in here: it stays the untouched peer of every attempt, which
// also keeps this suite independent of the lockout suite's paused identifier.
const ACTORS=[['member_a','/','/notifications'],['cashier','/staff/desk','/staff/notifications'],['manager','/staff','/staff/notifications'],['super_admin','/staff/admin','/staff/notifications'],['accountant','/staff/finance','/staff/notifications']];
const VIEWPORTS=[['mobile',{width:390,height:900}],['desktop',{width:1440,height:900}]];
const ATTEMPTS=Number(process.env.NOTIFICATION_ATTEMPTS||5);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
// A repeat run writes its own file, so an earlier run is never overwritten.
const file=process.env.NOTIFICATION_RESULT_FILE||'notification-results.json';
const save=()=>writeFile(`${root}/${file}`,JSON.stringify({date:new Date().toISOString(),results},null,2));
/** One signed-in page with its own notification and an unrelated peer's. */
async function session(actor,home,path,viewport){
 const u=users[actor],peer=users.member_b;
 const c=await browser.newContext({viewport}),page=await c.newPage(),fonts=new Map();
 await c.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{const url=route.request().url();if(!fonts.has(url)){const r=await c.request.get(url);assert.ok(r.ok());fonts.set(url,{status:r.status(),headers:r.headers(),body:await r.body()});}await route.fulfill(fonts.get(url));});
 const title=`Certification notification ${randomUUID()}`,peerTitle=`Certification private peer ${randomUUID()}`,ids=[];
 for(const [user,titleText] of [[u,title],[peer,peerTitle]])ids.push((await db.query("insert into notifications(user_id,title,body) values($1,$2,'Synthetic notification regression') returning id",[user.id,titleText])).rows[0].id);
 await page.goto(s.app+'/login',{waitUntil:'networkidle'});await page.fill('[name=identifier]',u.memberNo||u.email);await page.fill('[name=password]',u.password);await page.locator('button[type=submit]').click();await page.waitForURL(url=>url.pathname===home);
 await page.getByRole('button',{name:'Not Now',exact:true}).click({timeout:5000}).catch(()=>{});
 await page.goto(s.app+path,{waitUntil:'networkidle'});await page.locator('.skeleton').first().waitFor({state:'hidden'}).catch(()=>{});
 return {c,page,ids,title,peerTitle,button:page.getByRole('button',{name:'Mark all read',exact:true}),
  read:async()=>(await db.query('select id,read_at from notifications where id=any($1::uuid[])',[ids])).rows};
}
const record=(name,pass,extra={})=>{results.push({name,pass,...extra});console.log(`${pass?'PASS':'FAIL'} ${name}${extra.detail?`: ${extra.detail}`:''}${extra.completionMs!==undefined?` (${extra.completionMs}ms)`:''}`);};
async function failure(name,e,ctx){
 const rows=ctx?await ctx.read():[];
 record(name,false,{detail:e.message.slice(0,300),ownRead:!!rows.find(r=>r.id===ctx?.ids[0])?.read_at,peerUnread:rows.find(r=>r.id===ctx?.ids[1])?.read_at===null});
}
try{
 /* Completion, persistence and isolation, repeated per actor and viewport. */
 for(const [actor,home,path] of ACTORS)for(const [label,viewport] of VIEWPORTS)for(let attempt=1;attempt<=ATTEMPTS;attempt++){
  const name=`${actor} ${label}: notification action ${attempt}/${ATTEMPTS} completes and preserves peer unread state`;
  let ctx;
  try{
   ctx=await session(actor,home,path,viewport);
   const text=await ctx.page.locator('body').innerText();
   assert.ok(text.includes(ctx.title),'own notification is not listed');
   assert.ok(!text.includes(ctx.peerTitle),'another account’s notification is listed');
   const started=Date.now();
   await ctx.button.click();
   await ctx.button.waitFor({state:'hidden',timeout:30000});
   const completionMs=Date.now()-started;
   const rows=await ctx.read();
   assert.ok(rows.find(r=>r.id===ctx.ids[0]).read_at,'own notification was not saved as read');
   assert.equal(rows.find(r=>r.id===ctx.ids[1]).read_at,null,'another account’s notification was marked read');
   await ctx.page.reload({waitUntil:'networkidle'});
   assert.equal(await ctx.button.count(),0,'the control returned after reloading');
   record(name,true,{completionMs});
  }catch(e){await failure(name,e,ctx);}
  finally{await ctx?.c.close();await save();}
 }
 /* One slow request, two taps: the write must be posted once. */
 for(const [actor,home,path] of [ACTORS[0],ACTORS[1]]){
  const name=`${actor}: a second tap during the request posts no duplicate write`;
  let ctx;
  try{
   ctx=await session(actor,home,path,VIEWPORTS[0][1]);
   let posts=0;
   await ctx.page.route(u=>u.pathname===path,async route=>{
    if(route.request().method()!=='POST')return route.continue();
    posts+=1;await new Promise(r=>setTimeout(r,2000));return route.continue();
   });
   await ctx.button.click();
   // Dispatched directly, so the guard is tested rather than the disabled attribute.
   await ctx.page.waitForTimeout(400);await ctx.button.dispatchEvent('click').catch(()=>{});
   await ctx.button.waitFor({state:'hidden',timeout:30000});
   assert.equal(posts,1,`the action was posted ${posts} times`);
   const rows=await ctx.read();
   assert.ok(rows.find(r=>r.id===ctx.ids[0]).read_at);
   assert.equal(rows.find(r=>r.id===ctx.ids[1]).read_at,null);
   record(name,true,{posts});
  }catch(e){await failure(name,e,ctx);}
  finally{await ctx?.c.close();await save();}
 }
 /* A dropped request must release the control, say so, and allow a retry. */
 for(const [actor,home,path] of [ACTORS[0],ACTORS[1]]){
  const name=`${actor}: a dropped request releases the control and the retry succeeds`;
  let ctx;
  try{
   ctx=await session(actor,home,path,VIEWPORTS[0][1]);
   let drop=true;
   await ctx.page.route(u=>u.pathname===path,async route=>route.request().method()==='POST'&&drop?route.abort('failed'):route.continue());
   await ctx.button.click();
   // Filtered on text, so this waits for the message itself rather than for
   // an alert element that is a frame away from having been laid out.
   const alert=ctx.page.locator('[role=alert]').filter({hasText:/\S/}).first();
   await alert.waitFor({timeout:15000});
   const message=(await alert.textContent()??'').trim();
   assert.ok(message.length>0,'no error was shown');
   await ctx.button.first().waitFor({state:'visible'});
   assert.equal(await ctx.button.first().getAttribute('aria-busy'),null,'the control stayed busy after the failure');
   assert.equal(await ctx.button.first().isEnabled(),true,'the control stayed disabled after the failure');
   let rows=await ctx.read();
   assert.equal(rows.find(r=>r.id===ctx.ids[0]).read_at,null,'a failed request still changed the database');
   drop=false;
   await ctx.button.click();
   await ctx.button.waitFor({state:'hidden',timeout:30000});
   rows=await ctx.read();
   assert.ok(rows.find(r=>r.id===ctx.ids[0]).read_at,'the retry did not save');
   assert.equal(rows.find(r=>r.id===ctx.ids[1]).read_at,null);
   record(name,true,{message});
  }catch(e){await failure(name,e,ctx);}
  finally{await ctx?.c.close();await save();}
 }
}finally{await browser.close();await db.end();await save();}
console.log(`${results.filter(r=>r.pass).length}/${results.length} notification interactions pass`);
process.exitCode=results.some(r=>!r.pass)?1:0;
