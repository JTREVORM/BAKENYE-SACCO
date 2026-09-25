/**
 * Browser checks for the Membership Fees module (0045), against a running
 * application and a seeded database.
 *
 *   STAFF_EMAIL=... STAFF_PASSWORD=... node scripts/membership-fee-check.mjs
 *
 * It reads screens only. It opens the Collect dialog to prove it renders, and
 * deliberately does not submit it: no money is recorded by this script.
 */
import { chromium } from 'playwright';
const B = process.argv[2] ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.STAFF_EMAIL;
const PASSWORD = process.env.STAFF_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Set STAFF_EMAIL and STAFF_PASSWORD to a staff account to test with.');
  process.exit(1);
}
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const checks = [];
const add = (ok, label, detail = '') => checks.push([ok, label, detail]);
const errs = [];

const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${B}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="identifier"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(1500);

const seen = async () => ((await page.locator('main').count())
  ? await page.locator('main').innerText()
  : await page.locator('body').innerText()).replace(/\s+/g, ' ');

// Sidebar
let body = await seen();
const nav = (await page.locator('nav, aside').first().innerText()).replace(/\s+/g, ' ');
add(/Members[\s\S]*Membership Fees[\s\S]*Savings/.test(nav),
    'sidebar lists Membership Fees between Members and Savings');

// The module
const res = await page.goto(`${B}/staff/membership-fees`, { waitUntil: 'networkidle', timeout: 60000 });
add(res?.status() === 200, 'the Membership Fees page loads', String(res?.status()));
body = await seen();
for (const card of ['Collected in total', 'Collected this month', 'Collected today',
                    'Fully paid', 'Part paid', 'Unpaid', 'Membership fee to join today']) {
  add(body.includes(card), `card: ${card}`);
}
add(/UGX 20,000/.test(body), 'the current membership fee reads UGX 20,000');

// The three states from the seed
add(/BND26010/.test(body) && /BND26012/.test(body), 'part-paid and unpaid members are listed');
add(/15,000/.test(body), 'a 5,000 payment against 20,000 shows 15,000 outstanding',
    /15,000/.test(body) ? 'found' : 'not found');

// Filters
await page.goto(`${B}/staff/membership-fees?status=unpaid`, { waitUntil: 'networkidle' });
body = await seen();
add(/BND26012/.test(body) && !/BND26001\b/.test(body), 'the Unpaid filter narrows the list');

await page.goto(`${B}/staff/membership-fees?status=partial`, { waitUntil: 'networkidle' });
body = await seen();
add(/BND26010/.test(body) && /BND26011/.test(body), 'the Part paid filter narrows the list');

await page.goto(`${B}/staff/membership-fees?q=BND26012`, { waitUntil: 'networkidle' });
body = await seen();
add(/BND26012/.test(body) && !/BND26010/.test(body), 'search by member number works');

// Collect dialog (opened, not submitted - no test money in the demo ledger)
await page.goto(`${B}/staff/membership-fees?status=partial`, { waitUntil: 'networkidle' });
// The Button component renders a Material icon ligature before the label, so
// the accessible text reads "payments Collect" - match the label, not the whole.
const collect = page.locator('button:visible', { hasText: /Collect/ }).first();
add(await collect.count() > 0, 'a member with a balance offers Collect');
if (await collect.count()) {
  await collect.click();
  await page.waitForTimeout(900);
  // The mobile navigation drawer is also a role=dialog, so match the visible
  // one rather than the first in the DOM.
  const dlg = (await page.locator('[role="dialog"]:visible, dialog:visible').last().innerText()).replace(/\s+/g, ' ');
  add(/Collect membership fee/.test(dlg), 'the collect dialog opens');
  add(/Required/.test(dlg) && /Already paid/.test(dlg) && /Balance/.test(dlg),
      'the dialog shows required, paid and balance');
  add(/Part payments are fine/.test(dlg), 'the dialog says part payments are accepted');
  await page.keyboard.press('Escape');
}

// Member profile card
await page.goto(`${B}/staff/membership-fees?q=BND26010`, { waitUntil: 'networkidle' });
const href = await page.locator('a[href^="/staff/members/"]').first().getAttribute('href');
await page.goto(`${B}${href}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(800);
body = await seen();
add(/Membership fee/.test(body), 'the member profile shows a Membership fee card');
add(/Required/.test(body) && /Total paid/.test(body) && /Outstanding/.test(body),
    'the card shows required, total paid and outstanding');
add(/Payment history/.test(body), 'the card shows the payment history');

// Reports index
await page.goto(`${B}/staff/reports`, { waitUntil: 'networkidle' });
body = await seen();
add(/Membership fees/.test(body), 'the reports index lists Membership fees');

await ctx.close();

// Mobile
const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await m.newPage();
p2.on('pageerror', (e) => errs.push(e.message));
await p2.goto(`${B}/login`, { waitUntil: 'domcontentloaded' });
await p2.fill('input[name="identifier"]', EMAIL);
await p2.fill('input[type="password"]', PASSWORD);
await Promise.all([
  p2.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}),
  p2.click('button[type="submit"]'),
]);
await p2.goto(`${B}/staff/membership-fees`, { waitUntil: 'networkidle' });
const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
add(overflow <= 1, 'no sideways scroll at 390px', `${overflow}px`);
await m.close();
await browser.close();

let bad = 0;
for (const [ok, label, detail] of checks) { if (!ok) bad++; console.log(`${ok ? '✔' : '✖'} ${label}${detail ? ` — ${detail}` : ''}`); }
if (errs.length) { console.log('\npage errors:'); [...new Set(errs)].slice(0, 5).forEach((e) => console.log('  ' + e)); }
console.log(`\n${checks.length - bad}/${checks.length} passed`);
process.exit(bad ? 1 : 0);
