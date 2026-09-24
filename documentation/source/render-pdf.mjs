/**
 * Render a manual's HTML to an A4 PDF using Chromium's own print engine —
 * the same mechanism the application itself uses for statements and receipts.
 *
 *   node documentation/source/render-pdf.mjs <input.html> <output.pdf> "<footer title>"
 */
import { chromium } from 'playwright';
import path from 'node:path';

const [input, output] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
await page.goto(`file://${path.resolve(input)}`, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => document.fonts?.ready);
await page.waitForTimeout(800);

await page.pdf({
  path: output,
  format: 'A4',
  printBackground: true,
  // Footers are stamped afterwards by stamp.py, so the cover stays clean and
  // the numbering can skip it.
  displayHeaderFooter: false,
  preferCSSPageSize: true,
});

await browser.close();
console.log(`wrote ${output}`);
