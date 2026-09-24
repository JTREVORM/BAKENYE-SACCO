/** Approve the pending expense and reject the duplicate, as the manager. */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';
const browser = await openBrowser();
const { page } = await newPage(browser);
await signIn(page, process.env.MGR, process.env.PW);
await page.goto(`${BASE}/staff/finance/expenses`, { waitUntil: 'domcontentloaded' });
await settle(page);
await page.locator('main button', { hasText: 'Awaiting approval' }).first().click().catch(() => {});
await settle(page, 1200);

// Approve EXP260924006 (the correctly categorised one).
const approve = page.locator('main button', { hasText: 'Approve' }).first();
await approve.scrollIntoViewIfNeeded();
await approve.click();
await settle(page, 800);
await shot(page, 'staff', 'expense-06-approve-confirm');
await page.locator('main button', { hasText: /^Approve UGX/ }).first().click();
await settle(page, 2500);
await shot(page, 'staff', 'expense-07-approved');
console.log('after approve:', (await page.locator('main').innerText()).slice(0, 200).replace(/\n+/g, ' / '));

// Reject the earlier duplicate, so the demonstration data stays tidy and the
// rejection path is captured too.
await page.goto(`${BASE}/staff/finance/expenses`, { waitUntil: 'domcontentloaded' });
await settle(page);
await page.locator('main button', { hasText: 'Awaiting approval' }).first().click().catch(() => {});
await settle(page, 1200);
const reject = page.locator('main button', { hasText: 'Reject' }).first();
if (await reject.count()) {
  await reject.scrollIntoViewIfNeeded();
  await reject.click();
  await settle(page, 800);
  await shot(page, 'staff', 'expense-08-reject-confirm');
  const fields = await page.evaluate(() => Array.from(document.querySelectorAll('main textarea')).map(e => e.id || e.name));
  console.log('reject fields:', fields.join(','));
}
await browser.close();
