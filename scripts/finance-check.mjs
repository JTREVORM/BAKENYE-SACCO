import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = 'screenshots/finance';
const EMAIL = process.env.STAFF_EMAIL ?? 'trevor@gmail.com';
const PASSWORD = process.env.STAFF_PASSWORD ?? 'Admin@123';

const ROUTES = [
  '/staff', '/staff/finance', '/staff/finance/merchant', '/staff/finance/bank', '/staff/finance/cash',
  '/staff/finance/receipts', '/staff/finance/payments', '/staff/finance/expenses', '/staff/finance/transfers',
  '/staff/finance/reconciliation', '/staff/finance/reconciliation/new', '/staff/finance/ledger',
  '/staff/finance/reports', '/staff/finance/reports?view=position', '/staff/finance/reports?view=receipts-payments',
  '/staff/finance/reports?view=statement', '/staff/finance/accounts', '/staff/finance/income-expenses',
  '/staff/finance/new/collection', '/staff/finance/new/collection?preset=merchant',
  '/staff/finance/new/transfer?kind=merchant_to_bank', '/staff/finance/new/transfer?kind=bank_to_cash',
  '/staff/finance/new/payment', '/staff/finance/new/expense', '/staff/finance/new/receipt',
  '/staff/settings?section=treasury', '/staff/finance?tab=expenses',
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let failures = 0;

for (const width of (process.argv[3] ? process.argv[3].split(',').map(Number) : [390, 1440])) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  // One sign-in form for everyone; an email works as the identifier for staff.
  await page.fill('input[name="identifier"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/staff/, { timeout: 60_000 });

  for (const route of ROUTES) {
    errors.length = 0;
    const res = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(300);
    const status = res?.status();
    const finalUrl = page.url().replace(BASE, '');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const errorText = await page.evaluate(() => {
      const t = document.body.innerText;
      return /Application error|Unhandled Runtime Error|Unable to load/i.test(t) ? t.match(/(Application error[^\n]*|Unhandled Runtime Error[^\n]*|Unable to load[^\n]*)/i)?.[0] : null;
    });
    const bad = status >= 400 || overflow > 1 || errorText || errors.length > 0;
    if (bad) failures += 1;
    const name = route.replace(/[/?=&]+/g, '_').replace(/^_/, '') || 'root';
    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
    console.log(`${bad ? '✖' : '✔'} ${width} ${route} -> ${status} ${finalUrl !== route ? `(→ ${finalUrl})` : ''}${overflow > 1 ? ` overflow ${overflow}px` : ''}${errorText ? ` "${errorText}"` : ''}${errors.length ? ` console: ${errors.slice(0, 2).join(' | ')}` : ''}`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${failures} problem page(s)`);
process.exit(failures ? 1 : 0);
