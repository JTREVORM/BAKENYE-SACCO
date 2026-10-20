/** Mint a real short-lived session, then return GoTrue to documented defaults.
 * Keep the browser open across that original token's expiry; prove SSR refresh. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database();await db.end();assert.equal(s.tokenSeconds,60);
const users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
const result={name:'Real browser session survives original JWT expiry through native SSR refresh',pass:false};
try{
 const context=await browser.newContext(),page=await context.newPage();
 await page.goto(s.app+'/login',{waitUntil:'networkidle'});
 await page.fill('input[name="identifier"]',users.viewer.email);await page.fill('input[name="password"]',users.viewer.password);await page.locator('button[type="submit"]').click();
 await page.waitForURL('**/staff');await page.waitForLoadState('networkidle');
 const cookieSession=async()=>{
  const cookies=(await context.cookies()).filter(c=>/^sb-.*-auth-token(?:\.\d+)?$/.test(c.name)).sort((a,b)=>a.name.localeCompare(b.name));
  const text=cookies.map(c=>c.value).join('');assert.ok(text.startsWith('base64-'));return JSON.parse(Buffer.from(text.slice(7),'base64url').toString());
 };
 const initial=await cookieSession();assert.ok(initial.expires_at*1000-Date.now()<65000);
 const changed=spawnSync(process.execPath,['scripts/certification/local-stack.mjs','auth-tokens','standard'],{encoding:'utf8'});assert.equal(changed.status,0,changed.stderr);
 console.log('Local Auth now uses documented 3600-second tokens and 10-second reuse interval; original browser session remains open');
 const pause=Math.max(0,initial.expires_at*1000-Date.now()+32000);
 for(let left=pause;left>0;left-=30000){await new Promise(r=>setTimeout(r,Math.min(left,30000)));console.log('Waiting for original browser JWT to expire');}
 await page.goto(s.app+'/staff',{waitUntil:'networkidle'});assert.equal(new URL(page.url()).pathname,'/staff');assert.ok(await page.locator('[data-overview-dashboard]').count());
 assert.ok((await cookieSession()).expires_at>initial.expires_at);result.pass=true;
}catch(e){result.detail=e.message;console.log(`FAIL ${result.name}: ${e.message}`);process.exitCode=1;}finally{await browser.close();await writeFile(`${root}/refresh-results.json`,JSON.stringify(result,null,2));}
if(result.pass)console.log(`PASS ${result.name}`);
