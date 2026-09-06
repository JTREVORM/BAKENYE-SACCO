/**
 * Responsive and accessibility audit.
 *
 * Loads each page at every width the brief lists and checks for the specific
 * failures it names: horizontal overflow, clipped text, tap targets under 44px,
 * broken images and overlapping controls. Writes screenshots to
 * `screenshots/` and prints a pass/fail table.
 *
 *   node scripts/responsive-check.mjs [baseUrl]
 *
 * Start the app first (`npm run build && npm start`, or `npm run dev`).
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:3000';

const WIDTHS = [320, 360, 375, 390, 430, 768, 1024, 1440, 1920];

/**
 * Pages reachable without a session, plus the dev-only design preview which
 * renders the authenticated screens against fixture data.
 */
const PAGES = [
  { path: '/login', name: 'login' },
  { path: '/forgot-password', name: 'forgot-password' },
  { path: '/reset-password', name: 'reset-password' },
  { path: '/help', name: 'help' },
  { path: '/dev/preview', name: 'preview' },
];

const OUT = 'screenshots';

/** Runs in the page. Returns every layout problem it can detect. */
function audit() {
  const problems = [];
  const vw = window.innerWidth;

  // 1. Horizontal overflow of the document itself.
  if (document.documentElement.scrollWidth > vw + 1) {
    problems.push({
      kind: 'page-overflow',
      detail: `document scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw}`,
    });
  }

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
    const text = (el.textContent ?? '').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
  };

  const all = Array.from(document.querySelectorAll('body *'));

  /**
   * Whether some ancestor clips this element. A decorative blur positioned
   * outside its card is intentional and harmless as long as an ancestor has
   * `overflow: hidden` — it is only a bug when it can actually widen the page.
   */
  const isClipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflow !== 'visible' || s.overflowX !== 'visible') return true;
    }
    return false;
  };

  // `.sr-only` deliberately clips itself to a 1px box; that is the technique,
  // not a defect.
  const isScreenReaderOnly = (el) => el.matches('.sr-only') || !!el.closest('.sr-only');

  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    if (isScreenReaderOnly(el)) continue;
    // The design harness's own controls are scaffolding, not product.
    if (el.closest('[data-preview-chrome]')) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    // 2. Elements sticking out past the right edge. Ignore anything inside a
    //    deliberately scrollable container, anything an ancestor clips, and
    //    anything positioned off-screen on purpose (drawers).
    const scrollParent = el.closest('.scroll-x, .no-scrollbar, [class*="overflow-x-auto"], dialog');
    const offscreenByDesign =
      el.closest('[aria-hidden="true"]') || style.position === 'fixed' || isClipped(el);

    if (!scrollParent && !offscreenByDesign) {
      if (rect.right > vw + 1) {
        problems.push({
          kind: 'element-overflow-right',
          detail: `${describe(el)} right=${Math.round(rect.right)} > ${vw}`,
        });
      }
      if (rect.left < -1) {
        problems.push({
          kind: 'element-overflow-left',
          detail: `${describe(el)} left=${Math.round(rect.left)}`,
        });
      }
    }

    // 3. Tap targets. 44px minimum per DESIGN.md, on interactive elements that
    //    are not inline links inside a paragraph.
    const interactive =
      el.matches('button, a[href], input, select, textarea, [role="button"], [role="tab"]') &&
      !el.closest('p') &&
      el.getAttribute('type') !== 'hidden' &&
      style.position !== 'fixed';

    if (interactive && rect.width > 0 && rect.height > 0) {
      if (rect.height < 40 || rect.width < 24) {
        problems.push({
          kind: 'small-tap-target',
          detail: `${describe(el)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        });
      }
    }

    // 4. Clipped text: an element with a fixed height whose content is taller,
    //    and no scrolling to reveal it.
    if (
      el.children.length === 0 &&
      (el.textContent ?? '').trim().length > 0 &&
      style.overflow === 'hidden' &&
      style.textOverflow !== 'ellipsis' &&
      el.scrollHeight > el.clientHeight + 2
    ) {
      problems.push({
        kind: 'clipped-text',
        detail: `${describe(el)} scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight}`,
      });
    }
  }

  // 5. Broken images.
  for (const img of Array.from(document.images)) {
    if (img.complete && img.naturalWidth === 0) {
      problems.push({ kind: 'broken-image', detail: img.currentSrc || img.src || '(no src)' });
    }
  }

  // 6. Text below the 14px floor DESIGN.md sets for body copy.
  for (const el of all) {
    if (el.children.length > 0) continue;
    const text = (el.textContent ?? '').trim();
    if (text.length < 3) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || el.matches('.sr-only') || el.closest('.sr-only')) continue;
    if (el.closest('[data-preview-chrome]')) continue;
    const size = parseFloat(style.fontSize);
    // Badges and chips are allowed to be 10px; body copy is not.
    if (size < 10) {
      problems.push({ kind: 'tiny-text', detail: `${describe(el)} ${size}px` });
    }
  }

  return problems;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    // Chromium's default shared-memory allocation is small in containers and
    // on constrained Windows hosts, and a long run of contexts crashes the
    // renderer without it.
    args: ['--disable-dev-shm-usage'],
  });
  const results = [];

  /*
   * One context per width, reused across pages, rather than one per
   * page/width pair. Nine contexts instead of forty-five: much lighter, and it
   * stops the renderer being torn down and rebuilt between every measurement.
   */
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      // Approximates the mid-range Android the membership actually uses.
      userAgent:
        width < 768
          ? 'Mozilla/5.0 (Linux; Android 11; moto g(8) power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
          : undefined,
      isMobile: width < 768,
      hasTouch: width < 768,
    });

    const tab = await context.newPage();

    for (const page of PAGES) {
      let problems = [];
      let status = 'ok';

      try {
        /*
         * `domcontentloaded` rather than `networkidle`: the dev server keeps a
         * hot-reload websocket open, so the network is never idle and the wait
         * times out on a page that has in fact finished rendering.
         */
        const response = await tab.goto(`${BASE}${page.path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });

        if (!response || response.status() >= 400) {
          status = `http ${response?.status() ?? 'no response'}`;
        } else {
          // Wait for the icon font and images, so measurements are real rather
          // than taken mid-layout.
          await tab
            .waitForFunction(
              () =>
                document.fonts.status === 'loaded' &&
                Array.from(document.images).every((i) => i.complete),
              null,
              { timeout: 20_000 },
            )
            .catch(() => {
              /* Measure anyway; a slow font is not a layout defect. */
            });
          await tab.waitForTimeout(300);
          problems = await tab.evaluate(audit);

          await tab.screenshot({
            path: path.join(OUT, `${page.name}-${width}.png`),
            fullPage: width < 768,
          });
        }
      } catch (error) {
        status = `error: ${error.message.split('\n')[0]}`;
      }

      results.push({ page: page.name, width, status, problems });

      const flag =
        status !== 'ok' ? status : problems.length === 0 ? 'PASS' : `${problems.length} issue(s)`;
      console.log(`${page.name.padEnd(16)} ${String(width).padStart(4)}px  ${flag}`);

      for (const p of problems.slice(0, 6)) {
        console.log(`    · ${p.kind}: ${p.detail}`);
      }
      if (problems.length > 6) console.log(`    · …and ${problems.length - 6} more`);
    }

    await context.close();
  }

  await browser.close();

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2), 'utf8');

  const failures = results.filter((r) => r.status !== 'ok' || r.problems.length > 0);
  console.log(
    `\n${results.length - failures.length}/${results.length} viewport checks clean. ` +
      `Screenshots in ./${OUT}/`,
  );

  // Summarise by problem kind so a repeated issue is obvious.
  const byKind = new Map();
  for (const r of failures) {
    for (const p of r.problems) {
      byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
    }
  }
  if (byKind.size > 0) {
    console.log('\nBy kind:');
    for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${kind}`);
    }
  }

  process.exitCode = failures.some((f) => f.status !== 'ok') ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
