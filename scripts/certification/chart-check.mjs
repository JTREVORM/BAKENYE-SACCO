/** Focused native browser filter regression; avoids waiting for a new document
 * load event after Next's client-side search-parameter navigation. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {state,database,root} from './local-stack.mjs';
const s=await state(),db=await database();await db.end();
const u=JSON.parse(await readFile(`${root}/accounts.json`,'utf8')).super_admin,results=[];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
try{
 const page=await browser.newPage();await page.goto(s.app+'/login');await page.fill('input[name="identifier"]',u.email);await page.fill('input[name="password"]',u.password);await page.locator('button[type="submit"]').click();await page.waitForURL('**/staff/admin');
 await page.getByRole('button',{name:'Not Now',exact:true}).click({timeout:10000}).catch(()=>{});
 for(const [base,name]of [['/staff/admin','Super Admin: Overview / Administration navigation and financial range filter'],['/staff','Overview: native financial range filter updates rendered selection']]){
  try{
   await page.goto(s.app+base,{waitUntil:'networkidle'});await page.locator('.skeleton').first().waitFor({state:'hidden'});
   const range=page.locator('details').filter({has:page.locator(`a[href="${base}?flow=12"]`)});
   await range.locator('summary').click();await range.getByRole('link',{name:'12 months',exact:true}).click();
   await page.waitForFunction(()=>new URL(location.href).searchParams.get('flow')==='12');
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('details summary')).some(e=>e.textContent.includes('12 months')));
   assert.equal(new URL(page.url()).pathname,base);results.push({name,pass:true});console.log(`PASS ${name}`);
  }catch(e){results.push({name,pass:false,detail:`${e.message}; final URL ${page.url()}`});console.log(`FAIL ${name}: ${e.message}; final URL ${page.url()}`);}
 }
}finally{await browser.close();await writeFile(`${root}/browser-chart-results.json`,JSON.stringify({date:new Date().toISOString(),results},null,2));}
process.exitCode=results.some(r=>!r.pass)?1:0;
