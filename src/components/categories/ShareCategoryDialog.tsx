'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveShareCategory } from '@/app/actions/categories';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import { Button, Field, Input, MoneyInput, SubmitButton, Textarea } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import type { ShareCategoryRow } from '@/types/db';

/**
 * Create or edit a share category.
 *
 * The total is not a field. Fifty shares at UGX 20,000 is UGX 1,000,000 because
 * the database multiplies them, and the live figure below the inputs is there
 * so the person typing sees what they are about to commit the SACCO to — not so
 * they can type it themselves and have it disagree.
 *
 * A blank qualification window means the category has no deadline, which is
 * what Silver is. That is an answer, not a missing value, so the field says so
 * rather than being marked required.
 */
export function ShareCategoryDialog({
  category,
  trigger = 'button',
}: {
  category?: ShareCategoryRow;
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
  const [price, setPrice] = useState<number | null>(Number(category?.share_price ?? 20000));

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const err = state && !state.ok ? state : null;
  const total = (Number(shares) || 0) * (price ?? 0);

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
        description="How many shares a member in this category must buy, at what price, and by when."
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

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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

            <Field
              label="Price of one share"
              htmlFor="share-cat-price"
              required
              error={err?.field === 'share_price' ? err.error : null}
            >
              <MoneyInput
                id="share-cat-price"
                name="share_price"
                value={price ?? ''}
                onValueChange={setPrice}
                required
              />
            </Field>
          </div>

          {/* Derived, and labelled as derived. */}
          <div className="bg-surface-container-low flex items-baseline justify-between gap-3 rounded-xl p-4 shadow-neu-sm">
            <span className="text-label-md font-label-md text-on-surface-variant normal-case">
              Total a member must buy
            </span>
            <span className="text-button-text font-button-text text-on-surface tabular font-bold">
              {formatUGX(total)}
            </span>
          </div>

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

          {editing ? (
            <Alert tone="info">
              Changing these figures changes what is expected of members in this category from now
              on. Shares already bought keep the price they were actually sold at.
            </Alert>
          ) : null}

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
