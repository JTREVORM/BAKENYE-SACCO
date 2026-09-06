'use client';

import { useActionState, useEffect, useState } from 'react';
import { recordExpense, recordIncome } from '@/app/actions/financial';
import { createClient } from '@/lib/supabase/client';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import {
  Button,
  Field,
  Input,
  MoneyInput,
  Select,
  SubmitButton,
  Textarea,
} from '@/components/ui/form';
import { PAYMENT_METHOD_LABELS, toISODate } from '@/lib/format';
import { newIdempotencyKey, type ActionResult } from '@/lib/errors';
import type { CategoryRow, PaymentMethod } from '@/types/db';

const METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'cheque'];

/**
 * Record income.
 *
 * Loan interest and processing fees are booked automatically by the loan RPCs,
 * so this form is for the rest: membership fees, registration fees, penalties
 * and one-off income.
 */
export function RecordIncomeButton() {
  const [open, setOpen] = useState(false);
  const categories = useCategories('income_categories', open);
  const [state, action] = useActionState<ActionResult<{ reference: string }> | null, FormData>(
    recordIncome,
    null,
  );
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey('income'));

  useEffect(() => {
    if (state?.ok) setIdemKey(newIdempotencyKey('income'));
  }, [state]);

  const err = state && !state.ok ? state : null;

  return (
    <>
      <Button variant="outline" icon="trending_up" onClick={() => setOpen(true)}>
        <span className="hidden sm:inline">Record income</span>
        <span className="sm:hidden">Income</span>
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record income"
        description="Membership fees, penalties and other income received by the SACCO."
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success" title="Income recorded">
              Reference {state.data.reference}.
            </Alert>
            <Button size="lg" block onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="idempotency_key" value={idemKey} />

            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

            <Field
              label="Category"
              htmlFor="income-category"
              required
              error={err?.field === 'category_id' ? err.error : null}
            >
              <Select id="income-category" name="category_id" required defaultValue="">
                <option value="" disabled>
                  Choose a category…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Amount"
              htmlFor="income-amount"
              required
              error={err?.field === 'amount' ? err.error : null}
            >
              <MoneyInput id="income-amount" name="amount" required />
            </Field>

            <Field
              label="Description"
              htmlFor="income-description"
              required
              error={err?.field === 'description' ? err.error : null}
            >
              <Textarea
                id="income-description"
                name="description"
                required
                maxLength={500}
                placeholder="e.g. Annual membership fees collected at the AGM"
              />
            </Field>

            <Field label="Payment method" htmlFor="income-method" required>
              <Select id="income-method" name="method" defaultValue="cash">
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Date received" htmlFor="received_on" required>
              <Input
                id="received_on"
                name="received_on"
                type="date"
                defaultValue={toISODate()}
                max={toISODate()}
                required
              />
            </Field>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Recording…">
                Record income
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/**
 * Submit an expense for approval.
 *
 * Nothing is posted to the ledger here — the form is explicit about that,
 * because a cashier who believes the money has already moved will not chase the
 * approval.
 */
export function RecordExpenseButton() {
  const [open, setOpen] = useState(false);
  const categories = useCategories('expense_categories', open);
  const [state, action] = useActionState<ActionResult<{ expense_id: string }> | null, FormData>(
    recordExpense,
    null,
  );
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey('expense'));

  useEffect(() => {
    if (state?.ok) setIdemKey(newIdempotencyKey('expense'));
  }, [state]);

  const err = state && !state.ok ? state : null;

  return (
    <>
      <Button variant="outline" icon="trending_down" onClick={() => setOpen(true)}>
        <span className="hidden sm:inline">Record expense</span>
        <span className="sm:hidden">Expense</span>
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Submit an expense"
        description="Expenses need a manager's approval before any money leaves the SACCO."
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success" title="Submitted for approval">
              {state.message}
            </Alert>
            <Button size="lg" block onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="idempotency_key" value={idemKey} />

            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

            <Field
              label="Category"
              htmlFor="expense-category"
              required
              error={err?.field === 'category_id' ? err.error : null}
            >
              <Select id="expense-category" name="category_id" required defaultValue="">
                <option value="" disabled>
                  Choose a category…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Amount"
              htmlFor="expense-amount"
              required
              error={err?.field === 'amount' ? err.error : null}
            >
              <MoneyInput id="expense-amount" name="amount" required />
            </Field>

            <Field
              label="Description"
              htmlFor="expense-description"
              required
              hint="What was bought, and why."
              error={err?.field === 'description' ? err.error : null}
            >
              <Textarea
                id="expense-description"
                name="description"
                required
                maxLength={500}
                placeholder="e.g. Office rent for September 2026"
              />
            </Field>

            <Field label="Payment method" htmlFor="expense-method" required>
              <Select id="expense-method" name="method" defaultValue="cash">
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Date" htmlFor="spent_on" required>
              <Input
                id="spent_on"
                name="spent_on"
                type="date"
                defaultValue={toISODate()}
                max={toISODate()}
                required
              />
            </Field>

            <Field
              label="Receipt reference"
              htmlFor="attachment_path"
              hint="Optional. Note where the paper receipt is filed."
            >
              <Input
                id="attachment_path"
                name="attachment_path"
                maxLength={500}
                placeholder="e.g. Receipt book 12, page 43"
              />
            </Field>

            <Alert tone="info">
              This files a request. No money is recorded as leaving the SACCO until a manager
              approves it.
            </Alert>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Submitting…">
                Submit for approval
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/** Categories are fetched only when the dialog opens — not on page load. */
function useCategories(table: 'income_categories' | 'expense_categories', open: boolean) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  useEffect(() => {
    if (!open || categories.length > 0) return;
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from(table).select('id, name, is_system').order('name');
      if (!cancelled) setCategories((data as CategoryRow[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, table, categories.length]);

  return categories;
}
