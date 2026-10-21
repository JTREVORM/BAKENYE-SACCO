'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { clsx } from '@/lib/clsx';

const RANGES = [
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
] as const;

/**
 * The range control.
 *
 * A `<details>` disclosure rather than a `<select>`: it is two links to the
 * same page with a different range, which is what it actually is, and it needs
 * no JavaScript to open or navigate. The mount effect restores the anchor once
 * the streamed chart exists; the browser's initial anchor lookup can precede it.
 */
export function FinancialRangePicker({ months, baseHref }: { months: number; baseHref: string }) {
  const control = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.location.hash === '#financial-activity') {
      control.current?.closest('section')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, []);

  const current = RANGES.find((r) => r.months === months) ?? RANGES[0];

  return (
    <details ref={control} className="group relative">
      <summary className="text-label-md text-on-surface-variant bg-surface-container hover:bg-surface-container-high flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-3 font-semibold transition-colors [&::-webkit-details-marker]:hidden">
        {current.label}
        <Icon name="expand_more" size={16} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="bg-surface absolute right-0 z-20 mt-1.5 w-40 overflow-hidden rounded-xl p-1 shadow-pop">
        {RANGES.map((r) => (
          <a
            key={r.months}
            // A native navigation avoids the intermittent stalled RSC search-
            // parameter transition. The anchor keeps mobile readers at the chart.
            href={`${baseHref}?flow=${r.months}#financial-activity`}
            aria-current={r.months === months ? 'true' : undefined}
            className={clsx(
              'text-body-md flex h-10 items-center gap-2 rounded-lg px-3 transition-colors',
              r.months === months
                ? 'text-primary bg-primary-fixed font-semibold'
                : 'text-on-surface hover:bg-surface-container-high',
            )}
          >
            {r.months === months ? <Icon name="check" size={16} /> : null}
            {r.label}
          </a>
        ))}
      </div>
    </details>
  );
}
