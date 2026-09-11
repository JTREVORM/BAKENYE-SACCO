'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui/form';
import { ScrollRow } from '@/components/ui/scroll';
import { monthStartISO, todayISO, weekStartISO, yearStartISO } from '@/lib/format';
import { clsx } from '@/lib/clsx';

/**
 * Today · This week · This month · This year · Custom.
 *
 * The period lives in the URL, so a report for "this week" can be bookmarked
 * and it will still mean this week next Tuesday.
 */
export function PeriodPicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  const today = todayISO();
  const presets = [
    { label: 'Today', from: today, to: today },
    { label: 'This week', from: weekStartISO(today), to: today },
    { label: 'This month', from: monthStartISO(today), to: today },
    { label: 'This year', from: yearStartISO(today), to: today },
  ];
  const matched = presets.find((p) => p.from === from && p.to === to);
  const [custom, setCustom] = useState(!matched);

  function apply(f: string, t: string) {
    const q = new URLSearchParams(params.toString());
    q.set('from', f);
    q.set('to', t);
    q.delete('page');
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="no-print flex flex-col gap-3 rounded-2xl bg-surface p-3 shadow-neu-sm">
      <ScrollRow label="Choose a period" className="no-scrollbar flex gap-2">
        {presets.map((p) => {
          const active = !custom && p.from === from && p.to === to;
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCustom(false);
                apply(p.from, p.to);
              }}
              className={clsx(
                'h-touch-target-min shrink-0 rounded-full px-4 text-label-md font-semibold transition-colors',
                active ? 'bg-ink text-white' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => setCustom(true)}
          className={clsx(
            'h-touch-target-min shrink-0 rounded-full px-4 text-label-md font-semibold transition-colors',
            custom ? 'bg-ink text-white' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
          )}
        >
          Custom
        </button>
      </ScrollRow>

      {custom ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="From" htmlFor="period-from" className="flex-1">
            <Input id="period-from" type="date" value={localFrom} max={localTo || today}
              onChange={(e) => setLocalFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="period-to" className="flex-1">
            <Input id="period-to" type="date" value={localTo} min={localFrom} max={today}
              onChange={(e) => setLocalTo(e.target.value)} />
          </Field>
          <Button icon="refresh" onClick={() => localFrom && localTo && apply(localFrom, localTo)}>
            Apply
          </Button>
        </div>
      ) : null}
    </div>
  );
}
