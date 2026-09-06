'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { openSavingsPeriods } from '@/app/actions/savings';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input } from '@/components/ui/form';
import { toISODate } from '@/lib/format';
import type { SavingsKind } from '@/types/db';

/**
 * Open the current savings period for every active member.
 *
 * Run at the start of a cycle so the collection sheet exists before the cashier
 * starts their round — and so a member who pays nothing ends up with a `missed`
 * period rather than no row at all, which is the difference between a
 * measurable shortfall and a silent gap.
 */
export function OpenPeriodsButton({ kind }: { kind: SavingsKind }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(toISODate());
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function run() {
    start(async () => {
      const r = await openSavingsPeriods(kind, on);
      setResult(r.ok ? { ok: true, message: r.message ?? '' } : { ok: false, message: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" icon="calendar_month" onClick={() => setOpen(true)}>
        <span className="hidden sm:inline">Open periods</span>
        <span className="sm:hidden">Periods</span>
      </Button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setResult(null);
        }}
        title={`Open ${kind} savings periods`}
        description="Creates the current period for every active member so contributions can be recorded against it."
      >
        <div className="flex flex-col gap-5">
          {result ? (
            <Alert tone={result.ok ? 'success' : 'error'}>{result.message}</Alert>
          ) : null}

          <Field
            label="Period containing this date"
            htmlFor="periods-on"
            hint={
              kind === 'weekly'
                ? 'The Monday-to-Sunday week this date falls in.'
                : 'The calendar month this date falls in.'
            }
          >
            <Input
              id="periods-on"
              type="date"
              value={on}
              max={toISODate()}
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
              Open periods
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
