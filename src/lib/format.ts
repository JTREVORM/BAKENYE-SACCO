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

// Every formatter reads the clock in Uganda time, whatever zone the server or
// the phone is set to (see SACCO_TIME_ZONE below).
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Africa/Kampala',
});

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'Africa/Kampala' });

const timeOnly = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Africa/Kampala',
});

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  // A bare `YYYY-MM-DD` from Postgres is a Uganda calendar day. Pin it to
  // midday in Kampala so no zone can shift it to a neighbouring day - or a
  // payment recorded on the 1st would show as the previous month.
  const d =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00+03:00`)
      : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days from Uganda date `a` to Uganda date `b`. */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
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

  const days = dayDiff(toISODate(d), toISODate());

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

// ---------------------------------------------------------------------------
// The SACCO's calendar is Uganda's: East Africa Time, UTC+3, no daylight
// saving. The database runs in Africa/Kampala too (0036), so "today" means
// the same day to a server in a UTC data centre, to a phone set to any zone,
// and to Postgres. Never derive a business date from a Date's local getters:
// between midnight and 3 a.m. in Kampala, a UTC server still thinks it is
// yesterday.
// ---------------------------------------------------------------------------

export const SACCO_TIME_ZONE = 'Africa/Kampala';
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** A calendar date built from year / month (0-based, may overflow) / day, as YYYY-MM-DD. */
function ymd(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
}

/**
 * The Uganda calendar date of an instant, as `YYYY-MM-DD` - for
 * `<input type="date">` and Postgres date parameters. Defaults to now.
 */
export function toISODate(d: Date = new Date()): string {
  const eat = new Date(d.getTime() + EAT_OFFSET_MS);
  return `${eat.getUTCFullYear()}-${pad2(eat.getUTCMonth() + 1)}-${pad2(eat.getUTCDate())}`;
}

/** Today in Uganda, `YYYY-MM-DD`. */
export function todayISO(): string {
  return toISODate();
}

/** `YYYY-MM-DD` moved by whole days (negative to go back). */
export function addDaysISO(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  return ymd(y, m, d + days);
}

/** The first day of the month `months` away from the one containing `iso`. */
export function monthStartISO(iso: string = todayISO(), months = 0): string {
  const { y, m } = parts(iso);
  return ymd(y, m + months, 1);
}

/** The last day of the month `months` away from the one containing `iso`. */
export function monthEndISO(iso: string = todayISO(), months = 0): string {
  const { y, m } = parts(iso);
  return ymd(y, m + months + 1, 0);
}

/** 1 January of the year containing `iso`. */
export function yearStartISO(iso: string = todayISO()): string {
  return `${parts(iso).y}-01-01`;
}

/** The Monday of the week containing `iso` (weeks run Monday to Sunday). */
export function weekStartISO(iso: string = todayISO()): string {
  const { y, m, d } = parts(iso);
  const weekday = (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7;
  return ymd(y, m, d - weekday);
}

/** The Uganda year, e.g. for "Annual Statement 2026". */
export function currentYear(): number {
  return parts(todayISO()).y;
}

/** The first day of the Uganda month containing the instant `d`. */
export function monthStart(d: Date = new Date()): string {
  return monthStartISO(toISODate(d));
}

/** The last day of the Uganda month containing the instant `d`. */
export function monthEnd(d: Date = new Date()): string {
  return monthEndISO(toISODate(d));
}

export function daysUntil(value: string | Date | null | undefined): number | null {
  const d = asDate(value);
  if (!d) return null;
  return dayDiff(toISODate(), toISODate(d));
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
