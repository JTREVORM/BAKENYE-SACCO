'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon, Money } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { Button, SubmitButton, StickyActions } from '@/components/ui/form';
import { newIdempotencyKey, type ActionResult } from '@/lib/errors';
import { clsx } from '@/lib/clsx';

/**
 * The safety envelope every money movement in this application goes through,
 * implementing rule 30 of the brief end to end:
 *
 *   1. the user fills in the form
 *   2. the browser validates what it can
 *   3. a confirmation step restates the amount and the counterparty
 *   4. the action runs
 *   5. the submit control is disabled while it is in flight, and a stable
 *      idempotency key rides along so a retry cannot post twice
 *   6. the outcome is stated plainly, success or failure
 *   7. the transaction reference is shown
 *   8. the receipt is one tap away
 *
 * Nobody is ever left wondering whether their money moved.
 */

export type FinancialSummaryLine = { label: string; value: React.ReactNode; emphasis?: boolean };

type Phase = 'edit' | 'confirm' | 'done';

export function FinancialForm<T extends { reference?: string; transaction_id?: string }>({
  action,
  children,
  summary,
  amount,
  confirmTitle,
  confirmPrompt,
  submitLabel,
  pendingLabel = 'Processing…',
  idempotencyPrefix,
  successTitle = 'Transaction successful',
  receiptHref,
  doneHref,
  doneLabel = 'Done',
  canConfirm = true,
  validate,
}: {
  action: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  /** The form fields. */
  children: React.ReactNode;
  /** Built from live form values; shown on the confirmation step. */
  summary: () => FinancialSummaryLine[];
  /** The headline figure repeated back on the confirmation step. */
  amount: () => number | null;
  confirmTitle?: string;
  confirmPrompt?: string;
  submitLabel: string;
  pendingLabel?: string;
  idempotencyPrefix: string;
  successTitle?: string;
  /** Built from the action's result — usually `/transactions/{id}`. */
  receiptHref?: (result: T) => string | null;
  doneHref?: string;
  doneLabel?: string;
  canConfirm?: boolean;
  /** Client-side gate before the confirmation step. Return an error message. */
  validate?: () => string | null;
}) {
  const [state, formAction] = useActionState<ActionResult<T> | null, FormData>(action, null);
  const [phase, setPhase] = useState<Phase>('edit');
  const [clientError, setClientError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * One key per form instance. It is regenerated only after a successful post,
   * so every retry of the *same* submission — a double tap, a dropped response,
   * a browser resend — carries the key the server has already seen.
   */
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey(idempotencyPrefix));

  useEffect(() => {
    if (state?.ok) {
      setPhase('done');
      setIdemKey(newIdempotencyKey(idempotencyPrefix));
    } else if (state && !state.ok) {
      // Send the user back to the fields so they can fix what was rejected.
      setPhase('edit');
    }
  }, [state, idempotencyPrefix]);

  const lines = useMemo(() => (phase === 'confirm' ? summary() : []), [phase, summary]);
  const confirmAmount = phase === 'confirm' ? amount() : null;

  /* ----------------------------------------------------------------- done */
  if (phase === 'done' && state?.ok) {
    const href = receiptHref?.(state.data) ?? null;
    return (
      <div className="animate-slide-up flex flex-col items-center py-8 text-center">
        <div className="bg-tertiary-container mb-5 flex h-20 w-20 items-center justify-center rounded-full">
          <Icon name="check_circle" size={44} className="text-white" />
        </div>

        <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
          {successTitle}
        </h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-sm">
          {state.message}
        </p>

        {state.data?.reference ? (
          <div className="bg-surface-container-low border-outline-variant mt-6 w-full max-w-sm rounded-xl border p-4">
            <p className="text-label-md font-label-md text-on-surface-variant">
              Transaction reference
            </p>
            <p className="text-button-text font-button-text text-on-surface tabular mt-1 select-all font-mono">
              {state.data.reference}
            </p>
          </div>
        ) : null}

        <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
          {href ? (
            <Link
              href={href}
              className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center gap-2 rounded-lg font-semibold"
            >
              <Icon name="receipt_long" size={20} />
              View receipt
            </Link>
          ) : null}

          {doneHref ? (
            <Link
              href={doneHref}
              className="border-outline-variant text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg border font-semibold"
            >
              {doneLabel}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- confirm */
  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      onSubmit={() => {
        // The confirmation step has already been passed at this point.
        setClientError(null);
      }}
    >
      <input type="hidden" name="idempotency_key" value={idemKey} />

      {state && !state.ok ? (
        <div className="mb-4">
          <Alert tone="error" title="Transaction not completed">
            {state.error}
          </Alert>
        </div>
      ) : null}

      {clientError ? (
        <div className="mb-4">
          <Alert tone="error">{clientError}</Alert>
        </div>
      ) : null}

      {/* The fields stay mounted through the confirmation step so their values
          are still in the form when it posts, and so going Back does not lose
          anything the user typed. */}
      <div className={clsx(phase === 'confirm' && 'hidden')}>{children}</div>

      {phase === 'confirm' ? (
        <div className="animate-slide-up">
          <div className="bg-primary text-on-primary relative mb-5 overflow-hidden rounded-xl p-5 text-center">
            <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-xl" />
            <p className="text-label-md font-label-md text-primary-fixed-dim relative z-10">
              {confirmTitle ?? 'Please confirm'}
            </p>
            <Money
              value={confirmAmount}
              className="text-display-currency font-display-currency relative z-10 mt-1 block"
            />
          </div>

          <dl className="bg-surface border-outline-variant divide-outline-variant/70 mb-5 divide-y rounded-xl border px-4">
            {lines.map((l) => (
              <div key={l.label} className="flex items-start justify-between gap-4 py-3">
                <dt className="text-body-md font-body-md text-on-surface-variant shrink-0">
                  {l.label}
                </dt>
                <dd
                  className={clsx(
                    'text-body-md font-body-md min-w-0 text-right',
                    l.emphasis ? 'text-on-surface font-bold' : 'text-on-surface font-semibold',
                  )}
                >
                  {l.value}
                </dd>
              </div>
            ))}
          </dl>

          <Alert tone="warning">
            {confirmPrompt ??
              'Check these details carefully. Once recorded, a transaction can only be corrected by a reversal.'}
          </Alert>
        </div>
      ) : null}

      <StickyActions>
        {phase === 'confirm' ? (
          <>
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => setPhase('edit')}
              icon="arrow_back"
            >
              Back
            </Button>
            <SubmitButton size="lg" className="flex-[2]" pendingLabel={pendingLabel} icon="check">
              {submitLabel}
            </SubmitButton>
          </>
        ) : (
          <Button
            size="lg"
            block
            iconEnd="arrow_forward"
            disabled={!canConfirm}
            onClick={() => {
              const message = validate?.() ?? null;
              setClientError(message);
              if (!message) setPhase('confirm');
            }}
          >
            Review
          </Button>
        )}
      </StickyActions>
    </form>
  );
}
