/** Repeated real browser notification actions: own updates, peer isolation and
 * visible completion. No retries replace a failed attempt in this suite. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database(),users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8')),results=[];
assert.equal(s.tokenSeconds,3600);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
try{
 for(const [actor,home,path]of [['member_a','/','/notifications'],['cashier','/staff/desk','/staff/notifications']])for(let attempt=1;attempt<=5;attempt++){
  const name=`${actor}: notification action ${attempt}/5 completes and preserves peer unread state`,u=users[actor],peer=users.member_b;
  const c=await browser.newContext({viewport:{width:390,height:900}}),page=await c.newPage(),fonts=new Map(),ids=[];let started;
  await c.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{const url=route.request().url();if(!fonts.has(url)){const r=await c.request.get(url);assert.ok(r.ok());fonts.set(url,{status:r.status(),headers:r.headers(),body:await r.body()});}await route.fulfill(fonts.get(url));});
  try{
   const title=`Certification notification ${randomUUID()}`,peerTitle=`Certification private peer ${randomUUID()}`;
   for(const [user,titleText]of [[u,title],[peer,peerTitle]])ids.push((await db.query("insert into notifications(user_id,title,body) values($1,$2,'Synthetic notification regression') returning id",[user.id,titleText])).rows[0].id);
   await page.goto(s.app+'/login',{waitUntil:'networkidle'});await page.fill('[name=identifier]',u.memberNo||u.email);await page.fill('[name=password]',u.password);await page.locator('button[type=submit]').click();await page.waitForURL(url=>url.pathname===home);
   await page.getByRole('button',{name:'Not Now',exact:true}).click({timeout:5000}).catch(()=>{});
   await page.goto(s.app+path,{waitUntil:'networkidle'});await page.locator('.skeleton').first().waitFor({state:'hidden'});
   assert.ok((await page.locator('body').innerText()).includes(title));assert.ok(!(await page.locator('body').innerText()).includes(peerTitle));
   started=Date.now();await page.getByRole('button',{name:'Mark all read',exact:true}).click();await page.getByRole('button',{name:'Mark all read',exact:true}).waitFor({state:'hidden',timeout:30000});
   const completionMs=Date.now()-started;
   const rows=(await db.query('select id,read_at from notifications where id=any($1::uuid[])',[ids])).rows;assert.ok(rows.find(r=>r.id===ids[0]).read_at);assert.equal(rows.find(r=>r.id===ids[1]).read_at,null);
   await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:'Mark all read',exact:true}).count(),0);
   results.push({name,pass:true,completionMs});console.log(`PASS ${name} (${completionMs}ms)`);
  }catch(e){
   const rows=(await db.query('select id,read_at from notifications where id=any($1::uuid[])',[ids])).rows;
   results.push({name,pass:false,detail:e.message,ownRead:!!rows.find(r=>r.id===ids[0])?.read_at,peerUnread:rows.find(r=>r.id===ids[1])?.read_at===null});console.log(`FAIL ${name}: ${e.message}`);
  }
  finally{await c.close();await writeFile(`${root}/notification-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));}
 }
}finally{await browser.close();await db.end();}
process.exitCode=results.some(r=>!r.pass)?1:0;
