import type {
  LoanStatus,
  MemberStatus,
  PaymentMethod,
  SavingsStatus,
  TxnType,
  GuarantorStatus,
} from '@/types/db';

// ---------------------------------------------------------------------------
// Dates. Uganda uses day-first ordering, so "15 Sep 2026" - matching the
// Stitch screens - not "Sep 15".
// ---------------------------------------------------------------------------

const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

const timeOnly = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  // A bare `YYYY-MM-DD` from Postgres must not be shifted by the local
  // timezone, or a payment recorded on the 1st shows as the previous month.
  const d =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | null | undefined, fallback = '—'): string {
  const d = asDate(value);
  return d ? dayMonthYear.format(d) : fallback;
}

export function formatDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const d = asDate(value);
  return d ? `${dayMonthYear.format(d)}, ${timeOnly.format(d)}` : fallback;
}

export function formatShortDate(value: string | Date | null | undefined, fallback = '—'): string {
  const d = asDate(value);
  return d ? dayMonth.format(d) : fallback;
}

/** "Today, 10:45 AM" / "Yesterday" / "12 Sep 2024" - as the Stitch feed shows. */
export function formatRelativeDay(value: string | Date | null | undefined): string {
  const d = asDate(value);
  if (!d) return '—';

  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);

  if (days === 0) return `Today, ${timeOnly.format(d)}`;
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return dayMonthYear.format(d);
}

/** "10 mins ago" for the activity timeline. */
export function formatAgo(value: string | Date | null | undefined): string {
  const d = asDate(value);
  if (!d) return '—';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return dayMonthYear.format(d);
}

/** `YYYY-MM-DD` for `<input type="date">` and Postgres date params. */
export function toISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function monthStart(d: Date = new Date()): string {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function monthEnd(d: Date = new Date()): string {
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function daysUntil(value: string | Date | null | undefined): number | null {
  const d = asDate(value);
  if (!d) return null;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const TXN_LABELS: Record<TxnType, string> = {
  share_purchase: 'Share Purchase',
  weekly_savings: 'Weekly Savings',
  monthly_savings: 'Monthly Savings',
  loan_disbursement: 'Loan Disbursement',
  loan_repayment: 'Loan Repayment',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  income: 'Income',
  expense: 'Expense',
  fee: 'Fee',
  penalty: 'Penalty',
  transfer: 'Internal Transfer',
  payment: 'Payment',
};

/** Material Symbols glyph per transaction type, as used in the Stitch feed. */
export const TXN_ICONS: Record<TxnType, string> = {
  share_purchase: 'pie_chart',
  weekly_savings: 'savings',
  monthly_savings: 'savings',
  loan_disbursement: 'account_balance',
  loan_repayment: 'credit_score',
  deposit: 'add_circle',
  withdrawal: 'remove_circle',
  income: 'trending_up',
  expense: 'trending_down',
  fee: 'receipt',
  penalty: 'gavel',
  transfer: 'swap_horiz',
  payment: 'request_quote',
};

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  applied: 'Applied',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  disbursed: 'Disbursed',
  active: 'Active',
  completed: 'Completed',
  defaulted: 'Defaulted',
  written_off: 'Written Off',
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  suspended: 'Suspended',
  inactive: 'Inactive',
  archived: 'Archived',
  exited: 'Exited',
};

/** The statuses a person may choose; `exited` survives only in history. */
export const SELECTABLE_MEMBER_STATUSES: readonly MemberStatus[] = [
  'active', 'suspended', 'inactive', 'archived',
];

export const MEMBER_STATUS_HINTS: Record<MemberStatus, string> = {
  pending: 'Registered; mandatory registration fees not yet paid.',
  active: 'A full member.',
  suspended: 'Temporarily barred. Balances and obligations stand.',
  inactive: 'Dormant. Needs no loan owing.',
  archived: 'Has left the SACCO. The record is kept, never deleted. Needs no loan owing.',
  exited: 'Left the SACCO (historical status).',
};

export const SAVINGS_STATUS_LABELS: Record<SavingsStatus, string> = {
  paid: 'Paid',
  partial: 'Partial',
  pending: 'Pending',
  missed: 'Missed',
  waived: 'Waived',
};

export const GUARANTOR_STATUS_LABELS: Record<GuarantorStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  released: 'Released',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  internal: 'Internal',
};

/** Initials for the avatar fallback, e.g. "John Musoke" -> "JM". */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Ugandan numbers display as 0772 123 456 but are stored as +256772123456. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('256') ? `0${digits.slice(3)}` : digits;
  if (local.length === 10) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  return phone;
}

/** Normalise a typed phone number to E.164 for storage. */
export function normalisePhone(phone: string): string {
  return normaliseUgandanMobile(phone) ?? `+${phone.replace(/\D/g, '')}`;
}

/**
 * A Ugandan mobile number in its one stored form, +2567XXXXXXXX, or null if
 * it is not one. Accepts 07XXXXXXXX, 7XXXXXXXX, 2567XXXXXXXX, +2567XXXXXXXX and
 * 002567XXXXXXXX with any spaces or dashes - the same rules as the database's
 * `normalize_ug_phone()`, which has the final say.
 */
export function normaliseUgandanMobile(phone: string | null | undefined): string | null {
  let d = (phone ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00256')) d = d.slice(2);
  if (d.startsWith('256')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^7\d{8}$/.test(d) ? `+256${d}` : null;
}
