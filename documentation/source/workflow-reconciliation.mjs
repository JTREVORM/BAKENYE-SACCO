/** Record a reconciliation of Cash at Merchant, with a small variance. */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';
const browser = await openBrowser();
const { page } = await newPage(browser);
page.setDefaultTimeout(90000);
await signIn(page, process.env.ID, process.env.PW);
await page.goto(`${BASE}/staff/finance/reconciliation/new`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await settle(page, 900);
await shot(page, 'staff', 'recon-01-form');

await page.selectOption('#reconcile-account', { label: /Cash at Hand/ }).catch(async () => {
  await page.selectOption('#reconcile-account', { index: 2 });
});
await page.fill('#reconcile-actual', process.env.ACTUAL);
await page.fill('#reconcile-statement', 'MTN-STMT-2026-09');
await page.fill('#reconcile-reason', process.env.REASON ?? '');
await settle(page, 500);
await shot(page, 'staff', 'recon-02-filled');

await page.locator('main button', { hasText: 'Review' }).last().click();
await settle(page, 900);
await shot(page, 'staff', 'recon-03-confirm');
await page.locator('button', { hasText: /Record|Confirm|Save/ }).last().click();
await settle(page, 2500);
await shot(page, 'staff', 'recon-04-result');
console.log('result:', (await page.locator('main').innerText()).slice(0, 250).replace(/\n+/g, ' / '));

await page.goto(`${BASE}/staff/finance/reconciliation`, { waitUntil: 'domcontentloaded' });
await settle(page, 900);
await shot(page, 'staff', 'recon-05-history');
await browser.close();
