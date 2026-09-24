/** Documentation capture: first sign-in and the forced password change. */
import { openBrowser, newPage, signIn, settle, shot } from './lib.mjs';
const { ID, PW, NEWPW } = process.env;
const browser = await openBrowser();
const { page } = await newPage(browser);
await signIn(page, ID, PW);
await settle(page);
console.log('landed on', page.url());
if (page.url().includes('change-password')) {
  await page.locator('input[type="password"]').nth(0).fill(PW);
  await page.locator('input[type="password"]').nth(1).fill(NEWPW);
  await page.locator('input[type="password"]').nth(2).fill(NEWPW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('change-password'), { timeout: 60000 }).catch(() => {});
  await settle(page);
  console.log('after change ->', page.url());
  await shot(page, 'shared', 'check-after-change');
}
await browser.close();
