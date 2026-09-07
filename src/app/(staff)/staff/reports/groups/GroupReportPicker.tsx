'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { savingDayLabel } from '@/lib/groups';
import type { SaccoGroupRow } from '@/types/db';

/**
 * Which group, over which dates.
 *
 * The choice lives in the URL alongside the date range, so a printed report and
 * a shared link show the same figures.
 */
export function GroupReportPicker({
  groups,
  selected,
}: {
  groups: SaccoGroupRow[];
  selected: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label-md font-label-md text-on-surface-variant uppercase">Group</span>
      <select
        value={selected}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set('group', e.target.value);
          else next.delete('group');
          router.push(`/staff/reports/groups?${next.toString()}`);
        }}
        className="bg-surface-container-lowest border-outline-variant text-body-lg font-body-lg text-on-surface focus:border-primary focus:ring-primary h-touch-target-primary w-full rounded-lg border px-4 outline-none focus:ring-1"
      >
        <option value="">Choose a group…</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} · {savingDayLabel(g.saving_day)}
          </option>
        ))}
      </select>
    </label>
  );
}
