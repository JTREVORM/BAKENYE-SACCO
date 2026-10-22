'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { submitWithFeedback, verifySubmission, type UncertainSubmission } from './submission-feedback';
import type { SubmissionStatus } from '@/types/db';
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

type Phase = 'edit' | 'confirm' | 'done' | 'uncertain';

export function FinancialForm<T extends { reference?: string | null; transaction_id?: string | null }>({
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
  referenceLabel = 'Transaction reference',
  draftLabel,
  receiptHref,
  doneHref,
  doneLabel = 'Done',
  canConfirm = true,
  submissionKind = 'posting',
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
  /** A fixed title, or one chosen from the result — "Submitted for approval" is not "Completed". */
  successTitle?: string | ((result: T) => string);
  /** What the number on the success screen is: a transaction, a transfer, a payment. */
  referenceLabel?: string;
  /**
   * Offer "save as draft" beside the submit button. The submitter's name and
   * value ride along in the form data as `intent=draft` / `intent=submit`.
   */
  draftLabel?: string;
  /** Built from the action's result — usually `/transactions/{id}`. */
  receiptHref?: (result: T) => string | null;
  doneHref?: string;
  doneLabel?: string;
  canConfirm?: boolean;
  /** A missing transaction cannot disprove a saved draft or approval request. */
  submissionKind?: 'posting' | 'request';
  /** Client-side gate before the confirmation step. Return an error message. */
  validate?: () => string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<T> | UncertainSubmission | null, FormData>(
    (prev, data) => submitWithFeedback(action, prev, data), null,
  );
  const router = useRouter();
  const [verification, setVerification] = useState<SubmissionStatus | null>(null);
  const [checking, startChecking] = useTransition();
  const checkingRef = useRef(false);
  const submittedKey = useRef('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [clientError, setClientError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // React resets even ok:false results during commit, when synthetic events
    // are disabled. A native listener keeps visible controls and React state
    // aligned, including the receiving account on a same-key retry.
    const preserveFields = (event: Event) => event.preventDefault();
    form.addEventListener('reset', preserveFields);
    return () => form.removeEventListener('reset', preserveFields);
  }, []);

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
      router.refresh();
    } else if (state && 'uncertain' in state) {
      setVerification(state.verification);
      setPhase('uncertain');
      if (state.verification?.found && !state.verification.reversed) {
        setIdemKey(newIdempotencyKey(idempotencyPrefix));
        router.refresh();
      }
    } else if (state && !state.ok) {
      // Send the user back to the fields so they can fix what was rejected.
      setPhase('edit');
    }
  }, [state, idempotencyPrefix, router]);

  const lines = useMemo(() => (phase === 'confirm' ? summary() : []), [phase, summary]);
  const confirmAmount = phase === 'confirm' ? amount() : null;

  /* ----------------------------------------------------------------- done */
  if (phase === 'done' && state?.ok) {
    const href = receiptHref?.(state.data) ?? null;
    return (
      <div role="status" className="animate-slide-up flex flex-col items-center py-8 text-center">
        <div className="bg-tertiary-container mb-5 flex h-20 w-20 items-center justify-center rounded-full">
          <Icon name="check_circle" size={44} className="text-white" />
        </div>

        <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
          {typeof successTitle === 'function' ? successTitle(state.data) : successTitle}
        </h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-sm">
          {state.message}
        </p>

        {state.data?.reference ? (
          <div className="bg-surface-container-low mt-6 w-full max-w-sm rounded-xl p-4 shadow-neu-sm">
            <p className="text-label-md font-label-md text-on-surface-variant">
              {referenceLabel}
            </p>
            <p className="text-button-text font-button-text text-on-surface tabular mt-1 select-all break-all font-mono">
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
              className="text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg font-semibold shadow-neu-sm"
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
      onSubmit={(event) => {
        if (pending || phase !== 'confirm') { event.preventDefault(); return; }
        submittedKey.current = idemKey;
        setClientError(null);
      }}
    >
      <input type="hidden" name="idempotency_key" value={idemKey} />

      {state && !state.ok && !('uncertain' in state) ? (
        <div className="mb-4">
          <Alert tone="error" title="Submission rejected">
            {state.error}
          </Alert>
        </div>
      ) : null}

      {clientError ? (
        <div className="mb-4">
          <Alert tone="error">{clientError}</Alert>
        </div>
      ) : null}

      {phase === 'uncertain' ? (
        <div className="space-y-4 py-4">
          <Alert tone={verification?.found && !verification.reversed ? 'success' : 'warning'}
            title={verification?.found ? (verification.reversed ? 'Transaction reversed' : 'Transaction recorded') : 'Submission verification'}>
            {verification?.found
              ? verification.reversed
                ? `Transaction ${verification.reference} was recorded and later reversed${verification.reversal_reference ? ` by ${verification.reversal_reference}` : ''}. Do not submit this payment again. Ask an authorized officer to review the reversal.`
                : `The transaction is recorded. Transaction reference: ${verification.reference}.`
              : verification && !verification.found
                ? submissionKind === 'request'
                  ? 'No posted transaction was found. This does not tell us whether your request or draft was saved. Check the request list or ask an authorized officer to verify it before creating another request.'
                  : 'No transaction was found for this submission key at the time of this check. Nothing has been automatically resubmitted. Check the transaction list before choosing to review and submit again with the same key.'
                : 'We could not verify whether this submission was recorded. Do not start another payment. Check your transaction list or ask an authorized officer to verify it using the submission key below.'}
          </Alert>
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-label-md">Submission key — keep this for verification</p>
            <p className="mt-1 select-all break-all font-mono text-body-md">{submittedKey.current}</p>
          </div>
          {verification?.found ? <Link className="min-h-touch-target-min flex items-center justify-center rounded-full bg-primary px-4 py-3 font-semibold text-on-primary"
            href={`/staff/transactions/${verification.transaction_id}`}>View transaction / receipt</Link> : null}
          <Link className="min-h-touch-target-min flex items-center justify-center rounded-full px-4 py-3 font-semibold text-primary ring-1 ring-outline-variant" href={submissionKind === 'request' ? (doneHref ?? '/staff/finance') : '/staff/transactions'}>{submissionKind === 'request' ? 'Check request list' : 'Check transaction list'}</Link>
          {!verification?.found ? <Button block variant="outline" loading={checking} onClick={() => {
            if (checkingRef.current) return;
            checkingRef.current = true;
            startChecking(async () => {
              try {
                const next = await verifySubmission(submittedKey.current);
                setVerification(next);
                if (next?.found && !next.reversed) {
                  setIdemKey(newIdempotencyKey(idempotencyPrefix));
                  router.refresh();
                }
              } finally { checkingRef.current = false; }
            });
          }}>Verify again</Button> : null}
          {verification && !verification.found && submissionKind === 'posting' ? <Button block disabled={checking} onClick={() => setPhase('edit')}>Review same submission</Button> : null}
          {doneHref ? <Link className="min-h-touch-target-min flex items-center justify-center px-4 py-3 font-semibold text-primary" href={doneHref}>{doneLabel}</Link> : null}
        </div>
      ) : null}

      <fieldset disabled={pending || checking || phase === 'uncertain'} className="min-w-0" aria-busy={pending || checking}>
      {/* The fields stay mounted through the confirmation step so their values
          are still in the form when it posts, and so going Back does not lose
          anything the user typed. */}
      <div className={clsx((phase === 'confirm' || phase === 'uncertain') && 'hidden')}>{children}</div>

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

          <dl className="bg-surface divide-outline-variant/70 mb-5 divide-y rounded-xl px-4 shadow-neu-sm">
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

      <StickyActions className={clsx('flex-col sm:flex-row', draftLabel && 'flex-wrap', phase === 'uncertain' && 'hidden')}>
        {phase === 'confirm' ? (
          <>
            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto sm:flex-1"
              onClick={() => setPhase('edit')}
              icon="arrow_back"
            >
              Back
            </Button>
            <SubmitButton
              size="lg"
              className="w-full sm:w-auto sm:flex-[2]"
              pendingLabel={pendingLabel}
              icon="check"
              name="intent"
              value="submit"
            >
              {submitLabel}
            </SubmitButton>
            {draftLabel ? (
              <SubmitButton
                variant="ghost"
                size="md"
                className="basis-full"
                pendingLabel="Saving…"
                icon="draft"
                name="intent"
                value="draft"
              >
                {draftLabel}
              </SubmitButton>
            ) : null}
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
      </fieldset>
    </form>
  );
}
