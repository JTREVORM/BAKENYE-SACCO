/**
 * Capture what a report looks like when printed / saved as PDF: the same page
 * rendered with print media emulation, which is exactly what the browser's
 * "Save as PDF" produces.
 */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';
const browser = await openBrowser();
const { page } = await newPage(browser, { width: 1240, height: 1754 });
await signIn(page, process.env.ID, process.env.PW);
for (const t of JSON.parse(process.env.TARGETS)) {
  await page.goto(`${BASE}${t.path}`, { waitUntil: 'domcontentloaded' });
  await settle(page, 900);
  await page.emulateMedia({ media: 'print' });
  await settle(page, 600);
  await shot(page, 'staff', t.name, { fullPage: true });
  await page.emulateMedia({ media: 'screen' });
}
await browser.close();
