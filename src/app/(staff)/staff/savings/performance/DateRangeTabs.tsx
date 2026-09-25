'use client';

import { StatementRange } from '@/components/StatementRange';

/**
 * The date range this report covers, held in the URL so a manager can bookmark
 * "this month" and come back to it.
 *
 * It used to carry a weekly/monthly switch and a savings-category filter beside
 * it. Neither has anything left to select: savings are monthly and open, and
 * there are no categories to filter by.
 */
export function DateRangeTabs({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex flex-col gap-4">
      <StatementRange from={from} to={to} />
    </div>
  );
}
