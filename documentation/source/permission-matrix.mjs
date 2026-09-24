/**
 * Nine-role permission regression.
 *
 * Signs in as every demonstration account and asks for every staff and member
 * route, recording whether the application served it or turned the account
 * away. The result is an access matrix that can be compared between two builds,
 * so a change meant to fix one screen cannot quietly widen what a role may see.
 *
 * No screenshots: this is a behaviour check, not a capture run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { openBrowser, newPage, signIn, settle, BASE } from './lib.mjs';

const ROUTES = [
  '/staff', '/staff/admin', '/staff/desk', '/staff/loans-desk', '/staff/finance',
  '/staff/members', '/staff/savings', '/staff/savings/collect', '/staff/shares',
  '/staff/loans', '/staff/transactions', '/staff/reports', '/staff/users',
  '/staff/roles', '/staff/audit', '/staff/settings', '/staff/categories',
  '/staff/notifications', '/staff/profile',
  '/', '/savings', '/savings/deposit', '/shares', '/loans', '/transactions',
  '/guarantees', '/notifications', '/profile',
];

const accounts = JSON.parse(readFileSync('/var/tmp/bud-docs-stack/accounts.json', 'utf8'));
const who = [
  { role: 'super_admin', phone: process.env.ADMIN_ID, password: process.env.ADMIN_PW },
  ...accounts,
  { role: 'member', phone: process.env.MEMBER_ID, password: process.env.MEMBER_PW },
];

const browser = await openBrowser();
const matrix = {};
for (const a of who) {
  if (!a.phone || !a.password) { console.log(`${a.role}: no credentials, skipped`); continue; }
  const { context, page } = await newPage(browser);
  page.setDefaultTimeout(60_000);
  const landed = await signIn(page, a.phone, a.password);
  const row = { landing: landed.replace(BASE, ''), routes: {} };
  for (const path of ROUTES) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await settle(page, 250);
      const final = page.url().replace(BASE, '').split('?')[0];
      row.routes[path] = final === path ? 'allowed' : `-> ${final}`;
    } catch (e) {
      row.routes[path] = `error: ${e.message.split('\n')[0].slice(0, 60)}`;
    }
  }
  matrix[a.role] = row;
  const allowed = Object.values(row.routes).filter((v) => v === 'allowed').length;
  console.log(`${a.role.padEnd(14)} lands ${row.landing.padEnd(22)} ${allowed}/${ROUTES.length} routes served`);
  await context.close();
}
writeFileSync(process.env.OUT ?? '/var/tmp/bud-docs-stack/permission-matrix.json', JSON.stringify(matrix, null, 2));
await browser.close();
