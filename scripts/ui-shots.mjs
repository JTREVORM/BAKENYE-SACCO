/**
 * Screenshot every major route at desktop, tablet and mobile widths.
 *
 *   node scripts/ui-shots.mjs [baseUrl] [tag]
 *
 * Signs in with STAFF_EMAIL / STAFF_PASSWORD, then captures each route so the
 * redesign can be judged from the real application rather than from a fixture
 * harness. Also reports any page that scrolls sideways, which is the single
 * most common responsive regression.
 *
 * Writes to `screenshots/ui/<width>/`.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const TAG = process.argv[3] ? `-${process.argv[3]}` : '';

const EMAIL = process.env.STAFF_EMAIL;
const PASSWORD = process.env.STAFF_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Set STAFF_EMAIL and STAFF_PASSWORD to a staff account to test with.'); process.exit(1); }

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

const ROUTES = [
  { path: '/staff', name: 'dashboard' },
  { path: '/staff/members', name: 'members' },
  { path: '/staff/categories', name: 'categories' },
  { path: '/staff/savings', name: 'savings' },
  { path: '/staff/savings/collect', name: 'savings-collect' },
  { path: '/staff/savings/performance', name: 'savings-performance' },
  { path: '/staff/savings/schedules', name: 'savings-schedules' },
  { path: '/staff/shares', name: 'shares' },
  { path: '/staff/loans', name: 'loans' },
  { path: '/staff/transactions', name: 'transactions' },
  { path: '/staff/finance', name: 'finance' },
  { path: '/staff/reports', name: 'reports' },
  { path: '/staff/users', name: 'users' },
  { path: '/staff/audit', name: 'audit' },
  { path: '/staff/settings', name: 'settings' },
  { path: '/staff/members/new', name: 'member-new' },
  { path: '/staff/savings/record', name: 'savings-record' },
];

const browser = await chromium.launch();
const overflow = [];

for (const vp of VIEWPORTS) {
  const out = `screenshots/ui/${vp.name}${TAG}`;
  await mkdir(out, { recursive: true });

  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  // One sign-in form for everyone; an email works as the identifier for staff.
  await page.fill('input[name="identifier"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/staff/, { timeout: 30_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1200);

  for (const r of ROUTES) {
    try {
      await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(500);

      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (wide > 1) overflow.push(`${vp.name} ${r.path} — ${wide}px of horizontal scroll`);

      await page.screenshot({ path: `${out}/${r.name}.png`, fullPage: false });
    } catch (error) {
      console.log(`   ✖ ${vp.name} ${r.path}: ${error.message.split('\n')[0]}`);
    }
  }

  console.log(`✔ ${vp.name} (${vp.width}px) — ${ROUTES.length} routes`);
  await ctx.close();
}

await browser.close();

if (overflow.length > 0) {
  console.log('\nHorizontal overflow:');
  for (const o of overflow) console.log(`   ✖ ${o}`);
} else {
  console.log('\n✔ no horizontal overflow at any width');
}
