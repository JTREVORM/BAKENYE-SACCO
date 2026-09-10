'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveShareCategory } from '@/app/actions/categories';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import { Button, Field, Input, SubmitButton, Textarea } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import type { ShareCategoryRow } from '@/types/db';

/**
 * Create or edit a share category.
 *
 * A category says how many shares, and by when. It does not say what a share
 * costs: there is one share price for the whole SACCO, held in Settings and
 * charged by every purchase, and this dialog shows it rather than asking for
 * it. A price field here would be a second copy of that number - which is how
 * the Shares module once ended up selling at UGX 50,000 while the categories
 * said UGX 20,000.
 *
 * The total is not a field either. It is shown live so the person typing sees
 * what they are committing members to, and it is computed, not stored.
 */
export function ShareCategoryDialog({
  category,
  unitPrice,
  trigger = 'button',
}: {
  category?: ShareCategoryRow;
  /** The SACCO's one share price. Null when it cannot be read. */
  unitPrice: number | null;
  trigger?: 'button' | 'link';
}) {
  const router = useRouter();
  const editing = !!category;
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<{ id: string; name: string }> | null, FormData>(
    saveShareCategory,
    null,
  );

  const [shares, setShares] = useState(category?.required_shares ?? 1);

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const err = state && !state.ok ? state : null;
  const count = Number(shares) || 0;

  return (
    <>
      {trigger === 'link' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-surface text-label-md text-on-surface-variant hover:text-primary hover:shadow-card active:shadow-neu-pressed inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 font-semibold shadow-neu-sm transition-shadow"
        >
          <Icon name="edit" size={15} />
          Edit
        </button>
      ) : (
        <Button icon="add" onClick={() => setOpen(true)}>
          Add share category
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${category.name}` : 'New share category'}
        description="How many shares a member in this category must buy, and by when."
      >
        <form action={action} className="flex flex-col gap-5" noValidate>
          {editing ? <input type="hidden" name="id" value={category.id} /> : null}

          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

          <Field
            label="Name"
            htmlFor="share-cat-name"
            required
            error={err?.field === 'name' ? err.error : null}
          >
            <Input
              id="share-cat-name"
              name="name"
              required
              maxLength={60}
              defaultValue={category?.name}
              placeholder="e.g. Platinum"
              invalid={err?.field === 'name'}
            />
          </Field>

          <Field
            label="Required shares"
            htmlFor="share-cat-shares"
            required
            error={err?.field === 'required_shares' ? err.error : null}
          >
            <Input
              id="share-cat-shares"
              name="required_shares"
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              required
              value={shares}
              onChange={(e) => setShares(Number(e.target.value))}
              invalid={err?.field === 'required_shares'}
            />
          </Field>

          {/* The price is shown, not asked for. */}
          {unitPrice !== null ? (
            <dl className="bg-surface-container-low divide-outline-variant/70 divide-y rounded-xl px-4 shadow-neu-sm">
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="text-label-md font-label-md text-on-surface-variant normal-case">
                  Price per share
                </dt>
                <dd className="text-body-md font-body-md text-on-surface tabular font-semibold">
                  {formatUGX(unitPrice)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="text-label-md font-label-md text-on-surface-variant normal-case">
                  Total a member must buy
                </dt>
                <dd className="text-button-text font-button-text text-on-surface tabular font-bold">
                  {formatUGX(count * unitPrice)}
                </dd>
              </div>
            </dl>
          ) : (
            <Alert tone="warning" title="The share price is not set">
              The category can be saved, but its total cannot be shown until a share price is set
              under Settings.
            </Alert>
          )}

          <p className="text-label-md font-label-md text-on-surface-variant -mt-2 normal-case">
            Every category uses the SACCO&apos;s single share price, set under Settings. Changing
            it there changes every category total at once.
          </p>

          <Field
            label="Qualification window"
            htmlFor="share-cat-months"
            error={err?.field === 'qualification_months' ? err.error : null}
            hint="Months from each member's own joining date. Leave blank for a category with no deadline."
          >
            <Input
              id="share-cat-months"
              name="qualification_months"
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              defaultValue={category?.qualification_months ?? ''}
              placeholder="e.g. 3"
              invalid={err?.field === 'qualification_months'}
            />
          </Field>

          <Field label="Description" htmlFor="share-cat-desc">
            <Textarea
              id="share-cat-desc"
              name="description"
              maxLength={300}
              rows={2}
              defaultValue={category?.description ?? ''}
            />
          </Field>

          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
              {editing ? 'Save changes' : 'Add category'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
