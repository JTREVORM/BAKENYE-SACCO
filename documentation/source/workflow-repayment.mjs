/** Capture a loan repayment recorded by the Cashier. */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';
const LOAN = process.env.LOAN;
const browser = await openBrowser();
const { page } = await newPage(browser);
await signIn(page, process.env.ID, process.env.PW);
await page.goto(`${BASE}/staff/loans/${LOAN}/repay`, { waitUntil: 'domcontentloaded' });
await settle(page);
await shot(page, 'staff', 'repay-01-form');

// The "One installment" quick-fill is used deliberately: finding V-2 was that
// it multiplied a fractional installment by a hundred. Pressing it here and
// reading the box back is what proves the fix, and is what the manual shows.
await page.locator('main button', { hasText: 'One installment' }).first().click();
await settle(page, 400);
const quickFilled = await page.locator('main input#amount').inputValue();
console.log('one-installment quick-fill ->', quickFilled);
await page.selectOption('#method', 'cash').catch((e) => console.log('method:', e.message.split('\n')[0]));
await settle(page, 400);
await shot(page, 'staff', 'repay-02-filled');

await page.locator('main button', { hasText: 'Review' }).last().click();
await settle(page, 800);
await shot(page, 'staff', 'repay-03-confirm');

await page.locator('button', { hasText: /Record repayment|Confirm/ }).last().click();
await settle(page, 2500);
await shot(page, 'staff', 'repay-04-result');
console.log('result:', (await page.locator('main').innerText()).slice(0, 260).replace(/\n+/g, ' / '));
console.log('url:', page.url());
await browser.close();
