/** Fixture-based keyboard and shared-component regression. This deliberately
 * does not authenticate, mark notifications read or submit financial actions. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.argv[2]??'http://localhost:3000';
const out='work/certification';
const phases=new Set(process.argv[3]?.split(',')??['keyboard','menus','branding','shared','states']);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}:undefined});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const fonts=new Map();
  if(process.env.HTTPS_PROXY)await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,async route=>{
    const url=route.request().url();
    if(!fonts.has(url))fonts.set(url,(async()=>{const r=await context.request.get(url);assert.ok(r.ok());return{status:r.status(),headers:r.headers(),body:await r.body()};})());
    await route.fulfill(await fonts.get(url));
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const previews=['/dev/preview/member','/dev/preview/dashboard?variant=admin','/dev/preview/dashboard','/dev/preview/staff/administration','/dev/preview/staff/cashier','/dev/preview/staff/loans','/dev/preview/staff/finance','/dev/preview/staff/collections'];
  if(phases.has('keyboard'))for(const route of previews){
    await page.setViewportSize({width:390,height:844});
    await page.goto(base+route,{waitUntil:'networkidle',timeout:120000});
    await page.evaluate(async()=>{await document.fonts.load('20px "Material Symbols Outlined"');await document.fonts.ready;});
    const opener=page.getByRole('button',{name:'Open menu',exact:true});
    await opener.focus();await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Navigation'});
    assert.ok(await dialog.isVisible());
    assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'Opening navigation moves focus inside');
    for(let i=0;i<35;i++){
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)||document.activeElement===document.body),'Native modal keeps keyboard focus away from page behind it');
    }
    await page.keyboard.press('Shift+Tab');
    assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(),0);
    assert.ok(await opener.evaluate(el=>el===document.activeElement),'Escape restores the menu trigger');
    for(let i=0;i<8;i++){
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('dialog:not([open])'))),false,'Closed navigation is not tabbable');
    }
    await opener.click();
    await page.setViewportSize({width:1440,height:900});
    await page.waitForTimeout(100);
    assert.equal(await page.locator('dialog[open]').count(),0,'Resizing to desktop removes modal inertness');
    console.log(`PASS keyboard navigation ${route}`);
  }
  if(phases.has('menus'))for(const [role,settings]of[['administration',true],['administration?limited=1',false],['cashier',false],['loans',false],['finance',false],['collections',false]]){
    await page.goto(`${base}/dev/preview/staff/${role}`,{waitUntil:'networkidle'});
    const trigger=page.getByRole('button',{name:'Account menu',exact:true});
    await trigger.focus();await page.keyboard.press('Enter');
    const menu=page.getByRole('menu');
    assert.equal(await menu.getByRole('menuitem',{name:'Settings',exact:true}).count(),settings?1:0);
    assert.ok(await menu.evaluate(el=>el.contains(document.activeElement)));
    await page.keyboard.press('End');assert.ok(await menu.getByRole('menuitem').last().evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Home');assert.ok(await page.getByRole('menuitem',{name:'My profile',exact:true}).evaluate(el=>el===document.activeElement));
    await page.keyboard.press('ArrowDown');assert.ok(await page.getByRole('menuitem',{name:'Change password',exact:true}).evaluate(el=>el===document.activeElement));
    const search=page.getByRole('searchbox',{name:'Search members',exact:true});
    if(await search.count()){
      await search.focus();await page.keyboard.press('ArrowDown');
      assert.ok(await search.evaluate(el=>el===document.activeElement),'Menu key handlers do not capture keys from the search field');
    }
    await page.keyboard.press('Escape');assert.equal(await menu.count(),0);assert.ok(await trigger.evaluate(el=>el===document.activeElement));
    console.log(`PASS account menu permissions and keyboard ${role}`);
  }
  if(phases.has('branding'))for(const width of[320,360,390,600]){
    await page.setViewportSize({width,height:900});
    await page.goto(`${base}/dev/preview/member`,{waitUntil:'networkidle'});
    const title=page.locator('[data-app-header]:visible h1');
    assert.equal(await title.innerText(),'Bakenye SACCO');
    assert.ok(await title.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Preferred mobile branding fits');
    if(width===390){await page.addStyleTag({content:'nextjs-portal{display:none}'});await page.screenshot({path:`${out}/member-brand-mobile.png`});}
    console.log(`PASS mobile branding ${width}px`);
  }
  if(phases.has('shared'))for(const width of[320,390,1440])for(const shell of['member','staff']){
    await page.setViewportSize({width,height:1000});
    await page.goto(`${base}/dev/preview/certification?shell=${shell}`,{waitUntil:'networkidle'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('[data-member-dashboard],[data-staff-dashboard],[data-admin-dashboard],[data-overview-dashboard]').count(),0);
    const card=page.locator('main a[href^="/transactions/"]').first();
    assert.equal(await card.evaluate(el=>getComputedStyle(el).borderRadius),'16px','Non-dashboard transaction cards retain original styling');
    if(shell==='member')assert.ok(await page.locator('main .max-w-2xl').evaluate(el=>el.clientWidth<=672),'Other member screens retain their centered column');
    console.log(`PASS shared ${shell} components ${width}px`);
  }
  if(phases.has('states'))for(const width of[320,1440]){
    await page.setViewportSize({width,height:1000});
    await page.goto(`${base}/dev/preview/certification?shell=states`,{waitUntil:'networkidle'});
    assert.ok(await page.getByRole('alert').filter({hasText:'Unable to load this information'}).isVisible());
    assert.ok(await page.getByText('No transactions yet',{exact:true}).isVisible());
    assert.ok(await page.locator('.skeleton').count()>0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    console.log(`PASS loading, error and empty presentation ${width}px`);
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
