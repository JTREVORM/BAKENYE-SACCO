/**
 * Visit a list of routes as a given account and screenshot each one.
 *
 *   ID=... PW=... ROUTES=staff node documentation/source/walk.mjs
 *
 * Reports the final URL for every route, so a redirect (no permission, or a
 * route that does not exist for this role) is visible rather than silently
 * producing a screenshot of the wrong page.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { openBrowser, newPage, signIn, settle, shot, BASE, DESKTOP, PHONE } from './lib.mjs';

const routes = JSON.parse(readFileSync(process.env.ROUTE_FILE, 'utf8'));
const folder = process.env.FOLDER ?? 'shared';
const viewport = process.env.VIEW === 'phone' ? PHONE : DESKTOP;
const prefix = process.env.PREFIX ?? '';
const fullPage = process.env.FULLPAGE === '1';

const browser = await openBrowser();
const { page } = await newPage(browser, viewport);
const landed = await signIn(page, process.env.ID, process.env.PW);
console.log('signed in ->', landed);

const log = [];
for (const r of routes) {
  const url = `${BASE}${r.path}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await settle(page, r.wait ?? 600);
    const finalUrl = page.url().replace(BASE, '');
    const redirected = finalUrl.split('?')[0] !== r.path;
    const title = await page.locator('h1, h2').first().innerText().catch(() => '');
    await shot(page, folder, `${prefix}${r.name}`, { fullPage: r.fullPage ?? fullPage });
    log.push({ ...r, finalUrl, redirected, heading: title.trim().slice(0, 80) });
    if (redirected) console.log(`    ↳ REDIRECTED to ${finalUrl}`);
  } catch (e) {
    console.log(`  ✖ ${r.name}: ${e.message.split('\n')[0]}`);
    log.push({ ...r, error: e.message.split('\n')[0] });
  }
}
writeFileSync(process.env.LOG_FILE ?? '/var/tmp/bud-docs-stack/walk-log.json', JSON.stringify(log, null, 2));
await browser.close();
