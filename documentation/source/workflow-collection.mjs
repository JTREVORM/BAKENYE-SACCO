/**
 * Capture the savings collection workflow, step by step, as the Cashier.
 * This records a REAL payment in the local documentation database.
 */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';

const browser = await openBrowser();
const { page } = await newPage(browser);
await signIn(page, process.env.ID, process.env.PW);

// Step 1 - open the collection screen
await page.goto(`${BASE}/staff/savings/collect`, { waitUntil: 'domcontentloaded' });
await settle(page);
await shot(page, 'staff', 'collect-01-open');

// Step 2 - search for the member
const search = page.locator('main input[type="search"]').first();
await search.fill('BND26005');
await settle(page, 1500);
await shot(page, 'staff', 'collect-02-search');

// Step 3 - open the member's collection panel
const result = page.locator('main button, main a').filter({ hasText: 'BND26005' }).first();
await result.click().catch(async () => { await page.keyboard.press('Enter'); });
await settle(page, 1500);
await shot(page, 'staff', 'collect-03-member');

// Step 4 - the Record payment dialog
await page.click('text=Record savings');
await settle(page, 900);
const fields = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] input,[role="dialog"] select,[role="dialog"] textarea,dialog input,dialog select,dialog textarea')).map(el => [el.tagName, el.type||'', el.name||'', el.id||''].join('|')));
console.log('dialog fields:\n' + fields.join('\n'));
await shot(page, 'staff', 'collect-04-record-dialog');

// Step 5 - fill it in as a cashier taking what the member actually brought.
// The amount is whatever they chose to save; there is no target to meet.
await page.fill('#collect-amount', '73500');
await page.selectOption('#collect-method', 'mobile_money').catch((e) => console.log('method:', e.message.split('\n')[0]));
// A unique reference each run: the same one cannot be banked twice, which is
// the point of the field and would otherwise stop a re-capture.
const ref = process.env.REF ?? `MM${Date.now().toString().slice(-11)}`;
await page.fill('#collect-ref', ref);
await settle(page, 400);
await shot(page, 'staff', 'collect-05-filled');

// Step 6 - "Review" shows a confirmation summary before anything is saved
await page.locator('button', { hasText: 'Review' }).last().scrollIntoViewIfNeeded();
await page.locator('button', { hasText: 'Review' }).last().click();
await settle(page, 700);
await shot(page, 'staff', 'collect-06-confirm');

// Step 7 - confirm, and show the result
await page.locator('button', { hasText: 'Record savings' }).last().click();
// The posting is a server round trip; wait for the receipt link that only
// appears once it has succeeded, rather than guessing at a delay.
await page.waitForSelector('a:has-text("View receipt")', { timeout: 60_000 }).catch(() => {});
await settle(page, 1200);
await shot(page, 'staff', 'collect-07-result');
console.log('after submit:', (await page.locator('main').innerText()).slice(0, 300).replace(/\n+/g, ' / '));

// Step 8 - the receipt the member is given
const receipt = page.locator('a:has-text("View receipt")').first();
if (await receipt.count()) {
  await receipt.click();
  await settle(page, 2000);
  await shot(page, 'staff', 'collect-08-receipt', { fullPage: true });
}
await browser.close();
