import { toNumber } from '@/lib/money';
import type { BadgeTone } from '@/components/ui/primitives';
import type { IconName } from '@/lib/icons';
import type {
  CollectionType,
  FinanceAccountType,
  FinanceDocStatus,
  MovementClass,
  TransferKind,
  TreasuryMovement,
} from '@/types/treasury';

/**
 * The vocabulary of Cash at Merchant, Cash at Bank and Cash at Hand, shared by
 * every finance screen so a label, an icon or a colour means one thing
 * everywhere.
 *
 * Nothing in this file computes a balance. The figures come from the database;
 * `dayFigures()` and `activityLines()` only *group* movements the database has
 * already classified, so the dashboard card and the activity list cannot
 * disagree about what "today's collections" means.
 */

export const ACCOUNT_TYPES: FinanceAccountType[] = ['merchant', 'bank', 'cash'];

export const ACCOUNT_TYPE_META: Record<
  FinanceAccountType,
  {
    label: string;
    short: string;
    icon: IconName;
    subtitle: string;
    href: string;
    /** The validated chart colour for this kind of account. */
    colour: string;
    /** Identity stripe on cards — never used for text. */
    stripe: string;
    noun: string;
  }
> = {
  merchant: {
    label: 'Cash at Merchant',
    short: 'Merchant',
    icon: 'smartphone',
    subtitle: 'Money collected through Merchant Code / Mobile Money',
    href: '/staff/finance/merchant',
    colour: '#b07f00',
    stripe: 'bg-acct-merchant',
    noun: 'merchant account',
  },
  bank: {
    label: 'Cash at Bank',
    short: 'Bank',
    icon: 'account_balance',
    subtitle: 'Money currently held in SACCO bank account',
    href: '/staff/finance/bank',
    colour: '#2f5ba8',
    stripe: 'bg-acct-bank',
    noun: 'bank account',
  },
  cash: {
    label: 'Cash at Hand',
    short: 'Cash',
    icon: 'payments',
    subtitle: 'Physical cash currently held by the SACCO',
    href: '/staff/finance/cash',
    colour: '#1d9aa8',
    stripe: 'bg-acct-cash',
    noun: 'cash account',
  },
};

export function isAccountType(value: string | undefined | null): value is FinanceAccountType {
  return value === 'merchant' || value === 'bank' || value === 'cash';
}

export const TRANSFER_KINDS: TransferKind[] = [
  'merchant_to_bank',
  'cash_to_bank',
  'bank_to_cash',
  'bank_to_bank',
];

export const TRANSFER_KIND_META: Record<
  TransferKind,
  {
    label: string;
    title: string;
    icon: IconName;
    from: FinanceAccountType;
    to: FinanceAccountType;
    defaultDescription: string;
    sourceRefLabel: string;
    sourceRefRequired: boolean;
    destinationRefLabel: string;
    destinationRefRequired: boolean;
    handledByLabel: string;
    showPurpose: boolean;
  }
> = {
  merchant_to_bank: {
    label: 'Merchant → Bank',
    title: 'Transfer Merchant to Bank',
    icon: 'swap_horiz',
    from: 'merchant',
    to: 'bank',
    defaultDescription:
      'Transfer of member savings collections from merchant account to SACCO bank account.',
    sourceRefLabel: 'Merchant transaction reference',
    sourceRefRequired: true,
    destinationRefLabel: 'Bank deposit / transfer reference',
    destinationRefRequired: true,
    handledByLabel: 'Transferred by',
    showPurpose: false,
  },
  cash_to_bank: {
    label: 'Cash → Bank',
    title: 'Deposit Cash to Bank',
    icon: 'local_atm',
    from: 'cash',
    to: 'bank',
    defaultDescription: 'Deposit of cash at hand into the SACCO bank account.',
    sourceRefLabel: 'Cash book or voucher reference',
    sourceRefRequired: false,
    destinationRefLabel: 'Deposit slip number',
    destinationRefRequired: true,
    handledByLabel: 'Deposited by',
    showPurpose: false,
  },
  bank_to_cash: {
    label: 'Bank → Cash',
    title: 'Withdraw from Bank',
    icon: 'account_balance',
    from: 'bank',
    to: 'cash',
    defaultDescription: 'Cash withdrawn from the bank for office use.',
    sourceRefLabel: 'Withdrawal or cheque reference',
    sourceRefRequired: true,
    destinationRefLabel: 'Cash receipt reference',
    destinationRefRequired: false,
    handledByLabel: 'Withdrawn by',
    showPurpose: true,
  },
  bank_to_bank: {
    label: 'Bank → Bank',
    title: 'Transfer Between Bank Accounts',
    icon: 'sync_alt',
    from: 'bank',
    to: 'bank',
    defaultDescription: 'Transfer between SACCO bank accounts.',
    sourceRefLabel: 'Bank transfer reference',
    sourceRefRequired: true,
    destinationRefLabel: 'Receiving bank reference',
    destinationRefRequired: false,
    handledByLabel: 'Arranged by',
    showPurpose: false,
  },
};

