/** Sign each demo account in once and replace its temporary password. */
import { readFileSync, writeFileSync } from 'node:fs';
import { openBrowser, newPage, signIn, settle } from './lib.mjs';

const accounts = JSON.parse(readFileSync('/var/tmp/bud-docs-stack/accounts.json', 'utf8'));
const NEW = process.env.NEWPW;
const browser = await openBrowser();
for (const a of accounts) {
  const { context, page } = await newPage(browser);
  page.setDefaultTimeout(90_000);
  await signIn(page, a.phone, a.password);
  await settle(page);
  if (page.url().includes('change-password')) {
    await page.locator('input[type="password"]').nth(0).fill(a.password);
    await page.locator('input[type="password"]').nth(1).fill(NEW);
    await page.locator('input[type="password"]').nth(2).fill(NEW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('change-password'), { timeout: 60000 }).catch(() => {});
    await settle(page);
    a.password = NEW;
    console.log(`${a.role.padEnd(14)} ready -> ${page.url().replace('http://127.0.0.1:3000','')}`);
  } else {
    console.log(`${a.role.padEnd(14)} UNEXPECTED -> ${page.url()}`);
  }
  await context.close();
}
writeFileSync('/var/tmp/bud-docs-stack/accounts.json', JSON.stringify(accounts, null, 2));
await browser.close();
