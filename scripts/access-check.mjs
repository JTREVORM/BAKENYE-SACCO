/**
 * Browser check for the unified sign-in, role dashboards and access control.
 *
 *   node scripts/access-check.mjs [baseUrl]
 *
 * Configuration comes from the environment, so no credential is written into
 * this file beyond the local development defaults:
 *
 *   STAFF_EMAIL, STAFF_PASSWORD   a staff account to test with (required)
 *   STAFF_HOME                    where that account should land (default /staff/admin)
 *   STAFF_PHONE                   optional - also sign that account in by phone
 *   MEMBER_NO, MEMBER_PHONE,
 *   MEMBER_PASSWORD               optional - a member account to check
 *   MEMBER_NEW_PASSWORD           optional - also change the member's password,
 *                                 prove old/new, then change it back
 *   EXPECT_SUSPENDED=1            only check that the member is refused as suspended
 *
 * Every signed-in page is loaded at 390px and 1440px and checked for errors and
 * sideways scrolling; screenshots go to screenshots/access/.
 *
 * It does not register members or record payments: those write permanent
 * records by design, so they are proved by supabase/tests/members_access_test.sql
 * inside a transaction that is rolled back.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const env = process.env;
const STAFF_EMAIL = env.STAFF_EMAIL;
const STAFF_PASSWORD = env.STAFF_PASSWORD;
if (!STAFF_EMAIL || !STAFF_PASSWORD) { console.error('Set STAFF_EMAIL and STAFF_PASSWORD to a staff account to test with.'); process.exit(1); }
const STAFF_HOME = env.STAFF_HOME ?? '/staff/admin';
const OUT = 'screenshots/access';
const INVALID = 'Invalid login credentials. Please check your identifier and password.';

const STAFF_ROUTES = [
  '/staff/admin', '/staff', '/staff/desk', '/staff/loans-desk', '/staff/members', '/staff/members/new',
  '/staff/users', '/staff/roles', '/staff/roles?role=cashier', '/staff/settings?section=security',
  '/staff/finance', '/staff/savings', '/staff/loans', '/staff/transactions', '/staff/reports',
  '/staff/audit', '/staff/profile',
];
const MEMBER_ROUTES = ['/', '/profile', '/savings', '/shares', '/loans', '/transactions', '/statements', '/notifications'];
const MEMBER_FORBIDDEN = ['/admin', '/staff', '/staff/users', '/staff/roles', '/staff/settings', '/staff/audit', '/staff/members', '/staff/finance'];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
let failures = 0;
const ok = (pass, text) => {
  if (!pass) failures += 1;
  console.log(`${pass ? '✔' : '✖'} ${text}`);
};

async function signIn(page, identifier, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const tabs = await page.locator('[role="tab"]').count();
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  return { landed: new URL(page.url()).pathname, tabs };
}

async function signOut(page) {
  const form = page.locator('form[action="/auth/signout"]').first();
  if (await form.count()) {
    await form.evaluate((f) => f.requestSubmit());
  } else {
    await page.evaluate(async () => {
      const r = await fetch('/auth/signout', { method: 'POST' });
      return r.status;
    });
  }
  await page.waitForURL(/\/login/, { timeout: 30_000 }).catch(() => {});
}

async function check(page, route, width, errors, label) {
  errors.length = 0;
  const res = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  const status = res?.status() ?? 0;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const errorText = await page.evaluate(() => {
    const m = document.body.innerText.match(/(Application error[^\n]*|Unhandled Runtime Error[^\n]*|Unable to load[^\n]*|Something went wrong[^\n]*)/i);
    return m ? m[0] : null;
  });
  const bad = status >= 400 || overflow > 1 || !!errorText || errors.length > 0;
  const name = `${label}-${route.replace(/[/?=&]+/g, '_').replace(/^_/, '') || 'root'}-${width}`;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  ok(!bad, `${label} ${width} ${route} -> ${status}${overflow > 1 ? ` overflow ${overflow}px` : ''}${errorText ? ` "${errorText}"` : ''}${errors.length ? ` console: ${errors.slice(0, 2).join(' | ')}` : ''}`);
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}

/* ------------------------------------------------------ suspended member */
if (env.EXPECT_SUSPENDED) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await ctx.newPage();
  const { landed } = await signIn(page, env.MEMBER_NO, env.MEMBER_PASSWORD);
  const msg = await page.locator('text=Your account is currently suspended').count();
  ok(landed === '/login' && msg > 0, `suspended member is refused with the suspension message (stayed on ${landed})`);
  await ctx.close();
  await browser.close();
  console.log(`\n${failures} problem(s)`);
  process.exit(failures ? 1 : 0);
}

