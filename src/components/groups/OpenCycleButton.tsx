'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { openGroupCycle } from '@/app/actions/groups';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Button, Field, Input } from '@/components/ui/form';
import { toISODate } from '@/lib/format';
import { savingDayLabel, SAVING_FREQUENCY_LABELS } from '@/lib/groups';
import type { SavingDay, SavingFrequency } from '@/types/db';

/**
 * Open the collection sheet for a group.
 *
 * Worth doing before the meeting rather than after: a member who then pays
 * nothing ends up with a `missed` schedule that shows as a shortfall, instead
 * of no row at all, which would silently look like nothing was ever due.
 */
export function OpenCycleButton({
  groupId,
  savingDay,
  frequency,
  variant = 'primary',
  label = 'Open cycle',
}: {
  groupId: string;
  savingDay: SavingDay;
  frequency: SavingFrequency;
  variant?: 'primary' | 'outline';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(toISODate());
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function run() {
    start(async () => {
      const r = await openGroupCycle(groupId, on);
      setResult(r.ok ? { ok: true, message: r.message ?? '' } : { ok: false, message: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <>
      <Button variant={variant} icon="event_available" onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setResult(null);
        }}
        title="Open the savings cycle"
        description="Puts every active member of this group on the collection sheet with their expected amount."
      >
        <div className="flex flex-col gap-5">
          {result ? (
            <Alert tone={result.ok ? 'success' : 'error'}>{result.message}</Alert>
          ) : null}

          <Alert tone="info">
            This group saves on <strong>{savingDayLabel(savingDay)}</strong> ·{' '}
            {SAVING_FREQUENCY_LABELS[frequency].toLowerCase()}. The due date is worked out from
            that, not from the date below — the date only picks which cycle to open.
          </Alert>

          <Field
            label="Cycle containing this date"
            htmlFor="cycle-on"
            hint={
              frequency === 'monthly'
                ? 'The calendar month this date falls in.'
                : 'The Monday-to-Sunday week this date falls in.'
            }
          >
            <Input
              id="cycle-on"
              type="date"
              value={on}
              onChange={(e) => setOn(e.target.value)}
            />
          </Field>

          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => {
                setOpen(false);
                setResult(null);
              }}
            >
              Close
            </Button>
            <Button size="lg" className="flex-1" loading={pending} onClick={run}>
              Open cycle
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
