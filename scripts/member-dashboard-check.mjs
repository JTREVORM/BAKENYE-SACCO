/** Development-only review. No sign-in, writes or financial submissions.
 * CHROMIUM_PATH=/usr/bin/chromium node scripts/member-dashboard-check.mjs */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = 'work/member-review';
const widths = [1855,1440,1280,1024,834,768,600,390,360,320];
await mkdir(out,{recursive:true});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
  proxy: process.env.HTTPS_PROXY ? {server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'} : undefined,
});
try {
  const context = await browser.newContext({reducedMotion:'reduce'});
  const fonts = new Map();
  if(process.env.HTTPS_PROXY) await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{
    const url=route.request().url();
    if(!fonts.has(url)) fonts.set(url,(async()=>{
      const response=await context.request.get(url);
      assert.ok(response.ok());
      return {status:response.status(),headers:response.headers(),body:await response.body()};
    })());
    await route.fulfill(await fonts.get(url));
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/dev/preview/member`,{waitUntil:'networkidle',timeout:120000});
  await page.evaluate(async()=>{await document.fonts.load('20px "Material Symbols Outlined"');await document.fonts.ready;});
  const content=page.locator('[data-member-dashboard]');
  assert.equal(await content.getByRole('heading',{level:1}).innerText(),'Welcome, Nakabugo');
  for(const amount of ['UGX 2,450,000','UGX 100,000','UGX 1,200,000','UGX 40,000','UGX 150,000']) assert.ok((await content.innerText()).includes(amount));
  assert.equal(await page.locator('a[href^="/staff"]').count(),0,'No staff navigation or actions');
  assert.equal(await page.locator('a[href="#"]').count(),0,'All actions have real destinations');
  assert.doesNotMatch(await content.innerText(),/6,730,000|Wanyama|Namutebi|Cash at Bank|Staff accounts/,'Only this member’s financial information');
  const actions=page.getByRole('region',{name:'Quick Actions'});
  assert.deepEqual(await actions.locator('a').evaluateAll(a=>a.map(el=>el.getAttribute('href'))),['/savings/deposit','/shares/buy','/loans/apply','/loans/repay','/statements','/notifications']);
  assert.deepEqual(await content.locator('[data-member-balance]').evaluateAll(a=>a.map(el=>el.getAttribute('href'))),['/savings','/shares','/loans']);
  for(const width of widths){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}: no document overflow`);
    assert.equal(await page.locator('main .overflow-y-auto').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`${width}: no main overflow`);
    const clipped=await content.locator('[data-member-balance]').evaluateAll(cards=>cards.flatMap(card=>{
      const amount=card.children[1];
      const heading=card.querySelector('h2');
      const arrow=heading.nextElementSibling.getBoundingClientRect();
      return amount.scrollWidth>amount.clientWidth+1 || heading.scrollWidth>heading.clientWidth+1 || heading.getBoundingClientRect().right>arrow.left ? [card.textContent] : [];
    }));
    assert.deepEqual(clipped,[],`${width}: complete amounts and aligned headings`);
    const transactionLinks=content.locator(width<768?'a[href^="/transactions/"]:visible':'tbody a[href^="/transactions/"]:visible');
    assert.equal(await transactionLinks.count(),2,'Only this member’s two existing receipts');
    assert.equal(await page.locator('[data-sidebar] a[aria-current="page"]').getAttribute('href'),'/');
    if(width<768){
      await page.getByRole('button',{name:'Open menu',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Navigation'});
      assert.ok(await dialog.isVisible());
      for(const href of ['/','/savings','/loans','/shares','/transactions','/statements','/notifications','/profile','/guarantees','/reports']) assert.equal(await dialog.getByRole('navigation').locator(`a[href="${href}"]`).count(),1);
      assert.equal(await dialog.locator('a[aria-current="page"]').getAttribute('href'),'/');
      await page.keyboard.press('Escape');
      assert.ok(!(await dialog.isVisible()));
    }
    const badText=await content.locator('h2,p').evaluateAll(els=>els.filter(el=>el.clientWidth&&el.scrollWidth>el.clientWidth+1).map(el=>el.textContent));
    assert.deepEqual(badText,[],`${width}: readable labels and descriptions`);
    await page.addStyleTag({content:'nextjs-portal{display:none}'});
    await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    await page.locator('main .overflow-y-auto').evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:`${out}/member-${width}.png`});
    if(width===390 || width===1855){
      const height=await content.evaluate(el=>{
        const s=getComputedStyle(el.closest('main .overflow-y-auto'));
        const header=[...document.querySelectorAll('[data-app-header]')].find(el=>el.getBoundingClientRect().height>0);
        return Math.ceil(el.getBoundingClientRect().height+header.getBoundingClientRect().height+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom))+4;
      });
      await page.setViewportSize({width,height});
      await page.locator('main .overflow-y-auto').evaluate(el=>{el.scrollTop=0;});
      await page.screenshot({path:`${out}/member-${width===390?'mobile':'desktop'}-full.png`});
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS Member ${width}px: own balances, account actions, receipts and responsive navigation`);
  }
  for(const width of [1855,320]){
    await page.setViewportSize({width,height:1000});
    await page.goto(`${base}/dev/preview/member?member=22222222-2222-4222-8222-222222222222&limited=1`,{waitUntil:'networkidle'});
    assert.equal(await page.getByRole('link',{name:'Apply Loan',exact:true}).count(),0,'Existing apply permission can hide the action');
    assert.ok((await content.innerText()).includes('No active loan'));
    assert.ok((await content.innerText()).includes('Nothing saved yet this month. Nothing is owed.'));
    assert.equal(await page.locator('[data-member-payment]').count(),0);
    assert.doesNotMatch(await content.innerText(),/Nakabugo|Namutebi|SAV260830004|LRP260829002/);
    await page.goto(`${base}/dev/preview/member?member=33333333-3333-4333-8333-333333333333`,{waitUntil:'networkidle'});
    assert.ok((await content.innerText()).includes('UGX 12,480,000'));
    assert.ok((await content.innerText()).includes('Reversed'));
    assert.ok((await content.innerText()).includes('Next Payment'));
    assert.equal(await page.locator('main .overflow-y-auto').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.goto(`${base}/dev/preview/member?state=pending`,{waitUntil:'networkidle'});
    assert.ok(await page.getByRole('heading',{name:'Your membership is pending'}).isVisible());
    await page.goto(`${base}/dev/preview/member?state=empty`,{waitUntil:'networkidle'});
    assert.ok(await page.getByText('No transactions yet',{exact:true}).isVisible());
    assert.ok((await content.innerText()).includes('UGX 0'));
    console.log(`PASS Member ${width}px: restricted apply, no loan, reversed receipt, pending and empty states`);
  }
  for(const path of ['/','/savings','/shares','/loans','/savings/deposit','/shares/buy','/loans/apply','/loans/repay','/transactions','/statements','/notifications','/profile']){
    const response=await context.request.get(`${base}${path}`,{maxRedirects:0});
    assert.equal(response.status(),307);
    assert.equal(new URL(response.headers().location,base).pathname,'/login');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS Member destinations retain signed-out guards; no browser errors or financial submissions');
} finally {await browser.close();}
