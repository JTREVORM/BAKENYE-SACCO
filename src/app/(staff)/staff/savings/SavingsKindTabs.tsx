'use client';

import { useRouter } from 'next/navigation';
import { StatementRange } from '@/components/StatementRange';
import { savingDayLabel } from '@/lib/groups';
import { clsx } from '@/lib/clsx';
import type { SaccoGroupRow, SavingsKind } from '@/types/db';

/**
 * Weekly / monthly switch, the group filter and the date range — all held in
 * the URL so a cashier can bookmark "the Wednesday group, this month".
 */
export function SavingsKindTabs({
  kind,
  from,
  to,
  group,
  groups,
}: {
  kind: SavingsKind;
  from: string;
  to: string;
  group: string;
  groups: SaccoGroupRow[];
}) {
  const router = useRouter();

  function push(next: { kind?: SavingsKind; group?: string }) {
    const params = new URLSearchParams({
      kind: next.kind ?? kind,
      from,
      to,
    });
    const g = next.group ?? group;
    if (g) params.set('group', g);
    router.push(`/staff/savings?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
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
          <span className="text-label-md font-label-md text-on-surface-variant">Group</span>
          <select
            value={group}
            onChange={(e) => push({ group: e.target.value })}
            className="bg-surface-container text-label-md font-label-md text-on-surface shadow-neu-inset focus:ring-2 focus:ring-primary/40 h-touch-target-min max-w-[14rem] rounded-full border-0 py-0 pl-4 pr-8 normal-case outline-none"
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {savingDayLabel(g.saving_day)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <StatementRange from={from} to={to} />
    </div>
  );
}
