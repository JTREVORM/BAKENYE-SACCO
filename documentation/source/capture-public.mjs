/** Capture the signed-out screens at desktop and phone size. */
import { openBrowser, newPage, settle, shot, BASE, DESKTOP, PHONE } from './lib.mjs';
const ROUTES = [
  { path: '/login', name: 'login' },
  { path: '/forgot-password', name: 'forgot-password' },
  { path: '/help', name: 'help' },
];
const browser = await openBrowser();
for (const [label, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  const { context, page } = await newPage(browser, viewport);
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r.path}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await shot(page, 'shared', `${r.name}-${label}`, { fullPage: label === 'phone' });
  }
  await context.close();
}
await browser.close();
