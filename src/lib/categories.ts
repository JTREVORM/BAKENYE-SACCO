import type {
  CategoryStatus,
  SavingsCategoryRow,
  SavingsFrequency,
  SavingsStatus,
  ShareCategoryRow,
} from '@/types/db';
import type { BadgeTone } from '@/components/ui/primitives';
import { formatUGX } from '@/lib/money';

/**
 * Category vocabulary, in one place.
 *
 * Everything user-facing about a share or savings category goes through here,
 * so "monthly" is never printed raw at anyone and Diamond is the same colour on
 * the member's phone as it is on the manager's register.
 *
 * Note what is *not* here: no amounts, no share counts, no qualification
 * windows. Those live in `share_categories` and `savings_categories` in the
 * database, are editable by a manager, and are read back on every screen. A
 * constant in this file would be a second answer to a question the SACCO has
 * already answered.
 */

export const SAVINGS_FREQUENCY_LABELS: Record<SavingsFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/** "UGX 5,000 a week" — the form a sentence wants. */
export const SAVINGS_FREQUENCY_ADVERB: Record<SavingsFrequency, string> = {
  weekly: 'a week',
  monthly: 'a month',
};

/** "every week" — the form a caption wants. */
export const SAVINGS_FREQUENCY_EVERY: Record<SavingsFrequency, string> = {
  weekly: 'every week',
  monthly: 'every month',
};

/** The period one contribution covers, named. */
export const SAVINGS_FREQUENCY_PERIOD: Record<SavingsFrequency, string> = {
  weekly: 'week',
  monthly: 'month',
};

export const CATEGORY_STATUS_LABELS: Record<CategoryStatus, string> = {
  active: 'Active',
  inactive: 'Retired',
};

export const CATEGORY_STATUS_TONES: Record<CategoryStatus, BadgeTone> = {
  active: 'success',
  inactive: 'neutral',
};

/**
 * The visual identity of a tier.
 *
 * Keyed on the category code rather than its name, because a manager may rename
 * "Diamond" to "Diamond Tier" without meaning to change its colour. An unknown
 * code — a category the SACCO invents next year — falls back to the neutral
 * treatment rather than borrowing a tier's identity.
 */
type Tier = { tone: BadgeTone; icon: string; accent: string };

const TIERS: Record<string, Tier> = {
  DIAMOND: { tone: 'info', icon: 'diamond', accent: 'text-primary' },
  GOLD: { tone: 'accent', icon: 'workspace_premium', accent: 'text-secondary' },
  SILVER: { tone: 'neutral', icon: 'military_tech', accent: 'text-on-surface-variant' },
};

export function categoryTier(code: string | null | undefined): Tier {
  if (!code) return { tone: 'neutral', icon: 'category', accent: 'text-on-surface-variant' };
  const key = code.split('_')[0].toUpperCase();
  return TIERS[key] ?? { tone: 'neutral', icon: 'category', accent: 'text-on-surface-variant' };
}

/**
 * A savings category as one line: "Gold Saver · UGX 50,000 a month".
 *
 * Both halves come from the row, so editing the amount in the administration
 * screen changes every place this string appears.
 */
export function savingsCategoryLine(
  category: Pick<SavingsCategoryRow, 'name' | 'amount' | 'frequency'>,
): string {
  return `${category.name} · ${formatUGX(category.amount)} ${
    SAVINGS_FREQUENCY_ADVERB[category.frequency]
  }`;
}

/** A share category as one line: "Diamond · 50 shares · UGX 1,000,000". */
export function shareCategoryLine(
  category: Pick<ShareCategoryRow, 'name' | 'required_shares' | 'required_amount'>,
): string {
  return `${category.name} · ${category.required_shares} ${
    category.required_shares === 1 ? 'share' : 'shares'
  } · ${formatUGX(category.required_amount)}`;
}

/**
 * How the qualification window reads.
 *
 * Null months means the category has no deadline, which is a fact worth saying
 * plainly rather than leaving as a blank cell.
 */
export function qualificationWindow(months: number | null | undefined): string {
  if (!months) return 'No deadline';
  if (months === 1) return 'Within the first month of membership';
  return `Within the first ${months} months of membership`;
}

/**
 * What a schedule row needs to say about itself, beyond the status badge: a
 * short sentence a cashier can act on.
 */
export const SCHEDULE_HINTS: Record<SavingsStatus, string> = {
  paid: 'Settled in full for this cycle.',
  partial: 'Part of the expected amount is still outstanding.',
  pending: 'Nothing recorded yet for this cycle.',
  missed: 'The due date passed with nothing recorded.',
  waived: 'Forgiven by a manager. No amount is owed.',
};

/**
 * The share-progress sentence, for a member who has a category.
 *
 * Returns null when there is no category or no target, so a caller renders an
 * empty state rather than "0% of 0 shares".
 */
export function shareProgressCaption(progress: {
  shares_owned: number;
  target_shares: number | null;
  shares_remaining: number | null;
  qualified: boolean;
}): string | null {
  if (!progress.target_shares) return null;
  if (progress.qualified) {
    return `${progress.shares_owned} of ${progress.target_shares} shares held — qualified.`;
  }
  return `${progress.shares_owned} of ${progress.target_shares} shares held · ${
    progress.shares_remaining ?? 0
  } to go`;
}