for (const width of [390, 1440]) {
  /* ------------------------------------------------------------- staff */
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = trackErrors(page);

  // Wrong password: generic message, no hint whether the identifier exists.
  await signIn(page, STAFF_EMAIL, 'definitely-not-the-password-1');
  ok((await page.locator(`text=${INVALID}`).count()) > 0 && new URL(page.url()).pathname === '/login',
    `${width} a wrong password gets the generic message`);
  await signIn(page, 'BND99998', 'definitely-not-the-password-1');
  ok((await page.locator(`text=${INVALID}`).count()) > 0, `${width} an unknown member number gets exactly the same message`);

  const s = await signIn(page, STAFF_EMAIL, STAFF_PASSWORD);
  ok(s.tabs === 0, `${width} the login page has one form - no Member/Staff selector`);
  ok(s.landed === STAFF_HOME, `${width} staff signs in and lands on their role dashboard (${s.landed})`);

  for (const route of STAFF_ROUTES) await check(page, route, width, errors, 'staff');

  if (env.STAFF_PHONE) {
    await signOut(page);
    const p = await signIn(page, env.STAFF_PHONE, STAFF_PASSWORD);
    ok(p.landed === STAFF_HOME, `${width} the same staff account signs in with its phone ${env.STAFF_PHONE} (${p.landed})`);
  }
  await signOut(page);
  await ctx.close();

  /* ------------------------------------------------------------ member */
  if (!env.MEMBER_NO || !env.MEMBER_PASSWORD) continue;
  const mctx = await browser.newContext({ viewport: { width, height: 900 } });
  const m = await mctx.newPage();
  const merrors = trackErrors(m);

  const byNo = await signIn(m, env.MEMBER_NO, env.MEMBER_PASSWORD);
  ok(byNo.landed === '/', `${width} member signs in with member number ${env.MEMBER_NO} → ${byNo.landed}`);
  await signOut(m);

  if (env.MEMBER_PHONE) {
    const byPhone = await signIn(m, env.MEMBER_PHONE, env.MEMBER_PASSWORD);
    ok(byPhone.landed === '/', `${width} the same member signs in with phone ${env.MEMBER_PHONE} → ${byPhone.landed}`);
  } else {
    await signIn(m, env.MEMBER_NO, env.MEMBER_PASSWORD);
  }

  for (const route of MEMBER_ROUTES) await check(m, route, width, merrors, 'member');

  await m.goto(`${BASE}/profile`, { waitUntil: 'load' });
  ok((await m.locator('text=/Edit Profile|Edit Member/i').count()) === 0, `${width} member profile has no edit button`);
  ok((await m.locator('text=Your SACCO profile is managed by authorized SACCO staff.').count()) > 0, `${width} member profile says staff manage it`);
  ok((await m.locator('input[name="current_password"]').count()) > 0, `${width} member can reach Change password`);

  const nav = await m.locator('text=/Roles & Permissions|Audit Log|Add staff account|Finance/').count();
  ok(nav === 0, `${width} member sees no staff navigation`);

  for (const route of MEMBER_FORBIDDEN) {
    await m.goto(`${BASE}${route}`, { waitUntil: 'load' });
    await m.waitForURL((u) => !u.pathname.startsWith('/staff') && !u.pathname.startsWith('/admin'), { timeout: 15_000 }).catch(() => {});
    const landed = new URL(m.url()).pathname;
    const staffChrome = await m.locator('text=/Roles & Permissions|Audit Log|Add staff account/').count();
    ok(!landed.startsWith('/staff') && !landed.startsWith('/admin') && staffChrome === 0, `${width} member cannot open ${route} (→ ${landed})`);
  }

  // Password change: new works, old does not, the record is untouched - then back.
  if (env.MEMBER_NEW_PASSWORD && width === 390) {
    const change = async (from, to) => {
      await m.goto(`${BASE}/profile`, { waitUntil: 'load' });
      await m.fill('input[name="current_password"]', from);
      await m.fill('input[name="password"]', to);
      await m.fill('input[name="confirm"]', to);
      await m.locator('form:has(input[name="current_password"]) button[type="submit"]').click();
      await m.waitForSelector('text=Your password has been changed', { timeout: 30_000 }).catch(() => {});
      return (await m.locator('text=Your password has been changed').count()) > 0;
    };
    ok(await change(env.MEMBER_PASSWORD, env.MEMBER_NEW_PASSWORD), 'member changed their password');
    await signOut(m);
    const old = await signIn(m, env.MEMBER_NO, env.MEMBER_PASSWORD);
    ok(old.landed === '/login', 'the old password no longer works');
    const neu = await signIn(m, env.MEMBER_NO, env.MEMBER_NEW_PASSWORD);
    ok(neu.landed === '/', 'the new password works');
    ok(await change(env.MEMBER_NEW_PASSWORD, env.MEMBER_PASSWORD), 'password changed back for the next run');
  }

  // Sign out, then Back and a direct visit both end at the sign-in page.
  await m.goto(`${BASE}/profile`, { waitUntil: 'load' });
  await signOut(m);
  ok(new URL(m.url()).pathname === '/login', `${width} sign-out lands on the sign-in page`);
  await m.goBack().catch(() => {});
  await m.waitForLoadState('load').catch(() => {});
  await m.reload({ waitUntil: 'load' }).catch(() => {});
  const afterBack = new URL(m.url()).pathname;
  const leaked = await m.locator('text=Your SACCO profile is managed').count();
  ok(afterBack === '/login' && leaked === 0, `${width} Back after sign-out shows no protected page (→ ${afterBack})`);
  await mctx.close();
}

await browser.close();
console.log(`\n${failures} problem(s)`);
process.exit(failures ? 1 : 0);
