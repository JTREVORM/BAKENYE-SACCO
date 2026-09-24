/**
 * Create the demonstration staff accounts through the application's own
 * Users screen, and capture the workflow. Test environment only.
 *
 * Prints each generated temporary password so the capture scripts can sign in
 * as that role. These are throwaway credentials for a throwaway database.
 */
import { writeFileSync } from 'node:fs';
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';

const PEOPLE = [
  { name: 'Moses Kirunda',   phone: '0700000201', role: 'manager' },
  { name: 'Sarah Nabirye',   phone: '0700000202', role: 'cashier' },
  { name: 'Daniel Wafula',   phone: '0700000203', role: 'loan_officer' },
  { name: 'Agnes Nakayiza',  phone: '0700000204', role: 'accountant' },
  { name: 'Joseph Mutyaba',  phone: '0700000205', role: 'field_officer' },
];

const browser = await openBrowser();
const { page } = await newPage(browser);
page.setDefaultTimeout(90_000);
await signIn(page, process.env.ID, process.env.PW);

const made = [];
for (const [i, p] of PEOPLE.entries()) {
  await page.goto(`${BASE}/staff/users`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.click('text=Add staff account');
  await settle(page, 600);
  await page.fill('#staff-name', p.name);
  await page.fill('#staff-phone', p.phone);
  await page.selectOption('#staff-role', p.role);
  if (i === 0) await shot(page, 'admin', 'users-add-staff-dialog');
  await page.click('button[type="submit"]');
  await settle(page, 1200);
  const body = await page.locator('body').innerText();
  const m = body.match(/[A-Z]{4}-\d{4}/);
  if (i === 0) await shot(page, 'admin', 'users-temporary-password');
  made.push({ ...p, password: m ? m[0] : null });
  console.log(`${p.role.padEnd(14)} ${p.name.padEnd(18)} ${p.phone}  ${m ? m[0] : 'NO PASSWORD FOUND'}`);
}
writeFileSync('/var/tmp/bud-docs-stack/accounts.json', JSON.stringify(made, null, 2));
await page.goto(`${BASE}/staff/users`, { waitUntil: 'domcontentloaded' });
await settle(page);
await shot(page, 'admin', 'users-list');
await browser.close();
