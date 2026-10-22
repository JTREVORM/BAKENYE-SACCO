import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const base=process.argv[2] || 'http://localhost:3000';
const out=process.env.UI_EVIDENCE_DIR || 'work/evidence';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
const fonts=new Map();await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{const url=route.request().url();if(!fonts.has(url))fonts.set(url,(async()=>{const r=await page.request.get(url);return {status:r.status(),headers:r.headers(),body:await r.body()};})());await route.fulfill(await fonts.get(url));});
try{
// Check category-specific values against the supplied payload, including the
// values outside the common details list. These are reads of synthetic pages.
for(const type of ['monthly_savings','weekly_savings','deposit','withdrawal','share_purchase','loan_repayment','loan_disbursement','fee','income','expense','penalty','transfer','payment']){
 await page.goto(`${base}/dev/preview/receipt?type=${type}`,{waitUntil:'networkidle'});
 const source=JSON.parse(await page.locator('[data-source]').getAttribute('data-source'));
 const article=await page.locator('[data-receipt] article').textContent();
 const money=value=>'UGX '+value.toLocaleString('en-UG');
 assert.equal(await page.locator('[aria-label="Transaction summary"] .tabular').textContent(),money(source.transaction.amount));
 if(source.loan){assert.ok(article.includes(source.loan.loan_no));assert.ok(article.includes(money(source.loan.outstanding)));}
 if(source.shares){assert.ok(article.includes(`${source.shares.quantity} share`));for(const value of [source.shares.unit_price,source.shares.total_value])assert.ok(article.includes(money(value)));}
 for(const line of source.fee_lines??[]){assert.ok(article.includes(line.description));assert.ok(article.includes(money(line.amount)));}
 if(['monthly_savings','weekly_savings','deposit','withdrawal'].includes(type)){
  const balance=page.getByText('Savings balance after this transaction',{exact:true}).locator('..');
  assert.ok((await balance.textContent()).includes(money(source.balance_after)));
 }
 const status=page.locator('[data-receipt] dl > div').filter({has:page.locator('dt',{hasText:'Status'})}).locator('dd');
 assert.equal(await status.textContent(),'Success');
}
console.log('PASS all 13 category-specific receipt details match their synthetic payloads.');
await page.goto(`${base}/dev/preview/receipt?balance=off`,{waitUntil:'networkidle'});
assert.equal(await page.getByText('Savings balance after this transaction',{exact:true}).count(),0);
for(const shell of ['staff','member'])for(const long of [false,true]){
 await page.goto(`${base}/dev/preview/receipt?shell=${shell}${long?'&long=1':''}`,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
 await page.emulateMedia({media:'print'});
 for(const selector of ['[data-sidebar]','[data-app-header]','[data-scroll-control]','[data-receipt] button'])for(const e of await page.locator(selector).all())assert.equal(await e.isVisible(),false);
 const contrastFailures=await page.locator('[data-receipt] article').evaluate(root=>{
  const luminance=color=>{
   const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
   return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  };
  return [...root.querySelectorAll('dt,dd,p,h1,h2')].filter(el=>el.textContent.trim() && (1.05/(luminance(getComputedStyle(el).color)+.05))<4.5).map(el=>el.textContent);
 });assert.deepEqual(contrastFailures,[], 'Receipt print text meets 4.5:1 contrast on white');
 const clipped=await page.locator('[data-receipt]').evaluate(el=>{const bad=[];for(let p=el.parentElement;p;p=p.parentElement){if(p.scrollHeight>p.clientHeight+1&&['hidden','auto','scroll'].includes(getComputedStyle(p).overflowY))bad.push(p.tagName);}return bad;});assert.deepEqual(clipped,[]);
 const pdf=`${out}/receipt-${shell}${long?'-long':''}.pdf`;await page.pdf({path:pdf,format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
 const text=execFileSync('pdftotext',['-raw',pdf,'-'],{encoding:'utf8'});const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'});
 if(!long)assert.match(info,/Pages:\s+1/);
 if(long){const pages=text.split('\f').filter(p=>p.trim());assert.ok(pages.at(-1).includes('Description'), 'Long description stays with the sign-off');}
 for(const value of await page.locator('[data-receipt] dd').allTextContents())assert.ok(text.replace(/\s/g,'').includes(value.replace(/\s/g,'')),`Print retains ${value}`);
 assert.ok(text.includes('valid without a signature'));assert.ok(!text.includes('Record saving'));assert.ok(!text.includes('Download PDF'));
 if(!long){await page.screenshot({path:`${out}/after-print-preview-${shell}.png`,fullPage:true});await page.pdf({path:`${out}/receipt-${shell}-no-background.pdf`,format:'A4',preferCSSPageSize:true,printBackground:false,displayHeaderFooter:false});}
 await page.emulateMedia({media:'screen'});
 console.log(`PASS ${shell} shell ${long?'long':'standard'}: print chrome hidden, no clipping, all field values retained${long?'':', one A4 page'}`);
}
// Financial summaries outside the shared KPI component, with every requested amount.
if(!process.env.PRINT_ONLY) for(const path of ['dashboard','dashboard?variant=admin','staff/administration','member','staff/finance','staff/cashier','staff/loans','staff/collections'])for(const width of [320,390,768,1024,1280,1440,1600,1920]){
 await page.setViewportSize({width,height:1000});await page.goto(`${base}/dev/preview/${path}`,{waitUntil:'networkidle'});
 for(const amount of ['UGX 0','UGX 20,000','UGX 1,160,000','UGX 45,500,000','UGX 1,250,000,000']){
  const issues=await page.evaluate(amount=>{
   const targets=[...document.querySelectorAll('[data-kpi-value],section[aria-labelledby^="card-"] > .tabular,section[aria-labelledby="total-funds"] > .tabular,[class*="MemberDashboard_amount"],[class*="MemberDashboard_updateAmount"],[data-staff-dashboard="collections"] section dd .tabular')];
   if(!targets.length)return ['No financial targets found'];targets.forEach(e=>{e.textContent=amount;});return targets.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent);
  },amount);assert.deepEqual(issues,[],`${path} ${width}px ${amount}`);
 }
}
assert.deepEqual(errors,[]);console.log(process.env.PRINT_ONLY ? 'PASS print checks; no browser runtime errors.' : 'PASS 320 additional full-value financial-summary checks; no browser runtime errors.');
}finally{await browser.close();}
