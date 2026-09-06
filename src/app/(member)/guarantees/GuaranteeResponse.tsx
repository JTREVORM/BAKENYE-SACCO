'use client';

import { useActionState, useState } from 'react';
import { respondToGuarantee } from '@/app/actions/financial';
import { Alert } from '@/components/ui/states';
import { Button, SubmitButton, Textarea, Field } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';

/**
 * Accept or decline a guarantee request.
 *
 * Accepting is a financial commitment, so it takes a deliberate confirmation
 * step that restates the amount — the same pattern every money movement in this
 * app uses.
 */
export function GuaranteeResponse({
  guarantorId,
  borrowerName,
  amount,
}: {
  guarantorId: string;
  borrowerName: string;
  amount: number;
}) {
  const [state, action] = useActionState<ActionResult<{ status: string }> | null, FormData>(
    respondToGuarantee,
    null,
  );
  const [mode, setMode] = useState<'idle' | 'accept' | 'decline'>('idle');

  if (state?.ok) {
    return (
      <Alert tone={state.data.status === 'accepted' ? 'success' : 'info'}>{state.message}</Alert>
    );
  }

  if (mode === 'idle') {
    return (
      <div className="flex flex-col gap-3">
        {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
        <p className="text-body-md font-body-md text-on-surface-variant">
          {borrowerName} has asked you to guarantee {formatUGX(amount)} of their loan.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setMode('decline')}>
            Decline
          </Button>
          <Button className="flex-1" onClick={() => setMode('accept')}>
            Accept
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="guarantor_id" value={guarantorId} />
      <input type="hidden" name="status" value={mode === 'accept' ? 'accepted' : 'declined'} />

      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}

      {mode === 'accept' ? (
        <Alert tone="warning" title={`You are agreeing to back ${formatUGX(amount)}`}>
          If {borrowerName} stops repaying, the SACCO may recover this amount from your savings.
        </Alert>
      ) : (
        <Field label="Reason (optional)" htmlFor={`note-${guarantorId}`}>
          <Textarea
            id={`note-${guarantorId}`}
            name="note"
            maxLength={500}
            placeholder="Let the loan officer know why, if you wish."
          />
        </Field>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={() => setMode('idle')}>
          Back
        </Button>
        <SubmitButton
          className="flex-1"
          variant={mode === 'accept' ? 'primary' : 'danger'}
          pendingLabel="Sending…"
        >
          {mode === 'accept' ? 'Yes, I accept' : 'Decline request'}
        </SubmitButton>
      </div>
    </form>
  );
}
