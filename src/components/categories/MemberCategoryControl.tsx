'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setMemberCategories } from '@/app/actions/categories';
import { Alert } from '@/components/ui/states';
import { Button, Field, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/Modal';
import { SAVINGS_FREQUENCY_ADVERB, qualificationWindow } from '@/lib/categories';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import type { SavingsCategoryRow, ShareCategoryRow } from '@/types/db';

/**
 * Set or change a member's share and savings categories.
 *
 * Two independent choices, presented as two independent fields, because that is
 * what they are: a member may hold Gold shares and save at the Diamond rate. If
 * the SACCO has switched on the rule that the two must match, the database
 * refuses the mismatch and its message appears here — the screen does not
 * second-guess a rule it is not the authority on.
 *
 * Changing the savings category re-prices only schedules that are still
 * pending, unpaid and not yet due. The confirmation says how many, because
 * "categories updated" would leave the person wondering whether the figures
 * they can see behind this dialog have just moved.
 */
export function MemberCategoryControl({
  memberId,
  memberName,
  currentShareCategoryId,
  currentSavingsCategoryId,
  shareCategories,
  savingsCategories,
}: {
  memberId: string;
  memberName: string;
  currentShareCategoryId: string | null;
  currentSavingsCategoryId: string | null;
  shareCategories: ShareCategoryRow[];
  savingsCategories: SavingsCategoryRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<
    ActionResult<{ schedules_repriced: number }> | null,
    FormData
  >(setMemberCategories, null);

  const err = state && !state.ok ? state : null;
  const hasAny = !!currentShareCategoryId || !!currentSavingsCategoryId;

  function close() {
    setOpen(false);
    if (state?.ok) router.refresh();
  }

  return (
    <>
      <Button variant="outline" icon="workspace_premium" onClick={() => setOpen(true)}>
        {hasAny ? 'Change categories' : 'Set categories'}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={hasAny ? 'Change categories' : 'Set categories'}
        description={`${memberName} buys shares under one category and saves under another. The two are set separately.`}
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">{state.message}</Alert>
            <Button size="lg" block onClick={close}>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="member_id" value={memberId} />

            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

            <Field
              label="Share category"
              htmlFor="member-share-category"
              error={err?.field === 'share_category_id' ? err.error : null}
              hint="The number of shares this member is working towards, and the deadline it carries."
            >
              <Select
                id="member-share-category"
                name="share_category_id"
                defaultValue={currentShareCategoryId ?? ''}
              >
                <option value="">No share category</option>
                {shareCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.required_shares}{' '}
                    {c.required_shares === 1 ? 'share' : 'shares'} ·{' '}
                    {c.required_amount !== null
                      ? formatUGX(c.required_amount)
                      : 'price not set'}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Savings category"
              htmlFor="member-savings-category"
              error={err?.field === 'savings_category_id' ? err.error : null}
              hint="What this member is expected to save, and how often. Without one, no schedule is raised and nothing is expected of them."
            >
              <Select
                id="member-savings-category"
                name="savings_category_id"
                defaultValue={currentSavingsCategoryId ?? ''}
              >
                <option value="">No savings category</option>
                {savingsCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {formatUGX(c.amount)}{' '}
                    {SAVINGS_FREQUENCY_ADVERB[c.frequency]}
                  </option>
                ))}
              </Select>
            </Field>

            {shareCategories.length > 0 ? (
              <dl className="bg-surface-container-low text-label-md font-label-md flex flex-col gap-1.5 rounded-xl p-3 normal-case">
                {shareCategories.map((c) => (
                  <div key={c.id} className="flex flex-wrap justify-between gap-2">
                    <dt className="text-on-surface font-semibold">{c.name}</dt>
                    <dd className="text-on-surface-variant">
                      {qualificationWindow(c.qualification_months)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <Field
              label="Reason"
              htmlFor="member-category-reason"
              hint="Optional, but kept in the audit log."
            >
              <Textarea
                id="member-category-reason"
                name="reason"
                maxLength={500}
                rows={2}
                placeholder="e.g. Moved up to Diamond Saver after the September meeting."
              />
            </Field>

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
