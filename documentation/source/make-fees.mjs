/** Create the demonstration fees through Settings -> Fees, and capture it. */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';

const FEES = [
  { name: 'Membership Fee',   amount: '20000', type: 'membership',   when: 'registration', mandatory: true },
  { name: 'Registration Fee', amount: '5000',  type: 'registration', when: 'registration', mandatory: true },
];

const browser = await openBrowser();
const { page } = await newPage(browser);
await signIn(page, process.env.ID, process.env.PW);

for (const [i, f] of FEES.entries()) {
  await page.goto(`${BASE}/staff/settings?section=fees`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.click('text=Create Fee');
  await settle(page, 700);
  await page.fill('#fee-name', f.name);
  await page.fill('#fee-amount', f.amount);
  await page.selectOption('#fee-type', f.type).catch((e) => console.log('  fee_type:', e.message.split('\n')[0]));
  await page.selectOption('#fee-when', f.when).catch((e) => console.log('  charged_when:', e.message.split('\n')[0]));
  if (i === 0) await shot(page, 'admin', 'settings-fees-create-dialog');
  await page.locator('[role="dialog"] button[type="submit"], dialog button[type="submit"]').last().click();
  await settle(page, 1200);
  console.log(`  ${f.name}: ${(await page.locator('body').innerText()).includes(f.name) ? 'created' : 'CHECK'}`);
}
await page.goto(`${BASE}/staff/settings?section=fees`, { waitUntil: 'domcontentloaded' });
await settle(page);
await shot(page, 'admin', 'settings-fees-list');
await browser.close();
