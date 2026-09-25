/**
 * Recapture the screenshots the 2026 business-rule change made wrong.
 *
 *   ADMIN_ID=… ADMIN_PW=… MEMBER_ID=… MEMBER_PW=… \
 *   node documentation/source/recapture-2026-rules.mjs
 *
 * Only the screens that actually changed: the ones that showed a savings
 * category, a monthly target, arrears, or a share tier. Everything else in the
 * manuals is still a true picture of the system and is left alone.
 *
 * Runs against the LOCAL documentation stack, never the SACCO's live system.
 */
import { openBrowser, newPage, signIn, settle, shot, BASE, DESKTOP, PHONE } from './lib.mjs';

const ADMIN_ID = process.env.ADMIN_ID;
const ADMIN_PW = process.env.ADMIN_PW;
const MEMBER_ID = process.env.MEMBER_ID;
const MEMBER_PW = process.env.MEMBER_PW;

const browser = await openBrowser();
const log = [];

async function walk(id, pw, viewport, routes) {
  const { context, page } = await newPage(browser, viewport);
  const landed = await signIn(page, id, pw);
  console.log(`signed in as ${id} -> ${landed}`);
  for (const [route, folder, name, opts = {}] of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await settle(page, 900);
    await shot(page, folder, name, opts);
    log.push({ route, file: `${folder}/${name}.png`, finalUrl: page.url().replace(BASE, '') });
  }
  return { context, page };
}

/* ------------------------------------------------------------------ staff */
const staffRoutes = [
  ['/staff', 'admin', 'walk-dash-overview', { fullPage: true }],
  ['/staff/admin', 'admin', 'walk-dash-administration', { fullPage: true }],
  ['/staff/savings', 'admin', 'walk-savings', { fullPage: true }],
  ['/staff/savings/records', 'admin', 'walk-savings-records', { fullPage: true }],
  ['/staff/savings/performance', 'admin', 'walk-savings-performance', { fullPage: true }],
  ['/staff/savings/collect', 'admin', 'walk-savings-collect'],
  ['/staff/savings/record', 'admin', 'walk-savings-record'],
  ['/staff/shares', 'admin', 'walk-shares', { fullPage: true }],
  ['/staff/shares/sell', 'admin', 'walk-shares-sell'],
  ['/staff/members', 'admin', 'walk-members-list', { fullPage: true }],
  ['/staff/members/new', 'admin', 'walk-members-new'],
  ['/staff/settings', 'admin', 'walk-settings', { fullPage: true }],
  ['/staff/reports', 'admin', 'walk-reports', { fullPage: true }],
  ['/staff/desk', 'staff', 'cashier-01-desk', { fullPage: true }],
  ['/staff/savings/collect', 'staff', 'cashier-02-collect'],
  ['/staff/savings/record', 'staff', 'cashier-03-record-savings'],
  ['/staff/shares/sell', 'staff', 'cashier-04-sell-shares'],
  ['/staff/savings/collect', 'staff', 'fo-01-collections'],
  ['/staff/savings/records', 'staff', 'fo-03-schedules', { fullPage: true }],
  ['/staff', 'staff', 'mgr-01-overview', { fullPage: true }],
  ['/staff/savings/records', 'staff', 'mgr-04-schedules', { fullPage: true }],
  ['/staff/savings/performance', 'staff', 'mgr-05-performance', { fullPage: true }],
  ['/staff/reports', 'staff', 'report-01-index', { fullPage: true }],
  ['/staff/savings/performance', 'staff', 'report-08-savings-performance', { fullPage: true }],
];

const { context: staffCtx, page } = await walk(ADMIN_ID, ADMIN_PW, DESKTOP, staffRoutes);

/* ------------------------------------------------- the registration wizard */
await page.goto(`${BASE}/staff/members/new`, { waitUntil: 'domcontentloaded' });
await settle(page, 800);
await shot(page, 'staff', 'register-01-step1-empty');

await page.locator('#full_name').fill('Nabirye Joyce Kawuma');
await page.locator('#phone').fill('0772904455');
await settle(page, 400);
await shot(page, 'staff', 'register-02-step1-filled');

const next = () => page.locator('button', { hasText: /continue|review|register member/i }).first().click();
await next();
await settle(page, 800);
await shot(page, 'staff', 'register-05-step3-fees');   // now step 2: the fees

await next();
await settle(page, 800);
await shot(page, 'staff', 'register-06-step4-payment'); // now step 3: payment

/* ------------------------------------------------------- the share purchase */
await page.goto(`${BASE}/staff/shares/sell`, { waitUntil: 'domcontentloaded' });
await settle(page, 800);
await shot(page, 'staff', 'shares-01-sell-form');
await page.locator('#quantity').fill('25');
await settle(page, 400);
await shot(page, 'staff', 'shares-03-filled');

/* ------------------------------------------------------------ collection */
await page.goto(`${BASE}/staff/savings/collect`, { waitUntil: 'domcontentloaded' });
await settle(page, 700);
await shot(page, 'staff', 'collect-01-open');
await page.goto(`${BASE}/staff/savings/collect?q=${encodeURIComponent(process.env.MEMBER_NO ?? '')}`, {
  waitUntil: 'domcontentloaded',
});
await settle(page, 900);
await shot(page, 'staff', 'collect-02-search');
const first = page.locator('a[href*="member="]').first();
if (await first.count()) {
  await first.click();
  await settle(page, 1200);
  await shot(page, 'staff', 'collect-03-member', { fullPage: true });
  const record = page.locator('button', { hasText: /record savings/i }).first();
  if (await record.count()) {
    await record.click();
    await settle(page, 700);
    await shot(page, 'staff', 'collect-04-record-dialog');
    await page.locator('#collect-amount').fill('73500').catch(() => {});
    await settle(page, 400);
    await shot(page, 'staff', 'collect-05-filled');
  }
}
await staffCtx.close();

/* ----------------------------------------------------------------- member */
if (MEMBER_ID) {
  const memberRoutes = [
    ['/', 'member', 'mf-01-dashboard', { fullPage: true }],
    ['/savings', 'member', 'mf-02-savings', { fullPage: true }],
    ['/savings/deposit', 'member', 'mf-03-savings-deposit-guide', { fullPage: true }],
    ['/shares', 'member', 'mf-04-shares', { fullPage: true }],
    ['/shares/buy', 'member', 'mf-05-shares-buy-guide', { fullPage: true }],
    ['/profile', 'member', 'mf-16-profile', { fullPage: true }],
    ['/more', 'member', 'mf-17-more', { fullPage: true }],
  ];
  const { context: mCtx } = await walk(MEMBER_ID, MEMBER_PW, PHONE, memberRoutes);
  await mCtx.close();

  const desktopRoutes = memberRoutes.map(([r, f, n, o]) => [r, f, n.replace(/^mf-/, 'm-'), o]);
  const { context: dCtx } = await walk(MEMBER_ID, MEMBER_PW, DESKTOP, desktopRoutes);
  await dCtx.close();
}

await browser.close();
console.log(`\n${log.length} route screenshot(s) recaptured.`);
