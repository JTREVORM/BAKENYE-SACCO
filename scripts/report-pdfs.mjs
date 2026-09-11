/**
 * Render every printable document to a real PDF, exactly as the browser does
 * when a user picks "Save as PDF".
 *
 *   node scripts/report-pdfs.mjs [baseUrl]
 *
 * Signs in with STAFF_EMAIL / STAFF_PASSWORD, then prints each report through
 * Chromium's own print pipeline — the same one behind the Download PDF button —
 * so the letterhead, page breaks and repeated table headings can be checked as
 * output rather than guessed at from the screen.
 *
 * Writes to `screenshots/pdf/`.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const EMAIL = process.env.STAFF_EMAIL;
const PASSWORD = process.env.STAFF_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Set STAFF_EMAIL and STAFF_PASSWORD to a staff account to test with.'); process.exit(1); }

const DOCS = [
  { path: '/staff/reports/members', name: 'member-register' },
  { path: '/staff/savings', name: 'savings-dashboard' },
  { path: '/staff/savings/performance', name: 'savings-performance' },
  { path: '/staff/savings/schedules', name: 'savings-schedules' },
];

const OUT = 'screenshots/pdf';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // One sign-in form for everyone; an email works as the identifier for staff.
  await page.fill('input[name="identifier"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/staff/, { timeout: 120_000 }).catch(() => {});

  for (const doc of DOCS) {
    try {
      await page.goto(`${BASE}${doc.path}`, { waitUntil: 'networkidle', timeout: 120_000 });
      await page.waitForTimeout(500);
      await page.pdf({
        path: `${OUT}/${doc.name}.pdf`,
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
      });

      // A PNG of the same print rendering, because a PDF cannot be eyeballed
      // without extra tooling and the point of this script is to look at the
      // output rather than to trust it.
      await page.emulateMedia({ media: 'print' });
      await page.screenshot({ path: `${OUT}/${doc.name}.png`, fullPage: true });
      await page.emulateMedia({ media: 'screen' });

      console.log(`  ✔ ${doc.name}.pdf + .png`);
    } catch (error) {
      console.log(`  ✖ ${doc.name} — ${error.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
}

console.log(`\nPDFs in ./${OUT}/`);
