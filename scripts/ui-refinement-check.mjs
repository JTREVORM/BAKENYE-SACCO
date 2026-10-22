/** Real components, synthetic data only. Run with a dev server and CHROMIUM_PATH. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const base=process.argv[2] || 'http://localhost:3000';
const out=process.env.UI_EVIDENCE_DIR || 'work/evidence';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
const results=[]; const errors=[];
const page=await browser.newPage();
page.on('pageerror',e=>errors.push(e.message));
const fonts=new Map();
await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{const url=route.request().url();if(!fonts.has(url))fonts.set(url,(async()=>{const r=await page.request.get(url);return {status:r.status(),headers:r.headers(),body:await r.body()};})());await route.fulfill(await fonts.get(url));});
async function visit(path,width=1440){await page.setViewportSize({width,height:1000});const r=await page.goto(base+path,{waitUntil:'networkidle',timeout:120000});assert.equal(r.status(),200,path);await page.evaluate(()=>document.fonts.ready);}
async function geometry(label){
 const issues=await page.evaluate(()=>{
  const issues=[];
  if(document.documentElement.scrollWidth>innerWidth+1)issues.push(`Page overflow ${document.documentElement.scrollWidth}/${innerWidth}`);
  const rect=e=>e.getBoundingClientRect();
  for(const card of document.querySelectorAll('[data-kpi]')){
   const header=card.querySelector('[data-kpi-header]'),body=card.querySelector('[data-kpi-body]');
   if(!header || !body)continue;
   if(rect(header).bottom>rect(body).top+.5)issues.push('Header/value intersection '+card.textContent);
   for(const el of card.querySelectorAll('[data-kpi-value], [data-kpi-header] p, [data-kpi-body] p')){
    if(el.scrollWidth>el.clientWidth+1)issues.push('Clipped KPI '+el.textContent);
    if(getComputedStyle(el).textOverflow==='ellipsis')issues.push('Ellipsized KPI');
   }
   const children=[...header.children];for(let i=1;i<children.length;i++)if(rect(children[i-1]).right>rect(children[i]).left+1)issues.push('Header children intersect');
   const chart=body.querySelector(':scope > span');if(chart&&rect(chart).height&&rect(chart).top<rect(body.firstElementChild).bottom)issues.push('Chart intersection');
  }
  for(const el of document.querySelectorAll('[data-savings-figures] dt,[data-savings-figures] dd,[data-receipt] dd,[data-receipt] h1'))if(el.scrollWidth>el.clientWidth+1||getComputedStyle(el).textOverflow==='ellipsis')issues.push('Clipped text '+el.textContent);
  return issues;
 });
 assert.deepEqual(issues,[],label);results.push(label);
}
try{
 if(process.env.UI_CHECK_SCOPE !== 'receipt') {
 const routes=['/dev/preview/dashboard','/dev/preview/dashboard?variant=admin',...['administration','cashier','loans','finance','collections'].map(x=>'/dev/preview/staff/'+x),'/dev/preview/member'];
 for(const path of routes){for(const width of [320,390,768,1024,1280,1440,1600,1920]){await visit(path,width);await geometry(`${path} ${width}px`);if(width===1440){const name=path.includes('?')?'super-admin':path.split('/').at(-1)==='dashboard'?'overview':path.split('/').at(-1);await page.screenshot({path:`${out}/after-${name}.png`,fullPage:true});if(name==='overview')await page.locator('[data-savings-review]').screenshot({path:`${out}/after-savings.png`});}}}
 // Stress the rendered layout with complete values, including cards normally using compact summaries.
 for(const width of [320,390,768,1024,1280,1440,1600,1920]){
  await visit('/dev/preview/dashboard',width);
  // Direct stress mutations must wait for selective React hydration; otherwise
  // the test itself changes server text before Link children hydrate.
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-kpi-value], [data-savings-figures] dd')].every(e=>Object.keys(e).some(k=>k.startsWith('__reactFiber$'))));
  for(const amount of ['UGX 0','UGX 20,000','UGX 1,160,000','UGX 45,500,000','UGX 1,250,000,000']){
   await page.locator('[data-kpi-value], [data-savings-figures] dd').evaluateAll((els,value)=>els.forEach(el=>{el.textContent=value;}),amount);
   await geometry(`Full values ${amount} ${width}px`);
  }
 }
 // Browser CSS zoom exercises reflow at increased text/layout scale.
 for(const zoom of [1.25,2]){await visit('/dev/preview/dashboard',1280);await page.evaluate(z=>document.body.style.zoom=String(z),zoom);await geometry(`Overview zoom ${zoom}`);}
 }
 const types=['monthly_savings','weekly_savings','deposit','withdrawal','share_purchase','loan_repayment','loan_disbursement','fee','income','expense','penalty','transfer','payment'];
 const cases=types.map(type=>`type=${type}`).concat(['type=monthly_savings&status=reversed','type=deposit&status=reversal','long=1','missing=1',...['cash','mobile_money','bank_transfer','cheque','internal'].map(method=>`method=${method}`)]);
 for(let i=0;i<cases.length;i++){
  const query=cases[i];
  for(const width of [320,390,768,1440]){
   await visit('/dev/preview/receipt?'+query,width);await geometry(`Receipt ${query} ${width}px`);
   const source=JSON.parse(await page.locator('[data-source]').getAttribute('data-source'));
   const fields=await page.locator('[data-receipt] dl > div').evaluateAll(rows=>Object.fromEntries(rows.map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent])));
   assert.equal(fields['Receipt number'],source.receipt_no);assert.equal(fields['Transaction reference'],source.transaction.reference);
   assert.equal(fields.Member,source.transaction.member_name??'—');assert.equal(fields['Member number'],source.transaction.member_no??'—');
   assert.equal(fields.Amount,'UGX '+source.transaction.amount.toLocaleString('en-UG'));
   assert.equal(fields[source.fee_lines?.length?'Received by':'Recorded by'],source.transaction.recorded_by_name);
   assert.equal(fields['Payment method'],{cash:'Cash',mobile_money:'Mobile Money',bank_transfer:'Bank Transfer',cheque:'Cheque',internal:'Internal'}[source.transaction.method]);
   assert.equal(fields['Date & time'],'19 Oct 2026, 09:48 pm');assert.equal(fields['Value date'],'19 Oct 2026');
   if(source.external_ref)assert.equal(fields['Provider / bank reference'],source.external_ref);
   if(source.source_account && source.destination_account)assert.equal(fields.Moved,`${source.source_account.name} → ${source.destination_account.name}`);
   else if(source.destination_account)assert.equal(fields['Received into'],source.destination_account.name);
   else if(source.source_account)assert.equal(fields['Paid from'],source.source_account.name);
   if(source.payment)assert.equal(fields.Payee,source.payment.payee);
   if(source.transfer){assert.equal(fields['Source reference'],source.transfer.source_reference);assert.equal(fields['Destination reference'],source.transfer.destination_reference);assert.equal(fields['Handled by'],source.transfer.handled_by);}
   const article=await page.locator('[data-receipt] article').innerText();
   if(source.transaction.description)assert.ok((await page.locator('[data-receipt] article').textContent()).includes(source.transaction.description), 'Recorded description matches source text');
   const heading=source.transaction.status==='reversed'?'Transaction reversed':source.transaction.status==='reversal'?'Reversal entry':({loan_disbursement:'Loan disbursed',withdrawal:'Withdrawal completed',transfer:'Transfer completed',payment:'Payment issued',expense:'Expense paid'}[source.transaction.type]??'Payment successful');
   assert.equal(await page.locator('[data-receipt] h1').textContent(),heading);
   if(source.transaction.status!=='posted')assert.ok(!article.includes('Savings balance after'));
   if(source.loan){assert.ok(article.includes('Current outstanding balance'));assert.ok(!article.includes('fully repaid'));}
   if(i===0)await page.locator('[data-receipt]').screenshot({path:`${out}/after-receipt-${width===390?'mobile':width}.png`});
  }
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('[data-receipt] button').first().isVisible(),false);
  const pdf=`${out}/receipt-${i}.pdf`;
  await page.pdf({path:pdf,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
  const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'});const text=execFileSync('pdftotext',['-raw',pdf,'-'],{encoding:'utf8'});
  const size=info.match(/Page size:\s+([\d.]+) x ([\d.]+)/);assert.ok(size && Math.abs(Number(size[1])-595.28)<1 && Math.abs(Number(size[2])-841.89)<1, 'A4 dimensions within browser rounding');if(!query.includes('long'))assert.match(info,/Pages:\s+1/);
  const printedFields=await page.locator('[data-receipt] dd').allTextContents();for(const value of printedFields)assert.ok(text.replace(/\s/g,'').includes(value.replace(/\s/g,'')),`PDF preserves ${value}`);
  assert.ok(text.includes('RCT-TEST-0001'));assert.ok(text.includes('TXN-TEST-0001')||query.includes('long'));assert.ok(!text.includes('Download PDF'));
  await page.emulateMedia({media:'screen'});
  console.log(`PASS receipt ${query}: four viewports, source fields and A4 PDF`);
 }
 await visit('/dev/preview/receipt');
 await page.evaluate(()=>{window.__printCount=0;window.print=()=>window.__printCount++;});
 await page.getByRole('button',{name:'Print',exact:true}).click();await page.getByRole('button',{name:'Download PDF',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__printCount),2);
 await page.getByRole('button',{name:'Copy reference',exact:true}).focus();assert.ok(await page.getByRole('button',{name:'Copy reference',exact:true}).evaluate(e=>e===document.activeElement));
 assert.deepEqual(errors,[],'Browser runtime errors');
 console.log(`PASS: ${results.length} layout checks, ${cases.length} PDF cases, print/PDF actions and keyboard focus.`);
}finally{await writeFile(`${out}/test-results.json`,JSON.stringify({results,errors},null,2));await browser.close();}
