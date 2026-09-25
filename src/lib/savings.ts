import type { SavingsKind, SavingsStatus } from '@/types/db';
import type { BadgeTone } from '@/components/ui/primitives';

/**
 * The vocabulary of open savings and flat-priced shares, in one place.
 *
 * What is deliberately *not* here: amounts. The share price is a row in
 * `share_settings` and the registration fee is a row in `fees`, both editable
 * by a manager and both read back on every screen. A constant in this file
 * would be a second answer to a question the SACCO has already answered.
 *
 * What is also not here any more: tiers. There is no Silver, Gold or Diamond,
 * no monthly target and no classification of a member by what they save.
 */

/** The period one savings record covers. Monthly is what the SACCO collects. */
export const SAVINGS_KIND_LABELS: Record<SavingsKind, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export const SAVINGS_KIND_PERIOD: Record<SavingsKind, string> = {
  weekly: 'week',
  monthly: 'month',
};

/**
 * What a month's savings record says about itself.
 *
 * `pending` is a month nothing has been saved in yet — a fact, not a debt.
 * `partial` and `missed` can only appear on records raised before the rules
 * changed; they are kept so an old statement still reads the way it read at
 * the time, and they are never raised again.
 */
export const SAVINGS_STATUS_LABELS: Record<SavingsStatus, string> = {
  paid: 'Saved',
  partial: 'Part saved',
  pending: 'Nothing saved',
  missed: 'Nothing saved',
  waived: 'Waived',
};

export const SAVINGS_STATUS_TONES: Record<SavingsStatus, BadgeTone> = {
  paid: 'success',
  partial: 'info',
  pending: 'neutral',
  missed: 'neutral',
  waived: 'neutral',
};

export const SAVINGS_STATUS_HINTS: Record<SavingsStatus, string> = {
  paid: 'Savings were recorded in this month.',
  partial: 'Recorded before savings became open; part of an old target was met.',
  pending: 'Nothing recorded in this month. Savings are open, so nothing is owed.',
  missed: 'Nothing was recorded in this month. Savings are open, so nothing is owed.',
  waived: 'An old expectation a manager forgave. No amount is owed.',
};

/** "3 deposits" / "1 deposit" — the count a savings row wants to show. */
export function depositCount(n: number): string {
  return `${n} ${n === 1 ? 'deposit' : 'deposits'}`;
}

/** "25 shares" / "1 share". */
export function shareCount(n: number): string {
  return `${n} ${n === 1 ? 'share' : 'shares'}`;
}

/**
 * What a number of shares costs at the SACCO's price.
 *
 * Returns null when the price cannot be read, so a screen says the price is
 * unavailable rather than quoting UGX 0 as if it were a fact. This is for
 * *showing* a total; the database multiplies again when the sale is recorded,
 * and refuses it if the two disagree.
 */
export function shareTotal(quantity: number, unitPrice: number | null): number | null {
  if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  return quantity * unitPrice;
}

/**
 * Whether a typed quantity is a share quantity the SACCO will accept: a whole
 * number of at least one. The same rule the database enforces, said early so a
 * member is not told about it only in a rejection.
 */
export function isValidShareQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}
