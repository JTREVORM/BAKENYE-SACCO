'use client';

import { useActionState, useState } from 'react';
import { approveExpense } from '@/app/actions/financial';
import { Alert } from '@/components/ui/states';
import { Button, Field, SubmitButton, Textarea } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';

/**
 * Approve or reject a pending expense.
 *
 * Approving is what actually posts the transaction and moves the money, so it
 * restates the amount first. Rejecting requires a reason, since the person who
 * submitted it needs to know what to fix.
 */
export function ExpenseApproval({
  expenseId,
  amount,
  description,
}: {
  expenseId: string;
  amount: number;
  description: string;
}) {
  const [state, action] = useActionState<ActionResult<{ approval: string }> | null, FormData>(
    approveExpense,
    null,
  );
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');

  if (state?.ok) {
    return (
      <Alert tone={state.data.approval === 'approved' ? 'success' : 'info'}>{state.message}</Alert>
    );
  }

  if (mode === 'idle') {
    return (
      <div className="flex flex-col gap-3">
        {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" icon="block" onClick={() => setMode('reject')}>
            Reject
          </Button>
          <Button className="flex-1" icon="check" onClick={() => setMode('approve')}>
            Approve
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="expense_id" value={expenseId} />
      <input type="hidden" name="approve" value={mode === 'approve' ? 'true' : 'false'} />

      {state && !state.ok && !state.field ? <Alert tone="error">{state.error}</Alert> : null}

      {mode === 'approve' ? (
        <Alert tone="warning" title={`Approving releases ${formatUGX(amount)}`}>
          {description ? <>For: {description}. </> : null}
          A transaction is posted to the ledger and the expense is booked against the cashbook.
        </Alert>
      ) : (
        <Field
          label="Reason for rejecting"
          htmlFor={`reject-${expenseId}`}
          required
          hint="The person who submitted this will see your reason."
          error={state && !state.ok && state.field === 'reason' ? state.error : null}
        >
          <Textarea
            id={`reject-${expenseId}`}
            name="reason"
            required
            maxLength={500}
            placeholder="e.g. No receipt attached; please resubmit with the invoice."
          />
        </Field>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={() => setMode('idle')}>
          Back
        </Button>
        <SubmitButton
          className="flex-1"
          variant={mode === 'approve' ? 'primary' : 'danger'}
          pendingLabel="Saving…"
        >
          {mode === 'approve' ? `Approve ${formatUGX(amount)}` : 'Reject expense'}
        </SubmitButton>
      </div>
    </form>
  );
}
