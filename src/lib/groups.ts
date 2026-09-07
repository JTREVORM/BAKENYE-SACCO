import type { GroupStatus, SavingDay, SavingFrequency, SavingsStatus } from '@/types/db';
import type { BadgeTone } from '@/components/ui/primitives';

/**
 * Group vocabulary, in one place.
 *
 * The saving day is stored as an ISO weekday because that is what Postgres
 * compares against `extract(isodow from ...)`. Everything user-facing goes
 * through here, so "3" is never printed at anyone.
 */

export const SAVING_DAYS: readonly { value: SavingDay; label: string; short: string }[] = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 7, label: 'Sunday', short: 'Sun' },
];

export function savingDayLabel(day: SavingDay | number | null | undefined): string {
  return SAVING_DAYS.find((d) => d.value === day)?.label ?? 'Unscheduled';
}

export function savingDayShort(day: SavingDay | number | null | undefined): string {
  return SAVING_DAYS.find((d) => d.value === day)?.short ?? '—';
}

/** Today as an ISO weekday, matching `saving_day`. */
export function todayIsoWeekday(now: Date = new Date()): SavingDay {
  const js = now.getDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as SavingDay;
}

export const SAVING_FREQUENCY_LABELS: Record<SavingFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
};

export const GROUP_STATUS_LABELS: Record<GroupStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  dissolved: 'Dissolved',
};

export const GROUP_STATUS_TONES: Record<GroupStatus, BadgeTone> = {
  active: 'success',
  inactive: 'neutral',
  dissolved: 'error',
};

/**
 * The savings kind a group collects. Biweekly groups still settle against a
 * weekly period; the frequency only decides which weeks they meet.
 */
export function savingsKindFor(frequency: SavingFrequency): 'weekly' | 'monthly' {
  return frequency === 'monthly' ? 'monthly' : 'weekly';
}

/** The target that applies to a group, given its frequency. */
export function groupTarget(group: {
  saving_frequency: SavingFrequency;
  weekly_target: number;
  monthly_target: number;
}): number {
  return savingsKindFor(group.saving_frequency) === 'monthly'
    ? Number(group.monthly_target)
    : Number(group.weekly_target);
}

/**
 * What a collection sheet row needs to say about itself, beyond the status
 * badge: a short sentence a cashier can act on.
 */
export const SCHEDULE_HINTS: Record<SavingsStatus, string> = {
  paid: 'Settled in full for this cycle.',
  partial: 'Part of the expected amount is still outstanding.',
  pending: 'Nothing recorded yet for this cycle.',
  missed: 'The due date passed with nothing recorded.',
  waived: 'Forgiven by a manager. No amount is owed.',
};
