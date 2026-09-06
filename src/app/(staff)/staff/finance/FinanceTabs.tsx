'use client';

import Link from 'next/link';
import { clsx } from '@/lib/clsx';

const TABS = [
  { value: 'summary', label: 'Cashbook' },
  { value: 'income', label: 'Income' },
  { value: 'expenses', label: 'Expenses' },
];

export function FinanceTabs({ tab, from, to }: { tab: string; from: string; to: string }) {
  return (
    <div
      role="tablist"
      aria-label="Finance view"
      className="bg-surface-container inline-flex rounded-full p-1"
    >
      {TABS.map((t) => (
        <Link
          key={t.value}
          role="tab"
          aria-selected={tab === t.value}
          href={`/staff/finance?tab=${t.value}&from=${from}&to=${to}`}
          className={clsx(
            'text-button-text font-button-text h-touch-target-min flex items-center rounded-full px-5 transition-colors',
            tab === t.value
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
