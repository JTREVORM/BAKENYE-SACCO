'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { disburseLoan, setLoanStatus } from '@/app/actions/financial';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import { PAYMENT_METHOD_LABELS, toISODate } from '@/lib/format';
import { newIdempotencyKey, type ActionResult } from '@/lib/errors';
import type { LoanStatus, PaymentMethod } from '@/types/db';

/**
 * Loan lifecycle controls.
 *
 * Applied → Under Review → Approved → Disbursed → Active → Completed, with
 * Rejected as the alternative path. Only the transitions that are legal from
 * the loan's current state are offered, and the database re-checks each one, so
 * a stale tab cannot approve a loan that has already been declined.
 *
 * Disbursement is the moment money leaves the SACCO, so it gets the same
 * confirm-then-commit treatment as every other financial action, plus an
 * idempotency key — a double-click here would otherwise be a second loan's
 * worth of cash.
 */
export function LoanActions({
  loanId,
  loanNo,
  status,
  principal,
  processingFee,
  netDisbursed,
  memberName,
  guarantorsPending,
  canAssess,
  canApprove,
  canDisburse,
  canRepay,
}: {
  loanId: string;
  loanNo: string;
  status: LoanStatus;
  principal: number;
  processingFee: number;
  netDisbursed: number;
  memberName: string;
  guarantorsPending: number;
  canAssess: boolean;
  canApprove: boolean;
  canDisburse: boolean;
  canRepay: boolean;
}) {
  const [dialog, setDialog] = useState<null | 'review' | 'approve' | 'reject' | 'disburse'>(null);

  const canStartReview = canAssess && status === 'applied';
  const canDecide = canApprove && ['applied', 'under_review'].includes(status);
  const canReject = canAssess && ['applied', 'under_review'].includes(status);
  const canPayOut = canDisburse && status === 'approved';
  const isLive = ['active', 'disbursed', 'defaulted'].includes(status);

  const nothingToDo = !canStartReview && !canDecide && !canReject && !canPayOut && !isLive;
  if (nothingToDo) return null;

  return (
    <>
      <div className="bg-surface shadow-card flex flex-col gap-3 rounded-xl p-4">
        <h2 className="text-button-text font-button-text text-on-surface">Actions</h2>

        {status === 'approved' && guarantorsPending > 0 ? (
          <Alert tone="warning">
            {guarantorsPending} guarantor{guarantorsPending === 1 ? ' has' : 's have'} not yet
            accepted. Confirm their agreement before releasing funds.
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {canStartReview ? (
            <Button icon="assignment" onClick={() => setDialog('review')}>
              Start review
            </Button>
          ) : null}

          {canDecide ? (
            <Button icon="check_circle" onClick={() => setDialog('approve')}>
              Approve
            </Button>
          ) : null}

          {canReject ? (
            <Button variant="danger" icon="block" onClick={() => setDialog('reject')}>
              Decline
            </Button>
          ) : null}

          {canPayOut ? (
            <Button icon="account_balance" onClick={() => setDialog('disburse')}>
              Disburse funds
            </Button>
          ) : null}

          {isLive && canRepay ? (
            <Link
              href={`/staff/loans/${loanId}/repay`}
              className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold transition-colors"
            >
              <Icon name="payments" size={20} />
              Record repayment
            </Link>
          ) : null}
        </div>
      </div>

      <StatusDialog
        open={dialog === 'review'}
        onClose={() => setDialog(null)}
        loanId={loanId}
        loanNo={loanNo}
        status="under_review"
        title="Start review"
        description={`Move ${loanNo} into review. ${memberName} will be notified.`}
        submitLabel="Move to review"
        reasonLabel="Assessment notes"
        reasonRequired={false}
        reasonHint="Optional — visible to other officers on this application."
      />

      <StatusDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        loanId={loanId}
        loanNo={loanNo}
        status="approved"
        title="Approve this loan"
        description={`Approve ${formatUGX(principal)} for ${memberName}. Funds are not released until you disburse.`}
        submitLabel="Approve loan"
        reasonLabel="Approval notes"
        reasonRequired={false}
        tone="primary"
      />

      <StatusDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        loanId={loanId}
        loanNo={loanNo}
        status="rejected"
        title="Decline this application"
        description={`${memberName} will be told the loan was not approved, and will see the reason you give.`}
        submitLabel="Decline application"
        reasonLabel="Reason for declining"
        reasonRequired
        reasonHint="This is shown to the member. Be clear and factual."
        tone="danger"
      />

      <DisburseDialog
        open={dialog === 'disburse'}
        onClose={() => setDialog(null)}
        loanId={loanId}
        loanNo={loanNo}
        principal={principal}
        processingFee={processingFee}
        netDisbursed={netDisbursed}
        memberName={memberName}
      />
    </>
  );
}

/* ------------------------------------------------------------------------ */

function StatusDialog({
  open,
  onClose,
  loanId,
  loanNo,
  status,
  title,
  description,
  submitLabel,
  reasonLabel,
  reasonRequired,
  reasonHint,
  tone = 'primary',
}: {
  open: boolean;
  onClose: () => void;
  loanId: string;
  loanNo: string;
  status: 'under_review' | 'approved' | 'rejected';
  title: string;
  description: string;
  submitLabel: string;
  reasonLabel: string;
  reasonRequired: boolean;
  reasonHint?: string;
  tone?: 'primary' | 'danger';
}) {
  const [state, action] = useActionState<
    ActionResult<{ loan_no: string; status: string }> | null,
    FormData
  >(setLoanStatus, null);
  const err = state && !state.ok ? state : null;

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      {state?.ok ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">{state.message}</Alert>
          <Button size="lg" block onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="loan_id" value={loanId} />
          <input type="hidden" name="status" value={status} />

          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

          <Field
            label={reasonLabel}
            htmlFor={`reason-${status}`}
            required={reasonRequired}
            hint={reasonHint}
            error={err?.field === 'reason' ? err.error : null}
          >
            <Textarea
              id={`reason-${status}`}
              name="reason"
              maxLength={1000}
              required={reasonRequired}
              invalid={err?.field === 'reason'}
            />
          </Field>

          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton
              size="lg"
              className="flex-1"
              variant={tone === 'danger' ? 'danger' : 'primary'}
              pendingLabel="Saving…"
            >
              {submitLabel}
            </SubmitButton>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */

function DisburseDialog({
  open,
  onClose,
  loanId,
  loanNo,
  principal,
  processingFee,
  netDisbursed,
  memberName,
}: {
  open: boolean;
  onClose: () => void;
  loanId: string;
  loanNo: string;
  principal: number;
  processingFee: number;
  netDisbursed: number;
  memberName: string;
}) {
  const [state, action] = useActionState<
    ActionResult<{ loan_no: string; reference: string; transaction_id: string }> | null,
    FormData
  >(disburseLoan, null);
  const [idemKey] = useState(() => newIdempotencyKey('disburse'));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const err = state && !state.ok ? state : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Disburse funds"
      description={`Release ${formatUGX(principal)} to ${memberName}.`}
    >
      {state?.ok ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success" title="Loan disbursed">
            {state.message}
          </Alert>
          <Link
            href={`/staff/transactions/${state.data.transaction_id}`}
            className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center gap-2 rounded-lg font-semibold"
          >
            <Icon name="receipt_long" size={20} />
            View receipt
          </Link>
          <Button variant="outline" size="lg" block onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="loan_id" value={loanId} />
          <input type="hidden" name="idempotency_key" value={idemKey} />

          {err ? <Alert tone="error">{err.error}</Alert> : null}

          {/* What actually leaves the drawer, after the processing fee. */}
          <dl className="bg-surface-container-low divide-outline-variant/70 divide-y rounded-xl px-4 shadow-neu-sm">
            <Row label="Loan" value={loanNo} />
            <Row label="Principal" value={formatUGX(principal)} />
            {processingFee > 0 ? (
              <Row label="Less processing fee" value={`− ${formatUGX(processingFee)}`} />
            ) : null}
            <Row label="Cash to hand over" value={formatUGX(netDisbursed)} emphasis />
          </dl>

          <Field label="Disbursement method" htmlFor="disburse-method" required>
            <Select
              id="disburse-method"
              name="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {(['cash', 'mobile_money', 'bank_transfer', 'cheque'] as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Disbursement date" htmlFor="disbursed_on" required>
            <Input
              id="disbursed_on"
              name="disbursed_on"
              type="date"
              defaultValue={toISODate()}
              max={toISODate()}
              required
            />
          </Field>

          <Alert tone="warning">
            This releases money and starts the repayment schedule. It can only be undone by a
            reversal, which a manager must authorise.
          </Alert>

          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" pendingLabel="Disbursing…" icon="check">
              Confirm disbursement
            </SubmitButton>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-body-md font-body-md text-on-surface-variant">{label}</dt>
      <dd
        className={`text-body-md font-body-md text-on-surface tabular text-right ${
          emphasis ? 'font-bold' : 'font-semibold'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
