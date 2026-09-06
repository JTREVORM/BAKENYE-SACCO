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

/** Patterns that mean the message is safe to show verbatim - we wrote it. */
const RAW_LEAK = /(relation |column |constraint |syntax error|pg_|SQLSTATE|duplicate key value)/i;

export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.';

  if (typeof error === 'string') {
    return RAW_LEAK.test(error) ? 'Something went wrong. Please try again.' : error;
  }

  const e = error as { code?: string; message?: string; details?: string; hint?: string };

  if (e.code && CODE_MESSAGES[e.code]) {
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
    return CODE_MESSAGES[e.code];
  }

  const message = e.message ?? '';
  if (!message) return 'Something went wrong. Please try again.';
  if (RAW_LEAK.test(message)) return 'Something went wrong. Please try again.';

  // Supabase wraps PostgREST failures; strip the noise our RPCs never produce.
  return message.replace(/^ERROR:\s*/i, '').trim();
}

export function fail(error: unknown, field?: string): ActionResult<never> {
  return { ok: false, error: friendlyError(error), field };
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