export function isTransferKind(value: string | undefined | null): value is TransferKind {
  return !!value && (TRANSFER_KINDS as string[]).includes(value);
}

export const DOC_STATUS_META: Record<FinanceDocStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'error' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  reversed: { label: 'Reversed', tone: 'error' },
};

export const MOVEMENT_LABELS: Record<MovementClass, string> = {
  collection: 'Member collection',
  other_receipt: 'Other receipt',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  expense: 'Expense',
  payment: 'Payment',
  reversal: 'Reversal',
};

export const COLLECTION_TYPES: { value: CollectionType; label: string; hint: string }[] = [
  { value: 'savings', label: 'Savings', hint: 'Posted against the member’s savings schedule.' },
  { value: 'shares', label: 'Share purchase', hint: 'Bought at the SACCO’s one share price.' },
  { value: 'loan_repayment', label: 'Loan repayment', hint: 'Interest first, then principal.' },
  { value: 'deposit', label: 'Voluntary deposit', hint: 'Added to the member’s savings balance.' },
  { value: 'fee', label: 'Membership or other fee', hint: 'Booked as SACCO income.' },
];

/* --------------------------------------------------------------------------
 * Grouping a day's movements
 * ----------------------------------------------------------------------- */

type Pred = (m: TreasuryMovement) => boolean;

function total(movements: TreasuryMovement[], pred: Pred, side: 'money_in' | 'money_out'): number {
  return movements.filter(pred).reduce((s, m) => s + toNumber(m[side]), 0);
}

const received: Pred = (m) =>
  m.movement_class === 'collection' || m.movement_class === 'other_receipt';
const spent: Pred = (m) => m.movement_class === 'payment' || m.movement_class === 'expense';

/** The figures each of the three account cards shows for a day. */
export function dayFigures(movements: TreasuryMovement[]) {
  const on = (t: FinanceAccountType, pred: Pred): Pred => (m) => m.account_type === t && pred(m);

  return {
    merchant: {
      collections: total(movements, on('merchant', received), 'money_in'),
      toBank: total(
        movements,
        on('merchant', (m) => m.movement_class === 'transfer_out' && m.counter_account_type === 'bank'),
        'money_out',
      ),
      payments: total(movements, on('merchant', spent), 'money_out'),
    },
    bank: {
      deposits: total(movements, on('bank', (m) => m.movement_class === 'transfer_in'), 'money_in'),
      receipts: total(movements, on('bank', received), 'money_in'),
      withdrawals: total(
        movements,
        on('bank', (m) => m.movement_class === 'transfer_out' && m.counter_account_type === 'cash'),
        'money_out',
      ),
      transfersOut: total(
        movements,
        on('bank', (m) => m.movement_class === 'transfer_out' && m.counter_account_type === 'bank'),
        'money_out',
      ),
      payments: total(movements, on('bank', spent), 'money_out'),
    },
    cash: {
      received: total(
        movements,
        on('cash', (m) => received(m) || m.movement_class === 'transfer_in'),
        'money_in',
      ),
      toBank: total(movements, on('cash', (m) => m.movement_class === 'transfer_out'), 'money_out'),
      payments: total(movements, on('cash', spent), 'money_out'),
    },
  };
}

