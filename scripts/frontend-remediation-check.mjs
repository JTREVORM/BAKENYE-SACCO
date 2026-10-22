/** Browser → existing server actions → 52-migration disposable database.
 * Requires the local fault proxy in scripts/frontend-test-proxy.mjs.
 * No .env files are loaded. Every endpoint must be loopback; synthetic identities only.
 * Native GoTrue semantics remain a separate release gate.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';
const BASE=process.argv[2]??'http://127.0.0.1:3000';
const OUT=process.env.FRONTEND_EVIDENCE_DIR??'work/frontend/results';
const faults=process.env.FRONTEND_TEST_FAULT_FILE;
const scope=process.env.FRONTEND_SCOPE??'all';
const runs=name=>scope==='all'||scope===name;
for(const raw of [BASE,process.env.DATABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_URL]){
  assert(raw,'Explicit isolated endpoints required');assert(['127.0.0.1','localhost','[::1]'].includes(new URL(raw).hostname),'Loopback only');
}
assert(faults,'FRONTEND_TEST_FAULT_FILE required');assert.match(process.env.STAFF_EMAIL??'',/@test\.invalid$/);
fs.mkdirSync(OUT,{recursive:true});
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.addInitScript(() => localStorage.setItem('bnd_app_installed', '1'));
page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];const pass=label=>{results.push(label);console.log('PASS '+label);};
const fault=(...rules)=>fs.writeFileSync(faults,JSON.stringify(rules));
const rule=(path,mode='error',message='Synthetic service temporarily unavailable')=>({path,mode,message,remaining:1});
const visible=async(text,ctx=page)=>{await ctx.getByText(text,{exact:false}).filter({visible:true}).first().waitFor({state:'visible'});};
const screenshot=async(name,ctx=page)=>ctx.screenshot({path:`${OUT}/${name}.png`,fullPage:true,animations:'disabled',mask:[ctx.locator('[aria-label^="Temporary password "]')]});
async function login(p=page,identifier=process.env.STAFF_EMAIL,password=process.env.STAFF_PASSWORD){await p.goto(BASE+'/login');await p.locator('[name=identifier]').fill(identifier);await p.locator('[name=password]').fill(password);await p.locator('button[type=submit]').click();await p.waitForURL(u=>!u.pathname.endsWith('/login'),{timeout:60000});}
const admin=(await db.query('select id from auth.users where email=$1',[process.env.STAFF_EMAIL])).rows[0];assert(admin);
const member=(await db.query("select * from members where status='active' order by member_no limit 1")).rows[0];assert(member);
try {
  fault();
  if (runs('public') && !process.env.FRONTEND_SKIP_PUBLIC) for(const width of [320,390,768,1024,1280,1440,1600,1920]){
    await page.setViewportSize({width,height:1000});
    for(const path of ['/forgot-password','/forgot-password?reason=unavailable','/reset-password']){
      await page.goto(BASE+path);await visible('Self-service password recovery is temporarily unavailable.');
      assert.equal(await page.locator('input').count(),0);assert.equal(await page.getByRole('link',{name:'Back to Sign In'}).getAttribute('href'),'/login');
      assert(await page.locator('img[src*="bnd-logo"]').count());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    await screenshot('recovery-'+width);
    await page.goto(BASE+'/login');
    for(const e of await page.locator('button[aria-controls="password"],a[href="/forgot-password"]').all()){
      const r=await e.boundingBox();assert(r.width>=44&&r.height>=44,`Login touch target ${width}`);
    }
    await page.getByRole('button',{name:'Show password'}).focus();assert(await page.getByRole('button',{name:'Show password'}).evaluate(e=>e.matches(':focus-visible')));
    await page.keyboard.press('Enter');assert.equal(await page.locator('[name=password]').getAttribute('type'),'text');
    await page.goto(BASE+'/dev/preview/receipt');
    const size=await page.locator('[class*="documentTitle"]').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));assert(size>=12);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if([320,1440].includes(width))await screenshot('receipt-'+width);
    pass('Recovery, login keyboard/touch areas and receipt '+width+'px');
  }
  if(runs('public')) { await page.goto(BASE+'/auth/callback?code=old-synthetic-code&next=/reset-password');assert.match(page.url(),/forgot-password\?reason=unavailable/);await visible('Self-service password recovery');pass('Old recovery callback redirects to support'); }
  await page.setViewportSize({width:1440,height:1000});await login();
  if(runs('staff')) {
    await page.goto(BASE+'/staff/users');await page.getByRole('button',{name:'Add staff account',exact:true}).click();
    await page.locator('[name=full_name]').fill('Synthetic Staff Reveal QA');await page.locator('[name=email]').fill(`frontend.staff.${Date.now()}@test.invalid`);await page.locator('[name=role]').selectOption('cashier');
    await page.getByRole('dialog').getByRole('button',{name:'Create account',exact:true}).click();await visible('Temporary password - shown only now');await screenshot('staff-create-success');
    await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Add staff account',exact:true}).click();assert.equal(await page.locator('[aria-label^="Temporary password "]').count(),0);await visible('Full name');await screenshot('staff-create-reopened');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();pass('Staff creation destroys temporary-password state on dismissal');
  }
  if(runs('auth')) {
  await page.goto(BASE+`/staff/members/${member.id}`);
  if(await page.getByRole('button',{name:'Create login',exact:true}).count()){
    await page.getByRole('button',{name:'Create login',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Create login',exact:true}).click();await visible('Temporary password - shown only now');await page.getByRole('button',{name:'Done - I have given it to them'}).click();pass('Create-login dialog survives server refresh and reveals credential once');
  }
  async function openReset(){await page.reload();await page.getByRole('button',{name:'Reset password',exact:true}).click();}
  await openReset();
  const memberUser=(await db.query('select user_id from members where id=$1',[member.id])).rows[0].user_id;
  fault({...rule('/auth/v1/admin/users/'+memberUser),method:'PUT'});
  await page.getByRole('dialog').getByRole('button',{name:'Reset password',exact:true}).click();
  await visible('The password could not be reset just now. Please try again. No password was changed.');assert.equal(await page.locator('[aria-label^="Temporary password "]').count(),0);await screenshot('reset-failure');
  assert(await page.getByRole('dialog').getByRole('button',{name:'Reset password',exact:true}).isEnabled());
  fault(rule('/rest/v1/rpc/complete_temporary_password_reset'));
  await page.getByRole('dialog').getByRole('button',{name:'Reset password',exact:true}).click();
  const caveat='The temporary password below is active, but the reset could not be fully recorded. Give it to the account holder, then ask an administrator to confirm the reset in the audit log.';
  await visible(caveat);let temporary=(await page.locator('[aria-label^="Temporary password "]').textContent()).trim();await screenshot('reset-partial');
  await page.getByRole('button',{name:'Done - I have given it to them'}).click();
  await openReset();assert.equal(await page.locator('[aria-label^="Temporary password "]').count(),0);await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();pass('Staff failure, active-password caveat and reveal-once dismissal');
  const memberContext=await browser.newContext({viewport:{width:390,height:1000}});await memberContext.addInitScript(() => localStorage.setItem('bnd_app_installed','1'));const mp=await memberContext.newPage();
  await login(mp,member.member_no,temporary);await mp.waitForURL(/change-password/);
  await mp.goto(BASE+'/savings');await mp.waitForURL(/change-password/);pass('Temporary-password navigation restrictions hold');
  const next='SyntheticMember-2026';
  async function firstChange(current,password=next){await mp.locator('[name=current_password]').fill(current);await mp.locator('[name=password]').fill(password);await mp.locator('[name=confirm]').fill(password);await mp.getByRole('button',{name:'Save password and continue'}).click();}
  await firstChange('Wrong-Synthetic-2026');await visible('Your current password is incorrect.',mp);assert.equal(await mp.locator('[name=current_password]').getAttribute('aria-invalid'),'true');
  fault(rule('/rest/v1/rpc/complete_password_change'));await firstChange(temporary);
  const partial='Your password was changed, but your account could not be opened just now. Please sign in with your new password and finish the step again.';
  await visible(partial,mp);assert.equal((await mp.getByRole('alert').filter({hasText:partial}).textContent()).trim().endsWith(partial),true);await screenshot('first-password-partial',mp);assert(await mp.getByRole('button',{name:'Save password and continue'}).isEnabled());
  await memberContext.clearCookies();await login(mp,member.member_no,next);await mp.waitForURL(/change-password/);await firstChange(next,'SyntheticMember-2027');await mp.waitForURL(u=>!u.pathname.includes('change-password'),{timeout:60000});pass('First-login field error, complete partial message, new credential and successful redirect');
  await mp.goto(BASE+'/profile');await mp.locator('[name=current_password]').fill('Wrong-Synthetic-2026');await mp.locator('[name=password]').fill('SyntheticMember-2028');await mp.locator('[name=confirm]').fill('SyntheticMember-2028');await mp.getByRole('button',{name:'Change password',exact:true}).click();await visible('Your current password is incorrect.',mp);
  await mp.locator('[name=current_password]').fill('SyntheticMember-2027');await mp.locator('[name=password]').fill('SyntheticMember-2028');await mp.locator('[name=confirm]').fill('SyntheticMember-2028');fault(rule('/rest/v1/rpc/complete_password_change'));await mp.getByRole('button',{name:'Change password',exact:true}).click();await visible(partial,mp);await screenshot('profile-password-partial',mp);
  await mp.locator('[name=current_password]').fill('SyntheticMember-2028');await mp.locator('[name=password]').fill('SyntheticMember-2029');await mp.locator('[name=confirm]').fill('SyntheticMember-2029');await mp.getByRole('button',{name:'Change password',exact:true}).click();await visible('Your password has been changed. Use the new one next time you sign in.',mp);pass('Profile field errors, partial message and successful change');await memberContext.close();
  await page.goto(BASE+`/staff/members/${member.id}`);await openReset();fault();await page.getByRole('dialog').getByRole('button',{name:'Reset password',exact:true}).click();await visible('Password reset. It is shown only now.');assert.equal(await page.locator('[aria-label^="Temporary password "]').count(),1);await screenshot('reset-success');await page.getByRole('button',{name:'Done - I have given it to them'}).click();pass('Normal staff reset displays actual server message and password');
  }
  if(runs('notifications')) {
  await db.query("insert into notifications(user_id,title,body,kind) values($1,'Synthetic frontend notice','Disposable test only','info')",[admin.id]);
  await page.goto(BASE+'/staff/notifications');fault(rule('/rest/v1/rpc/mark_notifications_read','error','Synthetic notification update refused.'));
  await page.getByRole('button',{name:'Mark all read'}).click();await visible('Synthetic notification update refused.');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Mark all read')&&!e.disabled));assert(Number((await db.query('select count(*) from notifications where user_id=$1 and read_at is null',[admin.id])).rows[0].count)>0);await screenshot('notifications-error');
  fault();await page.getByRole('button',{name:'Mark all read'}).click();await visible('You are all caught up.');assert.equal(Number((await db.query('select count(*) from notifications where user_id=$1 and read_at is null',[admin.id])).rows[0].count),0);pass('Notification refusal remains unread; success refreshes count');
  }
  if(runs('reports')) {
  // Synthetic member scale fixture: no browser-side sums and no capped export.
  await db.query("insert into members(member_no,full_name,phone,status) select 'UIQA'||n,'Synthetic Register '||n,'+25679'||lpad(n::text,7,'0'),case when n%2=0 then 'active'::member_status else 'inactive'::member_status end from generate_series(1,1001) n where not exists(select 1 from members where member_no='UIQA'||n)");
  await page.goto(BASE+'/staff/reports/members');await visible('1,013');assert.equal(await page.locator('tbody tr').count(),251);await screenshot('register-page-1');
  await db.query('begin');await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:admin.id,role:'authenticated'})]);
  const t=(await db.query("select member_register_totals(null) as t")).rows[0].t;await db.query('rollback');
  const totalRow=await page.locator('tbody tr').last().textContent();for(const key of ['savings_balance','share_value','loan_balance'])assert(totalRow.includes(Number(t[key]).toLocaleString('en-UG')));
  await page.getByRole('link',{name:'Next',exact:true}).click();await visible('Showing 251–500');await screenshot('register-page-2');
  await page.locator('select[name=status]').selectOption('active');await page.getByRole('button',{name:'Apply filter'}).click();assert(!new URL(page.url()).searchParams.has('page'));await page.getByRole('link',{name:'Next',exact:true}).click();assert.match(page.url(),/status=active/);await visible('Showing 251–500');await screenshot('register-filtered');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download full CSV'}).click();const download=await downloadPromise;const csv=fs.readFileSync(await download.path(),'utf8');assert(csv.includes('UIQA1000'));const expected=Number((await db.query("select count(*) from members where status='active'")).rows[0].count);assert.equal(csv.trim().split(/\r?\n/).length,expected+1);assert(!csv.includes('EXPORT INCOMPLETE'));pass('Register >1,000 records, 250/page, totals, filter navigation and streamed CSV');
  await page.emulateMedia({media:'print'});await visible('This view and its printout contain only this page.');await page.pdf({path:`${OUT}/member-register-page-2.pdf`,format:'A4',landscape:true,printBackground:true});await page.emulateMedia({media:'screen'});
  }
  if(runs('finance')) {
  // Real postings through the existing action, with lost responses injected after commit.
  const cash=(await db.query("select id from financial_accounts where account_type='cash' and status='active' limit 1")).rows[0];assert(cash);
  async function collection(){fault();await page.goto(BASE+`/staff/finance/new/collection?member=${member.id}&type=deposit`);await page.locator('#collection-amount').fill('12500');await page.locator('#collection-account').selectOption(cash.id);return page.locator('[name=idempotency_key]').inputValue();}
  async function submit(){await page.getByRole('button',{name:'Review',exact:true}).click();await page.getByRole('button',{name:'Record collection',exact:true}).click();}
  let key=await collection();await submit();await visible('Collection recorded');let tx=(await db.query('select * from transactions where idempotency_key=$1',[key])).rows[0];assert(tx);await visible(tx.reference);assert.equal(await page.getByRole('link',{name:'View receipt'}).getAttribute('href'),`/staff/transactions/${tx.id}`);pass('Confirmed financial success shows actual reference and receipt link');
  key=await collection();fault(rule('/rest/v1/rpc/record_member_collection','error','Synthetic collection refused.'));await submit();await visible('Synthetic collection refused.');assert.equal(await page.locator('[name=idempotency_key]').inputValue(),key);assert.equal((await db.query('select id from transactions where idempotency_key=$1',[key])).rowCount,0);await submit();await visible('Collection recorded');assert.equal((await db.query('select id from transactions where idempotency_key=$1',[key])).rowCount,1);pass('Rejected collection keeps key and supports corrected manual retry');
  key=await collection();fault(rule('/rest/v1/rpc/record_member_collection','lost'));await submit();await visible('Transaction recorded');tx=(await db.query('select * from transactions where idempotency_key=$1',[key])).rows[0];assert(tx);await visible(tx.reference);await screenshot('financial-recovered-posted');assert.equal(await page.getByRole('link',{name:'View transaction / receipt'}).getAttribute('href'),`/staff/transactions/${tx.id}`);pass('Lost posting response resolved by real submission_status reference');
  key=await collection();fault(rule('/rest/v1/rpc/record_member_collection','error','Network response lost'));await submit();await visible('No transaction was found');assert.equal((await db.query('select id from transactions where idempotency_key=$1',[key])).rowCount,0);await screenshot('financial-not-found');await page.getByRole('button',{name:'Review same submission'}).click();assert.equal(await page.locator('[name=idempotency_key]').inputValue(),key);await submit();await visible('Collection recorded');pass('Verified absence never auto-posts; manual retry retains key');
  key=await collection();fault(rule('/rest/v1/rpc/record_member_collection','lost'),rule('/rest/v1/rpc/submission_status'));await submit();await visible('We could not verify whether this submission was recorded.');assert.equal(await page.getByRole('button',{name:'Review same submission'}).count(),0);await screenshot('financial-uncertain');assert.equal((await db.query('select id from transactions where idempotency_key=$1',[key])).rowCount,1);
  tx=(await db.query('select * from transactions where idempotency_key=$1',[key])).rows[0];await db.query('begin');await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:admin.id,role:'authenticated'})]);await db.query("select reverse_transaction($1,'Synthetic frontend verification reversal')",[tx.id]);await db.query('commit');
  fault();await page.getByRole('button',{name:'Verify again'}).click();await visible('Transaction reversed');await visible(tx.reference);assert.equal(await page.getByRole('button',{name:'Review same submission'}).count(),0);await screenshot('financial-reversed');pass('Failed verification retains uncertainty; real reversal is explained without repost');
  // A deliberate same-key retry via the real RPC returns the same transaction.
  const client=await import('@supabase/supabase-js');const sb=client.createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});await sb.auth.signInWithPassword({email:process.env.STAFF_EMAIL,password:process.env.STAFF_PASSWORD});
  const params={p_member_id:member.id,p_collection_type:'deposit',p_amount:5000,p_account_id:cash.id,p_method:'cash',p_paid_on:new Date().toISOString().slice(0,10),p_idempotency_key:'frontend-same-key-'+Date.now()};
  const one=await sb.rpc('record_member_collection',params);assert.ifError(one.error);const two=await sb.rpc('record_member_collection',params);assert.ifError(two.error);assert.equal(one.data.transaction_id,two.data.transaction_id);assert.equal(one.data.reference,two.data.reference);pass('Real financial RPC same-key retry returns original id/reference');
  fault();await page.goto(BASE+'/staff/finance/new/expense');
  const category=(await page.locator('#expense-category option').evaluateAll(es=>es.find(e=>e.value&&!/Other/i.test(e.textContent))?.value));assert(category);
  await page.locator('#expense-category').selectOption(category);await page.locator('#expense-amount').fill('1000');await page.locator('#expense-description').fill('Synthetic uncertain approval request');await page.locator('#expense-account').selectOption(cash.id);
  const requestKey=await page.locator('[name=idempotency_key]').inputValue();fault(rule('/rest/v1/rpc/record_expense','lost'));
  await page.getByRole('button',{name:'Review',exact:true}).click();await page.getByRole('button',{name:'Submit for approval',exact:true}).click();await visible('This does not tell us whether your request or draft was saved.');assert.equal(await page.getByRole('button',{name:'Review same submission'}).count(),0);assert.equal((await db.query('select id from expense_entries where idempotency_key=$1',[requestKey])).rowCount,1);assert.equal(await page.getByRole('link',{name:'Check request list'}).getAttribute('href'),'/staff/finance/expenses');await screenshot('financial-request-uncertain');pass('Lost approval-request response is not misreported as unrecorded or offered for repost');
  }
  assert.deepEqual(errors,[]);pass('No browser runtime errors');
} catch (error) {
  await screenshot('integration-failure').catch(() => {});
  throw error;
} finally {
  fault();fs.writeFileSync(`${OUT}/${scope}-results.json`,JSON.stringify({passed:results,errors},null,2));await browser.close();await db.end();
}
