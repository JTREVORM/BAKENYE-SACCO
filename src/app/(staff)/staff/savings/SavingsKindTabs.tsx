'use client';

import { useRouter } from 'next/navigation';
import { StatementRange } from '@/components/StatementRange';
import { clsx } from '@/lib/clsx';
import type { SavingsKind } from '@/types/db';

/**
 * Weekly / monthly switch plus the date range, both held in the URL so a
 * cashier can bookmark "this month's weekly sheet".
 */
export function SavingsKindTabs({
  kind,
  from,
  to,
}: {
  kind: SavingsKind;
  from: string;
  to: string;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Savings type"
        className="bg-surface-container inline-flex rounded-full p-1"
      >
        {(['weekly', 'monthly'] as SavingsKind[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => router.push(`/staff/savings?kind=${k}&from=${from}&to=${to}`)}
            className={clsx(
              'text-button-text font-button-text h-touch-target-min rounded-full px-6 transition-colors',
              kind === k
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high',
            )}
          >
            {k === 'weekly' ? 'Weekly' : 'Monthly'}
          </button>
        ))}
      </div>

      <StatementRange from={from} to={to} />
    </div>
  );
}
