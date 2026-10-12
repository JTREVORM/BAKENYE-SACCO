/** Local browser regression checks for member registration, editing and login.
 * STAFF_EMAIL=... STAFF_PASSWORD=... [CHROME_PATH=...] node scripts/phone-check.mjs [url]
 * Creates four local test members with deferred fees and generated passwords,
 * then archives them and disables their logins in finally. History is retained.
 * Never run against production; both the application and DB must be loopback.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import pg from 'pg';
for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const local = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
assert(local(new URL(BASE).hostname) && process.env.DATABASE_URL && local(new URL(process.env.DATABASE_URL).hostname),
  'Run phone browser checks against a local application and database only.');
assert(process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD, 'Provide local staff credentials.');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const marker = randomUUID();
const password = randomBytes(24).toString('base64url');
const fixtures = [
  { country: 'Uganda', raw: '0779900101', phone: '+256779900101' },
  { country: 'Canada', raw: '+1 (416) 555-0101', phone: '+14165550101' },
  { country: 'UK', raw: '+44 20 7946 0101', phone: '+442079460101' },
  { country: 'Kenya', raw: '+254 712 123401', phone: '+254712123401' },
];
const oldPhones = (await db.query('select id,member_no,phone,next_of_kin_phone from members order by id')).rows;
const fundsBefore = (await db.query('select sum(balance) as balance from financial_account_balances')).rows[0].balance;
const admin = (await db.query("select u.id from app_users u join auth.users a on a.id=u.id where a.email=$1 and u.role='super_admin' and u.is_active",
  [process.env.STAFF_EMAIL])).rows[0];
assert(admin, 'Use a local test super administrator.');
const claim = JSON.stringify({ sub: admin.id, role: 'authenticated' });
let browser;
let checks = 0;
function pass(label) { checks += 1; console.log(`PASS ${label}`); }
async function signIn(page, identifier, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('[name=identifier]', identifier);
  await page.fill('[name=password]', secret);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}
try {
  for (const fixture of fixtures) {
    assert.equal((await db.query("select count(*) from members where phone=$1 and status not in ('archived','exited')", [fixture.phone])).rows[0].count, '0',
      'Test phone is already assigned to a live member; do not alter that member.');
    await db.query("select set_config('request.jwt.claims',$1,false)", [claim]);
    await db.query('set role authenticated');
    const profile = { full_name: `Phone Browser ${fixture.country} ${marker}`, phone: fixture.raw,
      next_of_kin_name: 'Test Relative', next_of_kin_relation: 'Sibling', next_of_kin_phone: '+44 20 7946 0199' };
    const result = (await db.query('select register_member($1::jsonb,p_registration_key=>$2) as result',
      [JSON.stringify(profile), `phone-browser:${marker}:${fixture.country}`])).rows[0].result;
    fixture.id = result.member_id;
    await db.query('reset role');
    const member = (await db.query('select member_no,phone from members where id=$1', [fixture.id])).rows[0];
    fixture.memberNo = member.member_no;
    assert.equal(member.phone, fixture.phone);
    fixture.userId = randomUUID();
    await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,
      crypt($3,gen_salt('bf')),now(),$4::jsonb,$5::jsonb,now(),now())`,
    [fixture.userId, `${member.member_no.toLowerCase()}@members.bnd-sacco.invalid`, password,
      JSON.stringify({ member_id: fixture.id }), JSON.stringify({ full_name: profile.full_name })]);
    await db.query('update app_users set must_change_password=false,password_set_at=now() where id=$1', [fixture.userId]);
    pass(`${fixture.country}: member creation stores the normalized international phone`);
  }
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const staff = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await signIn(staff, process.env.STAFF_EMAIL, process.env.STAFF_PASSWORD);
  for (const fixture of fixtures) {
    await staff.goto(`${BASE}/staff/members/new`, { waitUntil: 'networkidle' });
    await staff.fill('#full_name', 'International Registration Test');
    await staff.fill('#phone', '+999123456789');
    await staff.getByRole('button', { name: 'Continue', exact: true }).click();
    await staff.getByText(/Enter a valid Uganda number or an international number starting with \+/).waitFor();
    await staff.fill('#phone', fixture.raw);
    await staff.getByRole('button', { name: 'Continue', exact: true }).click();
    await staff.locator('nav[aria-label="Registration steps"]').getByText(/Step 2 of 4/).waitFor();
    pass(`${fixture.country}: registration form accepts a valid number and rejects an invalid country code`);
  }
  const canada = fixtures.find((f) => f.country === 'Canada');
  const uk = fixtures.find((f) => f.country === 'UK');
  await staff.goto(`${BASE}/staff/members/${canada.id}/edit`, { waitUntil: 'networkidle' });
  assert.equal(await staff.locator('#phone').inputValue(), canada.phone);
  pass('editing displays an international number with its plus and country code');
  await staff.fill('#reason', 'International phone browser validation test');
  await staff.fill('#phone', '+999123456789');
  await staff.getByRole('button', { name: 'Save changes', exact: true }).click();
  await staff.getByText(/Enter a valid Uganda number or an international number starting with \+/).waitFor();
  assert.equal((await db.query('select phone from members where id=$1', [canada.id])).rows[0].phone, canada.phone);
  pass('server-side editing validation refuses an invalid international number');
  await staff.fill('#phone', uk.raw);
  await staff.fill('#reason', 'International phone duplicate browser test');
  await staff.getByRole('button', { name: 'Save changes', exact: true }).click();
  try {
    await staff.getByText(/already the phone number of/).waitFor();
  } catch (error) {
    console.error('Visible validation messages:', await staff.locator('p.text-error').allTextContents());
    throw error;
  }
  assert.equal((await db.query('select phone from members where id=$1', [canada.id])).rows[0].phone, canada.phone);
  pass('editing detects a duplicate international number despite different formatting');
  await staff.fill('#phone', '+1 (416) 555-0102');
  await staff.fill('#next_of_kin_phone', '+254 712 123499');
  await staff.fill('#reason', 'International phone update browser test');
  await staff.getByRole('button', { name: 'Save changes', exact: true }).click();
  await staff.getByText('Member record updated', { exact: true }).waitFor();
  const edited = (await db.query('select phone,next_of_kin_phone,member_no from members where id=$1', [canada.id])).rows[0];
  assert.equal(edited.phone, '+14165550102');
  assert.equal(edited.next_of_kin_phone, '+254712123499');
  assert.equal(edited.member_no, canada.memberNo);
  assert.equal((await db.query('select phone from app_users where id=$1', [canada.userId])).rows[0].phone, edited.phone);
  canada.phone = edited.phone; canada.raw = '+1 (416) 555-0102';
  pass('editing normalizes member, account and next-of-kin phones and keeps the member number');
  for (const fixture of fixtures) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await signIn(page, fixture.raw, password);
    assert(!new URL(page.url()).pathname.startsWith('/staff'));
    assert((await db.query('select last_login_at from app_users where id=$1', [fixture.userId])).rows[0].last_login_at);
    pass(`${fixture.country}: unified login accepts the member's phone and unchanged password`);
    await page.context().close();
  }
  const uganda = fixtures.find((f) => f.country === 'Uganda');
  const ug = await browser.newPage();
  await signIn(ug, uganda.phone, password);
  pass('Uganda members can still log in with their existing +256 number');
  await ug.context().close();
  const legacy = await browser.newPage();
  await signIn(legacy, canada.memberNo.toLowerCase(), password);
  pass('member-number login is preserved after an international phone edit');
  await legacy.context().close();
} finally {
  try {
    await db.query('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [claim]);
    await db.query('set role authenticated');
    for (const fixture of fixtures.filter((f) => f.id)) {
      await db.query("select set_member_status($1,'archived',$2)", [fixture.id, 'Local phone browser test cleanup']);
    }
    await db.query('reset role');
    await db.query('update app_users set is_active=false where id=any($1::uuid[])', [fixtures.filter((f) => f.userId).map((f) => f.userId)]);
    const current = (await db.query('select id,member_no,phone,next_of_kin_phone from members where id=any($1::uuid[]) order by id',
      [oldPhones.map((m) => m.id)])).rows;
    assert.deepEqual(current, oldPhones);
    assert.equal((await db.query('select sum(balance) as balance from financial_account_balances')).rows[0].balance, fundsBefore);
  } finally {
    if (browser) await browser.close();
    await db.end();
  }
}
console.log(`${checks} phone browser checks passed; fixtures were archived, logins disabled, existing phone records and ledger balances unchanged.`);
