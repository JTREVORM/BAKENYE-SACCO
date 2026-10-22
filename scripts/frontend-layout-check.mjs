/** Read-only browser checks against the disposable local stack; never posts money. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
const base=process.argv[2]??'http://127.0.0.1:3000';
for(const raw of [base,process.env.DATABASE_URL])assert(['127.0.0.1','localhost'].includes(new URL(raw).hostname),'Loopback only');
const out=process.env.FRONTEND_EVIDENCE_DIR??'work/frontend/layout';fs.mkdirSync(out,{recursive:true});
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const m=(await db.query("select id from members where status='active' order by member_no limit 1")).rows[0];
const cash=(await db.query("select id from financial_accounts where account_type='cash' and status='active' limit 1")).rows[0];
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});const p=await b.newPage();
p.setDefaultTimeout(60000);await p.addInitScript(()=>localStorage.setItem('bnd_app_installed','1'));
const results=[];
async function geometry(label){
 const issues=await p.evaluate(()=>{
  const out=[];if(document.documentElement.scrollWidth>innerWidth+1)out.push(`Page overflows ${document.documentElement.scrollWidth}/${innerWidth}`);
  for(const e of document.querySelectorAll('main button, [data-member-register] nav a')){
   const r=e.getBoundingClientRect();if(r.width&&r.height&&e.closest('.sticky-actions')&&(r.right>innerWidth+1||r.left<0||e.scrollWidth>e.clientWidth+1))out.push('Clipped form button '+e.textContent);
   if(r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'&&(r.width<44||r.height<44))out.push(`Small target ${e.ariaLabel||e.textContent}: ${r.width}x${r.height}`);
  }
  return out;
 });assert.deepEqual(issues,[],label);results.push(label);console.log('PASS '+label);
}
try{
 await p.goto(base+'/login');await p.locator('[name=identifier]').fill(process.env.STAFF_EMAIL);await p.locator('[name=password]').fill(process.env.STAFF_PASSWORD);await p.locator('button[type=submit]').click();await p.waitForURL(/staff/);
 for(const width of [320,390,768,1024,1280,1440,1600,1920]){
  await p.setViewportSize({width,height:1000});
  await p.goto(base+'/staff/reports/members?page=2');await geometry('Register '+width+'px');
  if([320,390,768,1440].includes(width))await p.screenshot({path:`${out}/register-${width}.png`,animations:'disabled'});
  await p.goto(`${base}/staff/finance/new/collection?member=${m.id}&type=deposit`);await p.locator('#collection-amount').fill('1250000000');await p.locator('#collection-account').selectOption(cash.id);await p.getByRole('button',{name:'Review',exact:true}).click();await geometry('Financial confirmation '+width+'px');
  if([320,390,1440].includes(width))await p.screenshot({path:`${out}/confirmation-${width}.png`,animations:'disabled'});
 }
 await p.goto(base+'/staff/reports/members?page=2');
 const downloadPromise=p.waitForEvent('download');await p.getByRole('link',{name:'Download full CSV'}).click();const download=await downloadPromise;const csv=fs.readFileSync(await download.path(),'utf8');const count=Number((await db.query('select count(*) from members')).rows[0].count);assert(count>1000);assert.equal(csv.trim().split(/\r?\n/).length,count+1);assert(csv.includes('UIQA999'));console.log('PASS Unfiltered streamed CSV includes every one of '+count+' members');
 const last=(await p.locator('tbody tr').nth(249).locator('td').first().textContent()).trim();
 const pdf=`${out}/register-page-2-complete.pdf`;await p.pdf({path:pdf,format:'A4',landscape:true,printBackground:true});const text=execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'});assert(text.includes(last),'All 250 displayed records must print');assert(text.includes('only this page'));console.log('PASS Register PDF includes last displayed record and partial-register disclosure');
 await p.goto(base+'/staff/reports/members?page=999');await p.waitForURL(u=>!u.searchParams.has('page')||u.searchParams.get('page')!=='999');await p.goto(base+'/staff/reports/members?page=NaN');assert(await p.getByText(/Showing 1–250/).count());console.log('PASS Out-of-range and invalid page navigation');
 await p.goto(base+'/login'); // authenticated users redirect; use a fresh context for sign-in captures.
 const publicPage=await b.newPage();for(const width of [390,1024,1440]){await publicPage.setViewportSize({width,height:1000});await publicPage.goto(base+'/login');await publicPage.screenshot({path:`${out}/login-${width}.png`,fullPage:true,animations:'disabled'});}
}finally{fs.writeFileSync(`${out}/layout-results.json`,JSON.stringify(results,null,2));await b.close();await db.end();}
