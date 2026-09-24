/**
 * Shared helpers for the documentation screenshot capture.
 *
 * Runs against the LOCAL documentation stack only (a throwaway Postgres, a
 * Supabase-compatible gateway and `npm run dev`), never against the SACCO's
 * live system. Nothing here changes application code: it drives the real
 * application exactly as a person would, through the browser.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BASE = process.env.DOC_BASE ?? 'http://127.0.0.1:3000';
export const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const SHOTS = 'documentation/screenshots';

export const DESKTOP = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };

/** Google Fonts is fetched through a Node-side cache: the browser in this
 *  container does not trust the outbound proxy's certificate, Node does. */
const fontCache = new Map();
async function serveFont(route, request) {
  const url = request.url();
  if (!fontCache.has(url)) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': request.headers()['user-agent'] ?? '' } });
      fontCache.set(url, {
        status: res.status,
        contentType: res.headers.get('content-type') ?? 'text/css',
        body: Buffer.from(await res.arrayBuffer()),
      });
    } catch {
      fontCache.set(url, { status: 504, contentType: 'text/plain', body: Buffer.from('') });
    }
  }
  const hit = fontCache.get(url);
  await route.fulfill({ status: hit.status, contentType: hit.contentType, body: hit.body });
}

export async function openBrowser() {
  return chromium.launch({ executablePath: CHROME });
}

export async function newPage(browser, viewport = DESKTOP) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.route('https://fonts.googleapis.com/**', serveFont);
  await context.route('https://fonts.gstatic.com/**', serveFont);
  const page = await context.newPage();
  return { context, page };
}

export async function signIn(page, identifier, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  return page.url();
}

/** Wait for the page to settle: fonts loaded, skeletons gone, no animation. */
export async function settle(page, extra = 500) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // Hide the Next.js development overlay badge - it is part of `npm run dev`,
  // not of the application, and must not appear in a manual.
  await page.addStyleTag({ content: 'nextjs-portal{display:none !important}' }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(extra);
}

export async function shot(page, folder, name, { fullPage = false, clip, selector } = {}) {
  const dir = path.join(SHOTS, folder);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  if (selector) {
    const el = page.locator(selector).first();
    await el.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage, clip });
  }
  console.log(`  ✔ ${folder}/${name}.png`);
  return file;
}

export async function record(rows, file = 'documentation/source/capture-log.json') {
  await writeFile(file, JSON.stringify(rows, null, 2));
}
