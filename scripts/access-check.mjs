/**
 * Browser check for sign-in, roles, members, registration and fees.
 *
 *   node scripts/access-check.mjs [baseUrl] [memberNo] [memberPhone]
 *
 * Signs in on the Staff tab and loads every screen this work touches, then
 * signs in on the Member tab with a member number and phone and checks that
 * the member sees their own read-only profile and cannot reach the back
 * office. Every page is checked at 390px and 1440px for errors and sideways
 * scrolling, and screenshotted to screenshots/access/.
 *
 * It reads and navigates only. It does not register members, create fees or
 * record payments: those write permanent records (by design they cannot be
 * deleted), so they are proved by supabase/tests/members_access_test.sql,
 * which runs them inside a transaction that is rolled back.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const MEMBER_NO = process.argv[3] ?? process.env.MEMBER_NO;
const MEMBER_PHONE = process.argv[4] ?? process.env.MEMBER_PHONE;
const EMAIL = process.env.STAFF_EMAIL ?? 'trevor@gmail.com';
const PASSWORD = process.env.STAFF_PASSWORD ?? 'Admin@123';
const OUT = 'screenshots/access';

const STAFF_ROUTES = [
  '/staff/members',
  '/staff/members/new',
  '/staff/users',
  '/staff/roles',
  '/staff/roles?role=cashier',
  '/staff/roles?role=member',
  '/staff/roles?role=super_admin',
  '/staff/settings?section=fees',
  '/staff/settings?section=members',
  '/staff/settings?section=security',
  '/staff/settings?section=users',
  '/staff/profile',
  '/staff/audit',
];

const MEMBER_ROUTES = ['/', '/profile', '/savings', '/shares', '/loans', '/transactions', '/statements'];
const MEMBER_FORBIDDEN = ['/staff', '/staff/users', '/staff/roles', '/staff/settings', '/staff/audit', '/staff/members'];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let failures = 0;

async function check(page, route, width, errors, label) {
  errors.length = 0;
  const res = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(250);
  const status = res?.status() ?? 0;
  const finalUrl = page.url().replace(BASE, '');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const errorText = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/(Application error[^\n]*|Unhandled Runtime Error[^\n]*|Unable to load[^\n]*|Something went wrong[^\n]*)/i);
    return m ? m[0] : null;
  });
  const bad = status >= 400 || overflow > 1 || !!errorText || errors.length > 0;
  if (bad) failures += 1;
  const name = `${label}-${route.replace(/[/?=&]+/g, '_').replace(/^_/, '') || 'root'}-${width}`;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(
    `${bad ? '✖' : '✔'} ${label} ${width} ${route} -> ${status}${finalUrl !== route ? ` (→ ${finalUrl})` : ''}` +
      `${overflow > 1 ? ` overflow ${overflow}px` : ''}${errorText ? ` "${errorText}"` : ''}` +
      `${errors.length ? ` console: ${errors.slice(0, 2).join(' | ')}` : ''}`,
  );
  return { status, finalUrl, page };
}

for (const width of [390, 1440]) {
  /* ------------------------------------------------------------- staff */
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.click('button[role="tab"]:has-text("Staff")');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/staff/, { timeout: 60_000 });

  for (const route of STAFF_ROUTES) await check(page, route, width, errors, 'staff');

  // The wizard validates before moving on: an empty step 1 stays put and
  // names the fields.
  await page.goto(`${BASE}/staff/members/new`, { waitUntil: 'load' });
  await page.click('button:has-text("Continue")');
  const stayed = await page.locator('text=Enter the member’s full name').count();
  if (!stayed) failures += 1;
  console.log(`${stayed ? '✔' : '✖'} staff ${width} registration step 1 refuses an empty form`);

  await page.fill('#full_name', 'Wizard Check Person');
  await page.fill('#phone', '0123');
  await page.click('button:has-text("Continue")');
  const badPhone = await page.locator('text=Enter a valid Ugandan mobile number').count();
  if (!badPhone) failures += 1;
  console.log(`${badPhone ? '✔' : '✖'} staff ${width} registration refuses an invalid phone`);
  await ctx.close();

  /* ------------------------------------------------------------ member */
  if (!MEMBER_NO || !MEMBER_PHONE) continue;
  const mctx = await browser.newContext({ viewport: { width, height: 900 } });
  const mpage = await mctx.newPage();
  const merrors = [];
  mpage.on('pageerror', (e) => merrors.push(e.message));
  mpage.on('console', (m) => { if (m.type() === 'error') merrors.push(m.text()); });

  await mpage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await mpage.fill('input[name="member_no"]', MEMBER_NO);
  await mpage.fill('input[name="phone"]', MEMBER_PHONE);
  await mpage.click('button[type="submit"]');
  await mpage.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  console.log(`✔ member ${width} signed in with member number + phone → ${mpage.url().replace(BASE, '')}`);

  for (const route of MEMBER_ROUTES) await check(mpage, route, width, merrors, 'member');

  const editButtons = await (async () => {
    await mpage.goto(`${BASE}/profile`, { waitUntil: 'load' });
    return mpage.locator('text=/Edit Profile|Save changes|Change password/i').count();
  })();
  if (editButtons) failures += 1;
  console.log(`${editButtons ? '✖' : '✔'} member ${width} profile has no edit or password controls`);

  for (const route of MEMBER_FORBIDDEN) {
    await mpage.goto(`${BASE}${route}`, { waitUntil: 'load' });
    // The staff area streams its loading skeleton before the guard's redirect
    // lands, so wait for the redirect rather than reading the first URL.
    await mpage.waitForURL((u) => !u.pathname.startsWith('/staff'), { timeout: 15_000 }).catch(() => {});
    const landed = mpage.url().replace(BASE, '');
    const staffChrome = await mpage.locator('text=/Roles & Permissions|Audit Log|Add staff account/').count();
    const blocked = !landed.startsWith('/staff') && staffChrome === 0;
    if (!blocked) failures += 1;
    console.log(`${blocked ? '✔' : '✖'} member ${width} cannot open ${route} (→ ${landed})`);
  }
  await mctx.close();
}

await browser.close();
console.log(`\n${failures} problem(s)`);
process.exit(failures ? 1 : 0);
