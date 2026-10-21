/**
 * Screenshot the fixture dashboard harness at every width.
 *
 *   node scripts/preview-shots.mjs [baseUrl] [outDir]
 *
 * Unlike `ui-shots.mjs` this needs no sign-in and no database: it drives
 * `/dev/preview/dashboard`, which renders the real chrome and the real
 * dashboard components against `src/lib/fixtures.ts`. It is how the 2026
 * redesign was checked against the approved reference images, and the fastest
 * way to re-check a layout after changing a shared component.
 *
 * Start the app first (`npm run dev`). Reports any page that scrolls sideways,
 * which is the single most common responsive regression.
 *
 * Writes to `screenshots/preview/` unless another directory is given. Set
 * CHROMIUM_PATH to use a Chromium that Playwright did not install itself.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = process.argv[3] ?? 'screenshots/preview';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'small', width: 320, height: 720 },
];

const PAGES = [
  { path: '/dev/preview/dashboard', name: 'overview' },
  { path: '/dev/preview/dashboard?variant=admin', name: 'administration' },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const problems = [];

for (const vp of VIEWPORTS) {
  for (const target of PAGES) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(`${BASE}${target.path}`, { waitUntil: 'networkidle', timeout: 90_000 });
    // Let the hero images decode before the shutter.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${target.name}-${vp.name}.png`, fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 1) problems.push(`${target.name} @ ${vp.width}: scrolls ${overflow}px sideways`);
    console.log(`${target.name} @ ${vp.width}  ok${overflow > 1 ? ` (overflow ${overflow}px)` : ''}`);
    await context.close();
  }
}

await browser.close();

if (problems.length > 0) {
  console.error('\nProblems:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nAll clean. Screenshots in ${OUT}/`);
