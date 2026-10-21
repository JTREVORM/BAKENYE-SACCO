'use client';

import { useState } from 'react';
import { reverseTransaction } from '@/app/actions/financial';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, SubmitButton, Textarea } from '@/components/ui/form';
import { ActionForm } from '@/components/forms/ActionForm';
import { useSubmission } from '@/components/forms/useSubmission';
import { UnresolvedNotice } from '@/components/forms/UnresolvedSubmission';
import { formatUGX } from '@/lib/money';
import { toISODate } from '@/lib/format';

/**
 * Reverse a posted transaction.
 *
 * The brief is explicit: a completed financial transaction is never silently
 * modified or deleted. Reversal writes a compensating entry, marks the original
 * as reversed, links the two, rolls back the derived aggregates and records the
 * reason in the audit log. Both rows stay visible forever.
 *
 * The reason field has a real minimum length because "correction" tells whoever
 * audits this in two years' time nothing at all.
 */
export function ReverseTransaction({
  transactionId,
  reference,
  amount,
  memberName,
  occurredOn,
}: {
  transactionId: string;
  reference: string;
  amount: number;
  memberName: string | null;
  /** The reversal cannot be dated before the transaction it reverses. */
  occurredOn?: string;
}) {
  const [open, setOpen] = useState(false);
  const submission = useSubmission<{ reversal_reference: string; original_reference: string }>(reverseTransaction);
  const state = submission.result;

  const err = state && !state.ok ? state : null;

  return (
    <>
      <div className="border-error/30 bg-error-container/30 rounded-xl border p-4">
        <h2 className="text-button-text font-button-text text-on-surface">Correction</h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-1">
          This transaction cannot be edited or deleted. If it was recorded in error, post a
          reversal — both entries stay on the record.
        </p>
        <Button variant="danger" className="mt-3" icon="undo" onClick={() => setOpen(true)}>
          Reverse this transaction
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reverse transaction"
        description={`${reference} · ${formatUGX(amount)}${memberName ? ` · ${memberName}` : ''}`}
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success" title="Transaction reversed">
              {state.message}
            </Alert>
            <Button size="lg" block onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <ActionForm submission={submission} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="transaction_id" value={transactionId} />

            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}
            {submission.unresolved ? <UnresolvedNotice noun="reversal" /> : null}

            <Alert tone="warning" title="This cannot be undone">
              A reversing entry of {formatUGX(amount)} will be posted. Balances, savings periods and
              loan status all move back accordingly. Both entries remain visible to the member.
            </Alert>

            <Field
              label="Reason for reversal"
              htmlFor="reversal-reason"
              required
              hint="Recorded permanently in the audit log. Be specific — say what went wrong."
              error={err?.field === 'reason' ? err.error : null}
            >
              <Textarea
                id="reversal-reason"
                name="reason"
                required
                minLength={10}
                maxLength={1000}
                invalid={err?.field === 'reason'}
                placeholder="e.g. Recorded against the wrong member; the payment belonged to BND26048."
              />
            </Field>

            <Field
              label="Reversal date"
              htmlFor="reversal-date"
              required
              hint="The day the correction is booked. Any account balances move back on this date."
              error={err?.field === 'reversal_date' ? err.error : null}
            >
              <Input
                id="reversal-date"
                name="reversal_date"
                type="date"
                defaultValue={toISODate()}
                min={occurredOn}
                max={toISODate()}
                required
              />
            </Field>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" variant="danger" className="flex-1" pendingLabel="Reversing…">
                Confirm reversal
              </SubmitButton>
            </div>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
