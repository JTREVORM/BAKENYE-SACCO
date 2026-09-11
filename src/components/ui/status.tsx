import { Badge, type BadgeTone } from './primitives';
import {
  LOAN_STATUS_LABELS,
  MEMBER_STATUS_LABELS,
  SAVINGS_STATUS_LABELS,
  GUARANTOR_STATUS_LABELS,
} from '@/lib/format';
import type {
  LoanStatus,
  MemberStatus,
  SavingsStatus,
  GuarantorStatus,
  TxnStatus,
  ApprovalStatus,
} from '@/types/db';

/**
 * One place that decides what colour a status is.
 *
 * Keeping these together stops "Approved" being green on one screen and blue on
 * another, which in a financial UI reads as two different things.
 */

const LOAN_TONES: Record<LoanStatus, BadgeTone> = {
  applied: 'neutral',
  under_review: 'warning',
  approved: 'info',
  rejected: 'error',
  disbursed: 'success',
  active: 'success',
  completed: 'neutral',
  defaulted: 'error',
  written_off: 'error',
};

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  return <Badge tone={LOAN_TONES[status]}>{LOAN_STATUS_LABELS[status]}</Badge>;
}

const MEMBER_TONES: Record<MemberStatus, BadgeTone> = {
  pending: 'info',
  active: 'success',
  inactive: 'neutral',
  suspended: 'warning',
  archived: 'neutral',
  exited: 'error',
};

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  return <Badge tone={MEMBER_TONES[status]}>{MEMBER_STATUS_LABELS[status]}</Badge>;
}

const SAVINGS_TONES: Record<SavingsStatus, BadgeTone> = {
  paid: 'success',
  partial: 'warning',
  pending: 'neutral',
  missed: 'error',
  waived: 'info',
};

export function SavingsStatusBadge({ status }: { status: SavingsStatus }) {
  return <Badge tone={SAVINGS_TONES[status]}>{SAVINGS_STATUS_LABELS[status]}</Badge>;
}

const GUARANTOR_TONES: Record<GuarantorStatus, BadgeTone> = {
  pending: 'warning',
  accepted: 'success',
  declined: 'error',
  released: 'neutral',
};

export function GuarantorStatusBadge({ status }: { status: GuarantorStatus }) {
  return <Badge tone={GUARANTOR_TONES[status]}>{GUARANTOR_STATUS_LABELS[status]}</Badge>;
}

/**
 * Transaction status. A reversed row must be unmistakable in a list — a member
 * seeing a payment they know was cancelled still sitting in their history
 * without a marker will reasonably think the SACCO lost their money.
 */
export function TxnStatusBadge({ status }: { status: TxnStatus }) {
  if (status === 'posted') return <Badge tone="success">Success</Badge>;
  if (status === 'reversed') return <Badge tone="error">Reversed</Badge>;
  return <Badge tone="warning">Reversal</Badge>;
}

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const tone: BadgeTone =
    status === 'approved' ? 'success' : status === 'rejected' ? 'error' : 'warning';
  const label = status[0].toUpperCase() + status.slice(1);
  return <Badge tone={tone}>{label}</Badge>;
}
