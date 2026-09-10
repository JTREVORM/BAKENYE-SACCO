'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Field, Input, Button } from '@/components/ui/form';
import { monthStart, monthEnd, toISODate } from '@/lib/format';
import { ScrollRow } from '@/components/ui/scroll';

/**
 * Date-range picker for statements and reports.
 *
 * The preset chips exist because typing two dates on a phone keypad to get
 * "this month" is a lot of taps for the answer people want most often.
 */
export function StatementRange({
  from,
  to,
  presets = true,
}: {
  from: string;
  to: string;
  presets?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  function apply(nextFrom: string, nextTo: string) {
    // Keep whatever else is filtering the page — the savings register carries
    // `kind` and `category` in the URL, and changing the dates should not silently
    // drop them back to the defaults.
    const next = new URLSearchParams(params.toString());
    next.set('from', nextFrom);
    next.set('to', nextTo);
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const today = new Date();
  const presetRanges = [
    { label: 'This month', from: monthStart(today), to: toISODate(today) },
    {
      label: 'Last month',
      from: monthStart(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: monthEnd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    },
    {
      label: 'Last 3 months',
      from: monthStart(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
      to: toISODate(today),
    },
    {
      label: 'This year',
      from: `${today.getFullYear()}-01-01`,
      to: toISODate(today),
    },
  ];

  return (
    <div className="no-print bg-surface flex flex-col gap-4 rounded-xl p-4 shadow-neu-sm">
      {presets ? (
        <ScrollRow label="Choose a period" className="no-scrollbar flex gap-2">
          {presetRanges.map((p) => {
            const active = p.from === from && p.to === to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => apply(p.from, p.to)}
                aria-pressed={active}
                className={`text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors ${
                  active
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </ScrollRow>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="From" htmlFor="range-from" className="flex-1">
          <Input
            id="range-from"
            type="date"
            value={localFrom}
            max={localTo}
            onChange={(e) => setLocalFrom(e.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="range-to" className="flex-1">
          <Input
            id="range-to"
            type="date"
            value={localTo}
            min={localFrom}
            max={toISODate()}
            onChange={(e) => setLocalTo(e.target.value)}
          />
        </Field>
        <Button
          size="lg"
          icon="refresh"
          className="sm:w-auto"
          block
          onClick={() => apply(localFrom, localTo)}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