export type ActivityLine = {
  key: string;
  label: string;
  icon: IconName;
  amount: number;
  /** in: money received · out: money paid · move: between SACCO accounts · net: signed */
  kind: 'in' | 'out' | 'move' | 'net';
  /** Shown even at zero, because the brief names it. */
  always: boolean;
};

/**
 * Today's activity as disjoint lines: every movement falls in exactly one, so
 * a reader who adds the "in" lines gets what came in.
 */
export function activityLines(movements: TreasuryMovement[]): ActivityLine[] {
  const is = (t: FinanceAccountType, c: MovementClass, counter?: FinanceAccountType): Pred => (m) =>
    m.account_type === t &&
    m.movement_class === c &&
    (counter === undefined || m.counter_account_type === counter);

  const reversalNet = movements
    .filter((m) => m.movement_class === 'reversal')
    .reduce((s, m) => s + toNumber(m.money_in) - toNumber(m.money_out), 0);

  const lines: ActivityLine[] = [
    { key: 'merchant_collections', label: 'Merchant collections', icon: 'smartphone', kind: 'in', always: true,
      amount: total(movements, is('merchant', 'collection'), 'money_in') },
    { key: 'cash_collections', label: 'Cash collections', icon: 'payments', kind: 'in', always: true,
      amount: total(movements, is('cash', 'collection'), 'money_in') },
    { key: 'bank_collections', label: 'Collections paid into the bank', icon: 'account_balance', kind: 'in', always: false,
      amount: total(movements, is('bank', 'collection'), 'money_in') },
    { key: 'other_receipts', label: 'Other receipts', icon: 'call_received', kind: 'in', always: true,
      amount: total(movements, (m) => m.movement_class === 'other_receipt', 'money_in') },
    { key: 'merchant_to_bank', label: 'Merchant → Bank', icon: 'swap_horiz', kind: 'move', always: true,
      amount: total(movements, is('merchant', 'transfer_out', 'bank'), 'money_out') },
    { key: 'cash_to_bank', label: 'Cash → Bank', icon: 'local_atm', kind: 'move', always: true,
      amount: total(movements, is('cash', 'transfer_out', 'bank'), 'money_out') },
    { key: 'bank_to_cash', label: 'Bank → Cash withdrawals', icon: 'account_balance', kind: 'move', always: true,
      amount: total(movements, is('bank', 'transfer_out', 'cash'), 'money_out') },
    { key: 'bank_to_bank', label: 'Bank → Bank', icon: 'sync_alt', kind: 'move', always: false,
      amount: total(movements, is('bank', 'transfer_out', 'bank'), 'money_out') },
    { key: 'bank_payments', label: 'Bank payments', icon: 'request_quote', kind: 'out', always: true,
      amount: total(movements, is('bank', 'payment'), 'money_out') },
    { key: 'cash_payments', label: 'Cash payments', icon: 'request_quote', kind: 'out', always: true,
      amount: total(movements, is('cash', 'payment'), 'money_out') },
    { key: 'merchant_payments', label: 'Merchant payments', icon: 'request_quote', kind: 'out', always: false,
      amount: total(movements, is('merchant', 'payment'), 'money_out') },
    { key: 'expenses', label: 'Expenses', icon: 'trending_down', kind: 'out', always: true,
      amount: total(movements, (m) => m.movement_class === 'expense', 'money_out') },
    { key: 'reversals', label: 'Reversals (net)', icon: 'undo', kind: 'net', always: false,
      amount: reversalNet },
  ];

  return lines.filter((l) => l.always || l.amount !== 0);
}

/** "0772 123 456" style masking for account numbers shown in lists. */
export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return '—';
  const clean = value.replace(/\s+/g, '');
  if (clean.length <= 4) return clean;
  return `•••• ${clean.slice(-4)}`;
}
