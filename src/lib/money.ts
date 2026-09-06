/**
 * UGX money handling.
 *
 * Rules this module exists to enforce:
 *  - Money crossing the wire is a *string* of minor-unit-safe decimal digits or
 *    a number that came straight from NUMERIC(16,2). We never do arithmetic on
 *    it in the browser beyond display; every balance is computed in Postgres.
 *  - Display is always "UGX 2,500,000" - never "$2,500", never "2500".
 */

export const CURRENCY = 'UGX';

/** Parse whatever Postgres/JSON handed us into a number, safely. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const groupFormatter = new Intl.NumberFormat('en-UG', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const centsFormatter = new Intl.NumberFormat('en-UG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * "UGX 2,500,000". Shillings are not conventionally quoted in cents, so we
 * round to whole shillings for display unless the value actually has a
 * fractional part worth showing.
 */
export function formatUGX(value: unknown, opts?: { cents?: boolean; sign?: boolean }): string {
  const n = toNumber(value);
  const abs = Math.abs(n);
  const showCents = opts?.cents ?? abs % 1 !== 0;
  const body = showCents ? centsFormatter.format(abs) : groupFormatter.format(Math.round(abs));
  const sign = n < 0 ? '-' : opts?.sign && n > 0 ? '+' : '';
  return `${sign}${CURRENCY} ${body}`;
}

/** Number only, no currency prefix - for table cells that carry a UGX header. */
export function formatAmount(value: unknown, opts?: { cents?: boolean }): string {
  const n = toNumber(value);
  const showCents = opts?.cents ?? Math.abs(n) % 1 !== 0;
  return showCents ? centsFormatter.format(n) : groupFormatter.format(Math.round(n));
}

/**
 * Compact form for dashboard tiles where the Stitch design shows "125.4M".
 * Falls back to the grouped form below a million so small SACCOs don't see
 * "0.0M" on day one.
 */
export function formatCompactUGX(value: unknown): { amount: string; prefix: string } {
  const n = toNumber(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return { prefix: CURRENCY, amount: `${(n / 1_000_000_000).toFixed(1)}B` };
  if (abs >= 1_000_000) return { prefix: CURRENCY, amount: `${(n / 1_000_000).toFixed(1)}M` };
  if (abs >= 100_000) return { prefix: CURRENCY, amount: `${Math.round(n / 1000)}K` };
  return { prefix: CURRENCY, amount: groupFormatter.format(Math.round(n)) };
}

/**
 * Parse user input from a money field. Accepts "1,200,000", "1200000", "1.2".
 * Returns null when the input is not a usable amount so callers can show a
 * validation message rather than silently posting a NaN.
 */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s,]/g, '').replace(/^UGX/i, '');
  if (cleaned === '' || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Guard against a fat-fingered amount overflowing NUMERIC(16,2).
  if (n > 99_999_999_999_999) return null;
  return Math.round(n * 100) / 100;
}

/** Digit grouping while the user types, preserving caret-friendly plain text. */
export function groupDigits(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return groupFormatter.format(Number(digits));
}

export function percent(part: unknown, whole: unknown): number {
  const w = toNumber(whole);
  if (w === 0) return 0;
  return Math.min(100, Math.max(0, (toNumber(part) / w) * 100));
}
