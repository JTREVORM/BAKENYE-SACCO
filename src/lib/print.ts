/**
 * Printing, and the file name the browser gives a saved PDF.
 *
 * Every browser that offers "Save as PDF" as a print destination takes the
 * suggested file name from `document.title`. Left alone that is the Next.js
 * page title — "Savings by Category" — so every report a manager saves lands in
 * Downloads with the same generic name and no date on it.
 *
 * So the title is swapped for a real document name for the duration of the
 * print, then put back. It is restored in a `finally` and again on
 * `afterprint`, because the print dialog is modal in some browsers and
 * asynchronous in others, and a tab left renamed is worse than one never
 * renamed at all.
 */

/** Strip anything a file system would object to, and collapse whitespace. */
function safeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Print the current page as `title`.
 *
 * `title` becomes the suggested PDF file name. Pass what the document *is* —
 * "BUD-SACCO Member Register 2026-09-07" — not what the page is called.
 */
export function printDocument(title?: string): void {
  if (typeof window === 'undefined') return;

  const original = document.title;
  const restore = () => {
    document.title = original;
    window.removeEventListener('afterprint', restore);
  };

  if (title) {
    document.title = safeName(title);
    window.addEventListener('afterprint', restore);
  }

  try {
    window.print();
  } finally {
    // Browsers that block on `print()` are already done by here. Those that do
    // not are covered by the `afterprint` listener above.
    if (title) restore();
  }
}

/** `BUD-SACCO Member Register 2026-09-07` — the shape every export uses. */
export function documentName(title: string, subject?: string, on: Date = new Date()): string {
  const date = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, '0')}-${String(
    on.getDate(),
  ).padStart(2, '0')}`;
  return safeName(['BUD-SACCO', title, subject, date].filter(Boolean).join(' '));
}
