'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelPayment,
  cancelTransfer,
  decidePayment,
  decideTransfer,
  submitPayment,
  submitTransfer,
} from '@/app/actions/treasury';
import { approveExpense } from '@/app/actions/financial';
import { Button, Field, SubmitButton, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import type { FinanceDocStatus } from '@/types/treasury';

type AnyAction = (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;

const ACTIONS: Record<'transfer' | 'payment' | 'expense', { decide: AnyAction; cancel?: AnyAction; submit?: AnyAction }> = {
  transfer: {
    decide: decideTransfer as AnyAction,
    cancel: cancelTransfer as AnyAction,
    submit: submitTransfer as AnyAction,
  },
  payment: {
    decide: decidePayment as AnyAction,
    cancel: cancelPayment as AnyAction,
    submit: submitPayment as AnyAction,
  },
  expense: { decide: approveExpense as AnyAction },
};

const noop: AnyAction = async () => ({ ok: false, error: 'Not available.' });

/**
 * Approve, reject, cancel or submit one waiting entry.
 *
 * Approving is what moves the money, so it restates the amount first.
 * Rejecting and cancelling need a reason, which goes on the record and into
 * the audit log. The database decides whether this person may approve this
 * entry - under four eyes, nobody approves their own.
 */
export function ApprovalControls({
  kind,
  id,
  number,
  amount,
  status,
  canApprove,
  canCancel,
  canSubmit,
}: {
  kind: 'transfer' | 'payment' | 'expense';
  id: string;
  number: string;
  amount: number;
  status: FinanceDocStatus;
  canApprove: boolean;
  canCancel: boolean;
  canSubmit: boolean;
}) {
  const router = useRouter();
  const set = ACTIONS[kind];
  const [decideState, decide] = useActionState<ActionResult<unknown> | null, FormData>(set.decide, null);
  const [cancelState, cancel] = useActionState<ActionResult<unknown> | null, FormData>(set.cancel ?? noop, null);
  const [submitState, submit] = useActionState<ActionResult<unknown> | null, FormData>(set.submit ?? noop, null);
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject' | 'cancel'>('idle');

  const done = [decideState, cancelState, submitState].find((s) => s?.ok) ?? null;
  const failed = [decideState, cancelState, submitState].find((s) => s && !s.ok) as
    | { ok: false; error: string; field?: string }
    | undefined;

  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  if (done?.ok) {
    return <Alert tone="success">{done.message}</Alert>;
  }

  const waiting = status === 'submitted';
  const draft = status === 'draft';
  const showApprove = waiting && canApprove;
  const showCancel = (waiting || draft) && canCancel && !!set.cancel;
  const showSubmit = draft && canSubmit && !!set.submit;

  if (!showApprove && !showCancel && !showSubmit) return null;

  if (mode === 'idle') {
    return (
      <div className="flex flex-col gap-2">
        {failed ? <Alert tone="error">{failed.error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          {showApprove ? (
            <>
              <Button size="sm" icon="check" onClick={() => setMode('approve')}>
                Approve
              </Button>
              <Button size="sm" variant="outline" icon="block" onClick={() => setMode('reject')}>
                Reject
              </Button>
            </>
          ) : null}
          {showSubmit ? (
            <form action={submit}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton size="sm" icon="send" pendingLabel="Submitting…">
                Submit
              </SubmitButton>
            </form>
          ) : null}
          {showCancel ? (
            <Button size="sm" variant="ghost" icon="cancel" onClick={() => setMode('cancel')}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const isCancel = mode === 'cancel';
  return (
    <form action={isCancel ? cancel : decide} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expense_id" value={id} />
      {!isCancel ? <input type="hidden" name="approve" value={mode === 'approve' ? 'true' : 'false'} /> : null}

      {failed && !failed.field ? <Alert tone="error">{failed.error}</Alert> : null}

      {mode === 'approve' ? (
        <Alert tone="warning" title={`Approving ${number} moves ${formatUGX(amount)}`}>
          The ledger is posted and the account balances change as soon as you confirm.
        </Alert>
      ) : (
        <Field
          label={isCancel ? 'Reason for cancelling' : 'Reason for rejecting'}
          htmlFor={`reason-${id}`}
          required
          hint="Recorded on the entry and in the audit log."
          error={failed?.field === 'reason' ? failed.error : null}
        >
          <Textarea id={`reason-${id}`} name="reason" rows={2} maxLength={500} required />
        </Field>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setMode('idle')}>
          Back
        </Button>
        <SubmitButton size="sm" variant={mode === 'approve' ? 'primary' : 'danger'} pendingLabel="Saving…">
          {mode === 'approve' ? `Approve ${formatUGX(amount)}` : isCancel ? 'Cancel entry' : 'Reject'}
        </SubmitButton>
      </div>
    </form>
  );
}
