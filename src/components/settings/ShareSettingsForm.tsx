'use client';

import { useActionState, useRef, useState } from 'react';
import { updateShareSettings } from '@/app/actions/settings';
import { Icon } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, SubmitButton } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import type { ShareSettingsRow } from '@/types/db';

/**
 * The share price.
 *
 * This is the value the brief uses to make its point, and it is a good choice:
 * the price of a share reaches member registration, the buy-shares form, every
 * member's equity figure, the dashboard totals, statements and receipts. It has
 * never been a literal in this codebase — `buy_shares()` has read it from
 * `share_settings` since the first migration, and every share lot records the
 * price it was actually sold at — but until now there was no way to *change* it
 * without a developer, which amounts to the same thing.
 *
 * Changing it is confirmed, because it is the sentence the brief asks for:
 * a new price applies to future purchases, and the shares a member already
 * holds keep the price they were bought at. That second half is not a promise
 * this screen makes; it is a fact about `share_lots`, which stores `unit_price`
 * per lot precisely so that a price change cannot rewrite what a member paid.
 */
export function ShareSettingsForm({
  settings,
  canManage,
}: {
  settings: ShareSettingsRow;
  canManage: boolean;
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    updateShareSettings,
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const [price, setPrice] = useState<number>(Number(settings.unit_price));
  const [minShares, setMinShares] = useState<number>(Number(settings.min_shares_on_join));
  const [confirming, setConfirming] = useState(false);

  const priceChanged = price !== Number(settings.unit_price);
  const minChanged = minShares !== Number(settings.min_shares_on_join);
  const dirty = priceChanged || minChanged;

  const err = state && !state.ok ? state : null;
  const fieldError = (name: string) => (err?.field === name ? err.error : null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Only a price move warrants the interruption. Raising the minimum number
    // of shares on joining changes nothing about money already taken.
    if (priceChanged && !confirming) {
      event.preventDefault();
      setConfirming(true);
    }
  }

  return (
    <>
      <form ref={formRef} action={action} onSubmit={onSubmit} className="space-y-5">
        <div>
          <h3 className="text-title-md text-on-surface">Shares</h3>
          <p className="mt-1 text-label-md font-normal leading-relaxed text-on-surface-variant">
            Shares are bought in whole units at the price set here. It is used by the
            buy-shares form, member equity, statements and every report that values
            share capital.
          </p>
        </div>

        {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}
        {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

        <div className="grid grid-cols-1 gap-x-gutter gap-y-5 md:grid-cols-2">
          <Field
            label="Share unit price"
            htmlFor="unit_price"
            required
            hint="What one share costs from now on."
            error={fieldError('unit_price')}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-body-lg font-semibold text-on-surface-variant">
                UGX
              </span>
              <Input
                id="unit_price"
                name="unit_price"
                type="number"
                inputMode="decimal"
                min={1}
                step="any"
                className="tabular pl-16"
                value={String(price)}
                disabled={!canManage}
                invalid={!!fieldError('unit_price')}
                onChange={(e) => setPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                required
              />
            </div>
          </Field>

          <Field
            label="Minimum shares on joining"
            htmlFor="min_shares_on_join"
            required
            hint="How many shares a new member must buy. Zero means none is required."
            error={fieldError('min_shares_on_join')}
          >
            <Input
              id="min_shares_on_join"
              name="min_shares_on_join"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              className="tabular"
              value={String(minShares)}
              disabled={!canManage}
              invalid={!!fieldError('min_shares_on_join')}
              onChange={(e) => setMinShares(e.target.value === '' ? 0 : Number(e.target.value))}
              required
            />
          </Field>
        </div>

        <div className="flex items-start gap-3 rounded-2xl bg-surface-container p-3.5 shadow-neu-inset-sm">
          <Icon name="calculate" size={18} className="mt-0.5 shrink-0 text-primary" />
          <p className="text-body-md text-on-surface">
            A new member buying the minimum would pay{' '}
            <span className="tabular font-semibold">{formatUGX(price * minShares)}</span>
            {minShares > 0 ? (
              <span className="text-on-surface-variant">
                {' '}
                ({minShares} × {formatUGX(price)})
              </span>
            ) : null}
            .
          </p>
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant/70 pt-4">
            <SubmitButton disabled={!dirty} pendingLabel="Saving…">
              {dirty ? 'Save share settings' : 'No changes'}
            </SubmitButton>
            {dirty ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPrice(Number(settings.unit_price));
                  setMinShares(Number(settings.min_shares_on_join));
                }}
              >
                Discard
              </Button>
            ) : null}
          </div>
        ) : (
          <Alert tone="info">
            These values are shown for reference. Changing them needs the settings permission.
          </Alert>
        )}
      </form>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Change the share price?"
      >
        <div className="space-y-4">
          <p className="text-body-lg text-on-surface">
            You are changing the share price from{' '}
            <span className="tabular font-semibold">{formatUGX(settings.unit_price)}</span> to{' '}
            <span className="tabular font-semibold">{formatUGX(price)}</span>.
          </p>

          <Alert tone="info" title="What this affects">
            Every share bought from now on will be sold at the new price. Shares members
            already hold keep the price they were bought at, so no existing transaction,
            receipt or statement changes.
          </Alert>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Go back
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirming(false);
                formRef.current?.requestSubmit();
              }}
            >
              Yes, change the price
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
