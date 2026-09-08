'use client';

import { useActionState, useState } from 'react';
import { setLoanProductActive } from '@/app/actions/loan-products';
import { Icon } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, SubmitButton } from '@/components/ui/form';
import type { ActionResult } from '@/lib/errors';

/**
 * Retire a loan product, or bring it back.
 *
 * Retiring is the closest thing to deleting that a product may have. Every loan
 * ever written under it references it, and those loans carry their own
 * snapshotted terms, so retiring is safe — it removes the product from the
 * application form and changes nothing that is already on the books.
 *
 * The dialog says so, and says how many loans are still running under it, so
 * the decision is made with the consequence visible rather than guessed at.
 */
export function LoanProductStatusControl({
  productId,
  name,
  isActive,
  liveLoans,
}: {
  productId: string;
  name: string;
  isActive: boolean;
  liveLoans: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    setLoanProductActive,
    null,
  );

  const err = state && !state.ok ? state : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-label-md font-semibold text-on-surface-variant shadow-neu-sm transition-shadow hover:text-primary hover:shadow-card active:shadow-neu-pressed"
      >
        <Icon name={isActive ? 'toggle_off' : 'toggle_on'} size={15} />
        {isActive ? 'Retire' : 'Restore'}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isActive ? `Retire ${name}?` : `Restore ${name}?`}
      >
        <form
          action={action}
          onSubmit={() => setTimeout(() => setOpen(false), 0)}
          className="space-y-4"
        >
          <input type="hidden" name="product_id" value={productId} />
          <input type="hidden" name="is_active" value={isActive ? 'false' : 'true'} />

          {err ? <Alert tone="error">{err.error}</Alert> : null}

          {isActive ? (
            <>
              <p className="text-body-lg text-on-surface">
                Members will no longer be able to choose {name} when they apply for a loan.
              </p>
              <Alert
                tone={liveLoans > 0 ? 'warning' : 'info'}
                title={
                  liveLoans > 0
                    ? `${liveLoans} loan${liveLoans === 1 ? '' : 's'} written under this product`
                    : 'Nothing already recorded will change'
                }
              >
                {liveLoans > 0
                  ? 'Those loans carry the terms they were agreed on and carry on exactly as before. Retiring only closes the product to new applications.'
                  : 'The product stays on file so that reports and any future loan history can still name it.'}
              </Alert>
            </>
          ) : (
            <p className="text-body-lg text-on-surface">
              {name} will appear again when a member applies for a loan, on the terms currently
              configured for it.
            </p>
          )}

          <Field
            label="Reason"
            htmlFor={`reason-${productId}`}
            hint="Optional, and recorded in the audit log beside this change."
          >
            <Input
              id={`reason-${productId}`}
              name="reason"
              placeholder={isActive ? 'Replaced by the new SME product' : 'Reopened for the new season'}
              maxLength={200}
            />
          </Field>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              variant={isActive ? 'danger' : 'primary'}
              pendingLabel={isActive ? 'Retiring…' : 'Restoring…'}
            >
              {isActive ? 'Retire product' : 'Restore product'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
