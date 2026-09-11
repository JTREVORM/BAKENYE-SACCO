/**
 * Screenshot the authenticated staff screens at desktop widths.
 *
 *   node scripts/desktop-shots.mjs [baseUrl] [tag]
 *
 * Signs in with STAFF_EMAIL / STAFF_PASSWORD (or the values below), then
 * captures each route at 1280, 1440 and 1920 so wide-viewport layout can be
 * judged from the real application rather than from the fixture harness.
 *
 * Writes to `screenshots/desktop/`.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const TAG = process.argv[3] ? `-${process.argv[3]}` : '';

const EMAIL = process.env.STAFF_EMAIL;
const PASSWORD = process.env.STAFF_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Set STAFF_EMAIL and STAFF_PASSWORD to a staff account to test with.'); process.exit(1); }

const WIDTHS = [1280, 1440, 1920];

const ROUTES = [
  { path: '/staff', name: 'dashboard' },
  { path: '/staff/members', name: 'members' },
  { path: '/staff/categories', name: 'categories' },
  { path: '/staff/savings', name: 'savings' },
  { path: '/staff/savings/collect', name: 'collect' },
  { path: '/staff/savings/schedules', name: 'schedules' },
  { path: '/staff/reports', name: 'reports' },
  { path: '/staff/users', name: 'users' },
  { path: '/staff/transactions', name: 'transactions' },
  { path: '/staff/finance', name: 'finance' },
];

const OUT = 'screenshots/desktop';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Sign in once per context.
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    // One sign-in form for everyone; an email works as the identifier for staff.
    await page.fill('input[name="identifier"]', EMAIL).catch(async () => {
      await page.fill('input[type="email"]', EMAIL);
    });
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/staff/, { timeout: 120_000 }).catch(() => {});

    for (const route of ROUTES) {
      try {
        await page.goto(`${BASE}${route.path}`, {
          waitUntil: 'networkidle',
          timeout: 120_000,
        });
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/${route.name}-${width}${TAG}.png` });
        console.log(`  ✔ ${route.name} @ ${width}`);
      } catch (error) {
        console.log(`  ✖ ${route.name} @ ${width} — ${error.message.split('\n')[0]}`);
      }
    }

    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\nScreenshots in ./${OUT}/`);
