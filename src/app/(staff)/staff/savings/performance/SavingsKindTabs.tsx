'use client';

import { useRouter } from 'next/navigation';
import { StatementRange } from '@/components/StatementRange';
import { SAVINGS_FREQUENCY_ADVERB } from '@/lib/categories';
import { formatUGX } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { SavingsCategoryRow, SavingsKind } from '@/types/db';

/**
 * Weekly / monthly switch, the category filter and the date range — all held in
 * the URL so a manager can bookmark "Silver Savers, this month".
 *
 * The cadence tabs and the category list are related but not the same
 * question: a category collects on one cadence, so choosing Gold Saver while
 * the Weekly tab is open would return nothing. Selecting a category therefore
 * moves the tab to that category's own frequency rather than silently showing
 * an empty table.
 */
export function SavingsKindTabs({
  kind,
  from,
  to,
  category,
  categories,
}: {
  kind: SavingsKind;
  from: string;
  to: string;
  category: string;
  categories: SavingsCategoryRow[];
}) {
  const router = useRouter();

  function push(next: { kind?: SavingsKind; category?: string }) {
    const chosen = next.category ?? category;
    const matched = categories.find((c) => c.id === chosen);

    const params = new URLSearchParams({
      // A chosen category decides the cadence; otherwise the tab does.
      kind: next.category !== undefined && matched ? matched.frequency : (next.kind ?? kind),
      from,
      to,
    });
    if (chosen) params.set('category', chosen);
    router.push(`/staff/savings/performance?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Savings cadence"
          className="bg-surface-container inline-flex rounded-full p-1"
        >
          {(['weekly', 'monthly'] as SavingsKind[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => push({ kind: k })}
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

        <label className="flex items-center gap-2">
          <span className="text-label-md font-label-md text-on-surface-variant">Category</span>
          <select
            value={category}
            onChange={(e) => push({ category: e.target.value })}
            className="bg-surface-container text-label-md font-label-md text-on-surface shadow-neu-inset focus:ring-2 focus:ring-primary/40 h-touch-target-min max-w-[16rem] rounded-full border-0 py-0 pl-4 pr-8 normal-case outline-none"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {formatUGX(c.amount)} {SAVINGS_FREQUENCY_ADVERB[c.frequency]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <StatementRange from={from} to={to} />
    </div>
  );
}
