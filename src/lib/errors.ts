/**
 * Turning database errors into sentences a SACCO cashier can act on.
 *
 * Rule 29 of the brief: never show a raw database error. Our RPCs already
 * raise human-readable messages (`Payment of UGX 200,000 exceeds the
 * outstanding balance of UGX 150,000.`), so those pass through. Anything that
 * leaks a constraint name, a SQL fragment or a stack gets replaced.
 */

export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; field?: string };

const CODE_MESSAGES: Record<string, string> = {
  '23505': 'That record already exists. Please check for a duplicate entry.',
  '23503': 'This record is linked to other data and cannot be changed.',
  '23514': 'The information provided is not valid for this operation.',
  '42501': 'You do not have permission to perform this action.',
  '42P01': 'The system is not fully set up yet. Please contact your administrator.',
  P0002: 'The record you are looking for no longer exists.',
  PGRST116: 'The record you are looking for no longer exists.',
  PGRST301: 'Your session has expired. Please sign in again.',
};

/**
 * Patterns that mean a message came from Postgres itself rather than from one
 * of our functions, and would leak a table, a column or a type if shown.
 */
const RAW_LEAK =
  /(relation |column |constraint |syntax|pg_|SQLSTATE|duplicate key value|invalid input|for type|overflow|permission denied|does not exist|operator |violates)/i;

export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.';

  if (typeof error === 'string') {
    return RAW_LEAK.test(error) ? 'Something went wrong. Please try again.' : error;
  }

  const e = error as { code?: string; message?: string; details?: string; hint?: string };

  // Our functions raise whole sentences - "0772 123 456 is already the phone
  // number of Jane Bakenye (BND26012)." - under standard codes such as
  // check_violation. Those are the most useful thing we can show, so they win
  // over the generic sentence for their code.
  const message = (e.message ?? '').replace(/^ERROR:\s*/i, '').trim();
  if (message && !RAW_LEAK.test(message)) return message;

  // A unique-violation on a known column is worth being specific about.
  if (e.code === '23505' && e.details) {
    if (/national_id/.test(e.details)) return 'A member with that National ID already exists.';
    if (/member_no/.test(e.details)) return 'That member number is already in use.';
    if (/idempotency_key/.test(e.details))
      return 'This transaction was already recorded. No duplicate was created.';
    if (/loans_one_active_per_member/.test(e.details))
      return 'This member already has an active loan.';
    if (/email/.test(e.details)) return 'That email address is already registered.';
  }
  if (e.code && CODE_MESSAGES[e.code]) return CODE_MESSAGES[e.code];

  return 'Something went wrong. Please try again.';
}

/**
 * The form field an error belongs to. Our functions name it in the exception
 * hint (`using hint = 'phone'`), so the message can sit under the right field.
 */
function fieldOf(error: unknown): string | undefined {
  const hint = (error as { hint?: unknown } | null)?.hint;
  return typeof hint === 'string' && /^[a-z_]{2,40}$/.test(hint) ? hint : undefined;
}

export function fail(error: unknown, field?: string): ActionResult<never> {
  return { ok: false, error: friendlyError(error), field: fieldOf(error) ?? field };
}

export function succeed<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

/**
 * A stable idempotency key for a financial submission.
 *
 * The client generates one per form instance and resends the same key on retry,
 * so a double-tap on a flaky connection posts once. See `post_transaction()`.
 */
export function newIdempotencyKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${rand}`;
}
