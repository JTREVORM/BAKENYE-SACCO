/**
 * The vocabulary of the Membership Fees module.
 *
 * The membership fee is the one payment every member must make to join. It is
 * whatever the `fees` table currently says it is — no figure is written down
 * here, and none should be. What lives here is only how the four states are
 * named and coloured on screen, so the dashboard, the table and the member's
 * profile all say the same word for the same thing.
 */
import type { MembershipFeeStatus } from '@/types/db';

export const MEMBERSHIP_FEE_STATUS_LABELS: Record<MembershipFeeStatus, string> = {
  paid: 'Paid',
  partial: 'Part paid',
  unpaid: 'Unpaid',
  waived: 'Waived',
  none: 'Not charged',
};

export const MEMBERSHIP_FEE_STATUS_TONES: Record<MembershipFeeStatus, string> = {
  paid: 'bg-tertiary-fixed text-on-tertiary-fixed',
  partial: 'bg-secondary-fixed text-on-secondary-fixed',
  unpaid: 'bg-error-container text-on-error-container',
  waived: 'bg-surface-container-high text-on-surface-variant',
  none: 'bg-surface-container text-on-surface-variant',
};

/** What each state means, said once, for a hint or a tooltip. */
export const MEMBERSHIP_FEE_STATUS_HINTS: Record<MembershipFeeStatus, string> = {
  paid: 'The membership fee has been settled in full.',
  partial: 'Some of the membership fee has been received. The balance is still owed.',
  unpaid: 'Nothing has been received towards the membership fee yet.',
  waived: 'A manager excused this membership fee, with a written reason.',
  none: 'This member has no membership fee charge on their record.',
};
