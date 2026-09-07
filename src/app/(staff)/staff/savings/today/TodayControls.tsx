'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { openCyclesForDay } from '@/app/actions/groups';
import { Button, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import { toISODate } from '@/lib/format';

/**
 * Which day am I collecting for, and is the sheet ready?
 *
 * The date is held in the URL so a supervisor can send "check Wednesday" as a
 * link, and so refreshing after recording a payment lands on the same day.
 */
export function TodayControls({ date, canRecord }: { date: string; canRecord: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const today = toISODate();

  function go(next: string) {
    setResult(null);
    router.push(next === today ? '/staff/savings/today' : `/staff/savings/today?date=${next}`);
  }

  function shift(days: number) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    go(toISODate(d));
  }

  function openAll() {
    start(async () => {
      const r = await openCyclesForDay(date);
      setResult(r.ok ? { ok: true, message: r.message ?? '' } : { ok: false, message: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-label="Previous day"
          onClick={() => shift(-1)}
        >
          <Icon name="chevron_left" size={20} />
        </Button>

        <Input
          type="date"
          aria-label="Collection date"
          value={date}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="w-auto min-w-[10rem] flex-1 sm:flex-none"
        />

        <Button variant="outline" aria-label="Next day" onClick={() => shift(1)}>
          <Icon name="chevron_right" size={20} />
        </Button>

        {date !== today ? (
          <Button variant="ghost" icon="today" onClick={() => go(today)}>
            Today
          </Button>
        ) : null}

        {canRecord ? (
          <Button
            className="ml-auto"
            icon="event_available"
            loading={pending}
            onClick={openAll}
          >
            <span className="hidden sm:inline">Open all sheets</span>
            <span className="sm:hidden">Open all</span>
          </Button>
        ) : null}
      </div>

      {result ? <Alert tone={result.ok ? 'success' : 'error'}>{result.message}</Alert> : null}
    </div>
  );
}
