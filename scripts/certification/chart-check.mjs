/** BKC-02: native range navigation, actual buckets and ledger-derived values. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createClient} from '@supabase/supabase-js';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database();await db.end();assert.equal(s.tokenSeconds,3600);
const users=JSON.parse(await readFile(`${root}/accounts.json`,'utf8')),results=[];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
await mkdir(`${root}/screenshots`,{recursive:true});
try{
 for(const [actor,base]of [['super_admin','/staff/admin'],['admin','/staff/admin'],['manager','/staff']]){
  const u=users[actor],c=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await c.newPage(),errors=[],fonts=new Map();
  await c.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{const url=route.request().url();if(!fonts.has(url)){const r=await c.request.get(url);assert.ok(r.ok());fonts.set(url,{status:r.status(),headers:r.headers(),body:await r.body()});}await route.fulfill(fonts.get(url));});
  page.on('pageerror',e=>errors.push(e.message));
  const api=createClient(s.api,s.anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await api.auth.signInWithPassword({email:u.email,password:u.password});assert.equal(signed.error,null);
  await page.goto(s.app+'/login');await page.fill('input[name="identifier"]',u.email);await page.fill('input[name="password"]',u.password);await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname===base);
  await page.getByRole('button',{name:'Not Now',exact:true}).click({timeout:10000}).catch(()=>{});
  for(const width of [1440,390,320]){
   const name=`${actor}: ${width}px chart switches 6/12/6/12/6 with real buckets`;
   try{
    await page.setViewportSize({width,height:900});await page.goto(s.app+base,{waitUntil:'networkidle'});await page.locator('.skeleton').first().waitFor({state:'hidden'});
    for(const months of [12,6,12,6]){
     const panel=page.locator('#financial-activity');await panel.locator('summary').click();
     const responsePromise=page.waitForResponse(r=>r.request().isNavigationRequest()&&new URL(r.url()).pathname===base&&new URL(r.url()).searchParams.get('flow')===String(months));
     const link=panel.getByRole('link',{name:`${months} months`,exact:true});
     // Keyboard activation on the narrowest phone also checks native link semantics.
     if(width===320){await link.focus();await page.keyboard.press('Enter');}else await link.click();
     const response=await responsePromise;assert.equal(response.status(),200);
     await page.waitForURL(url=>url.pathname===base&&url.searchParams.get('flow')===String(months));await page.waitForLoadState('networkidle');
     await page.locator('.skeleton').first().waitFor({state:'hidden'});
     assert.equal(await panel.locator('summary').innerText().then(t=>t.replace(/expand_more/g,'').trim()),`${months} months`);
     const svg=panel.getByRole('img',{name:new RegExp(`net for ${months} months,`)});await svg.waitFor();
     const expected=await api.rpc('treasury_monthly_flow',{p_months:months});assert.equal(expected.error,null);assert.equal(expected.data.length,months);
     const titles=await svg.locator('title').allTextContents();assert.equal(titles.length,months);
     const axisLabels=await svg.locator('g:has(> title) > text').evaluateAll(es=>es.map(e=>({label:e.textContent,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})));
     assert.equal(axisLabels[0].label,expected.data[0].label);assert.equal(axisLabels.at(-1).label,expected.data.at(-1).label);
     for(let i=1;i<axisLabels.length;i++)assert.ok(axisLabels[i].left>axisLabels[i-1].right+1,'Month labels have visible spacing');
     for(const [i,bucket]of expected.data.entries()){
      const title=titles[i];assert.ok(title.includes(bucket.label));
      for(const amount of [Number(bucket.money_in),Number(bucket.money_out),Number(bucket.money_in)-Number(bucket.money_out)]){
       const display=`${amount<0?'-':''}UGX ${Math.abs(amount).toLocaleString('en-UG',{minimumFractionDigits:Number.isInteger(amount)?0:2,maximumFractionDigits:2})}`;
       assert.ok(title.includes(display));
      }
     }
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
     assert.ok(await panel.locator('summary').isVisible());
     await page.waitForFunction(()=>{const r=document.querySelector('#financial-activity summary')?.getBoundingClientRect();return r&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;});
     assert.ok(await panel.locator('summary').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}),'Native anchor keeps the range control in the viewport');
     if(months===12&&actor!=='admin')await panel.screenshot({path:`${root}/screenshots/chart-${actor}-${width}-12.jpg`,type:'jpeg',quality:75});
    }
    assert.deepEqual(errors,[]);results.push({name,pass:true,transitions:4});console.log(`PASS ${name}`);
   }catch(e){results.push({name,pass:false,detail:`${e.message}; final URL ${page.url()}`});console.log(`FAIL ${name}: ${e.message}`);}
   await writeFile(`${root}/browser-chart-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));
  }
  await c.close();
 }
}finally{await browser.close();}
process.exitCode=results.some(r=>!r.pass)?1:0;
