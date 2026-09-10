'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveFinanceCategory } from '@/app/actions/treasury';
import { Modal } from '@/components/ui/Modal';
import { Badge, Icon } from '@/components/ui/primitives';
import { Button, Field, Input, SubmitButton } from '@/components/ui/form';
import { Alert, EmptyState } from '@/components/ui/states';
import { clsx } from '@/lib/clsx';
import type { ActionResult } from '@/lib/errors';

type Kind = 'income' | 'expense' | 'payment';
type Category = { id: string; name: string; description?: string | null; is_active?: boolean; is_system: boolean };

const KINDS: { kind: Kind; label: string; help: string }[] = [
  { kind: 'expense', label: 'Expenses', help: 'Operating costs: rent, utilities, transport, salaries, stationery.' },
  { kind: 'income', label: 'Receipts & income', help: 'What money received is booked as. Loan interest and service charges are booked automatically.' },
  { kind: 'payment', label: 'Payments', help: 'Money paid out that is not an operating expense: refunds, dividends, assets.' },
];

/**
 * The finance categories, as data a manager edits. None is hard-coded into a
 * screen; the forms read whatever is active here. A category in use is
 * retired, never deleted, so history keeps its label.
 */
export function CategoryManager({
  categories,
  canManage,
}: {
  categories: Record<Kind, Category[]>;
  canManage: boolean;
}) {
  const [kind, setKind] = useState<Kind>('expense');
  const list = categories[kind];
  const meta = KINDS.find((k) => k.kind === kind)!;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Category kind" className="inline-flex flex-wrap gap-1 self-start rounded-full bg-surface-container p-1.5 shadow-neu-inset">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            onClick={() => setKind(k.kind)}
            className={clsx(
              'h-touch-target-min rounded-full px-4 text-button-text transition-[box-shadow,background-color]',
              kind === k.kind ? 'bg-ink text-white shadow-neu-dark-sm' : 'text-on-surface-variant hover:bg-surface',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-md text-on-surface-variant">{meta.help}</p>
        {canManage ? <CategoryDialog kind={kind} label="Add category" /> : null}
      </div>

      {list.length === 0 ? (
        <EmptyState compact icon="category" title="No categories yet" description="Add the first one to use it on the forms." />
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {list.map((c) => (
            <li key={c.id} className="flex items-start gap-3 rounded-2xl bg-surface-container p-3.5 shadow-neu-inset-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-md font-semibold text-on-surface">{c.name}</span>
                  {c.is_system ? <Badge tone="info">Automatic</Badge> : null}
                  {c.is_active === false ? <Badge tone="neutral">Retired</Badge> : null}
                </div>
                {c.description ? <p className="mt-0.5 text-label-md font-normal text-on-surface-variant">{c.description}</p> : null}
              </div>
              {canManage ? <CategoryDialog kind={kind} category={c} label="Edit" /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryDialog({ kind, category, label }: { kind: Kind; category?: Category; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<{ id: string; name: string }> | null, FormData>(
    saveFinanceCategory,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      setOpen(false);
    }
  }, [state, router]);

  const err = state && !state.ok ? state : null;

  return (
    <>
      {category ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Edit ${category.name}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface hover:shadow-neu-sm"
        >
          <Icon name="edit" size={18} />
        </button>
      ) : (
        <Button size="sm" icon="add" onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={category ? `Edit ${category.name}` : 'Add a category'}>
        <form action={action} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="kind" value={kind} />
          {category ? <input type="hidden" name="id" value={category.id} /> : null}
          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}
          {category?.is_system ? (
            <Alert tone="info">Booked automatically by the loan functions, so its name cannot change and it cannot be retired.</Alert>
          ) : null}
          <Field label="Name" htmlFor="cat-name" required error={err?.field === 'name' ? err.error : null}>
            <Input id="cat-name" name="name" defaultValue={category?.name} maxLength={80} readOnly={category?.is_system} required />
          </Field>
          <Field label="Description" htmlFor="cat-description">
            <Input id="cat-description" name="description" defaultValue={category?.description ?? ''} maxLength={300} />
          </Field>
          {category && !category.is_system ? (
            <label className="flex items-center gap-3">
              <input type="hidden" name="is_active" value="false" />
              <input type="checkbox" name="is_active" value="true" defaultChecked={category.is_active !== false}
                className="h-5 w-5 rounded border-outline text-primary focus:ring-primary" />
              <span className="text-body-md text-on-surface">Offered on forms (untick to retire)</span>
            </label>
          ) : null}
          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
