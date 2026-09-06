'use client';

import { useActionState, useState } from 'react';
import { setSavingsPlan } from '@/app/actions/members';
import { Alert } from '@/components/ui/states';
import { Button, Field, MoneyInput, Select, SubmitButton } from '@/components/ui/form';
import { Modal } from '@/components/ui/Modal';
import type { ActionResult } from '@/lib/errors';

/**
 * Set a member's weekly or monthly savings target.
 *
 * Saving a new target closes the previous plan rather than editing it, so a
 * period that was judged against last quarter's target keeps that target in its
 * history. Changing a target must never retroactively rewrite whether someone
 * met it.
 */
export function SavingsPlanControl({
  memberId,
  weeklyTarget,
  monthlyTarget,
}: {
  memberId: string;
  weeklyTarget: number | null;
  monthlyTarget: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'weekly' | 'monthly'>('weekly');
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(setSavingsPlan, null);

  const current = kind === 'weekly' ? weeklyTarget : monthlyTarget;
  const err = state && !state.ok ? state : null;

  return (
    <>
      <Button variant="ghost" size="sm" icon="tune" onClick={() => setOpen(true)}>
        Targets
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Savings targets"
        description="Set what this member is expected to save each week or month."
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">{state.message}</Alert>
            <Button size="lg" block onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="member_id" value={memberId} />

            {err ? <Alert tone="error">{err.error}</Alert> : null}

            <Field label="Savings type" htmlFor="kind" required>
              <Select
                id="kind"
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'weekly' | 'monthly')}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </Field>

            <Field
              label={`${kind === 'weekly' ? 'Weekly' : 'Monthly'} target`}
              htmlFor="target_amount"
              required
              hint={
                current
                  ? 'Saving a new target starts a new plan from today. Past periods keep the target they were set against.'
                  : 'Set to zero to record savings without a target.'
              }
            >
              <MoneyInput
                id="target_amount"
                name="target_amount"
                key={kind}
                defaultValue={current ?? ''}
              />
            </Field>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
                Save target
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
