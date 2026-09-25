'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Avatar, Money } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { Button, SearchInput } from '@/components/ui/form';
import { formatDate } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { depositCount } from '@/lib/savings';
import { clsx } from '@/lib/clsx';
import type { SavingsScheduleRow } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

/**
 * Every member's savings, month by month, filterable.
 *
 * The status chips are gone. A savings month has no status worth filtering on
 * any more: either money went in or it did not, and neither is a problem to
 * chase. The one filter left says exactly that.
 */

const SAVED_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All months' },
  { value: 'yes', label: 'Months with savings' },
  { value: 'no', label: 'Months without' },
];

export function SavingsRecordsBrowser({
  rows,
  total,
  page,
  pageSize,
  totals,
}: {
  rows: SavingsScheduleRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: { saved: number; deposits: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const saved = params.get('saved') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const q = params.get('q') ?? '';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = !!(saved || from || to || q);

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------- controls */}
      <div className="flex flex-col gap-3 print:hidden">
        <SearchInput
          defaultValue={q}
          onSearch={(v) => setParam('q', v)}
          placeholder="Search by member name or number…"
        />

        <ScrollRow label="Filter months" className="no-scrollbar flex gap-2">
          {SAVED_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setParam('saved', f.value)}
              aria-pressed={saved === f.value}
              className={clsx(
                'text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors',
                saved === f.value
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              {f.label}
            </button>
          ))}
        </ScrollRow>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setParam('from', e.target.value)}
              className="bg-surface-container text-body-md font-body-md text-on-surface shadow-neu-inset focus:ring-2 focus:ring-primary/40 h-touch-target-primary rounded-full border-0 px-4 outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setParam('to', e.target.value)}
              className="bg-surface-container text-body-md font-body-md text-on-surface shadow-neu-inset focus:ring-2 focus:ring-primary/40 h-touch-target-primary rounded-full border-0 px-4 outline-none"
            />
          </label>
        </div>
      </div>

      {/* --------------------------------------------------------- totals */}
      <section className="bg-surface shadow-card grid grid-cols-2 gap-4 rounded-xl p-4">
        <Total label="Saved (this page)" value={totals.saved} tone="text-tertiary" />
        <div className="min-w-0">
          <p className="text-label-md font-label-md text-on-surface-variant truncate">
            Deposits (this page)
          </p>
          <p className="text-body-lg font-body-lg text-on-surface tabular mt-0.5 font-bold">
            {totals.deposits}
          </p>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 print:hidden">
        <p className="text-label-md font-label-md text-on-surface-variant normal-case">
          {total.toLocaleString()} {total === 1 ? 'record' : 'records'} found
        </p>
        {filtered ? (
          <Button variant="ghost" icon="refresh" onClick={() => router.push(pathname)}>
            Clear
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="calendar_month"
            title={filtered ? 'No records match' : 'No savings records yet'}
            description={
              filtered
                ? 'Try a different date range or search.'
                : 'A month appears here the first time a member saves in it.'
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden print:hidden">
            {rows.map((r) => (
              <li
                key={r.schedule_id}
                className="bg-surface border-surface-container shadow-card rounded-xl border p-3"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={r.member_name} src={r.member_photo} size={44} />
                  <Link
                    href={`/staff/members/${r.member_id}`}
                    className="min-h-touch-target-min flex min-w-0 flex-1 flex-col justify-center"
                  >
                    <span className="text-body-lg font-body-lg text-primary block truncate font-semibold">
                      {r.member_name}
                    </span>
                    <span className="text-label-md font-label-md text-on-surface-variant tabular block truncate normal-case">
                      {r.member_no} · {r.cycle}
                    </span>
                  </Link>
                  <Money
                    value={r.saved_amount}
                    className="text-body-lg font-body-lg text-tertiary shrink-0 font-bold"
                  />
                </div>

                <p className="text-label-md font-label-md text-on-surface-variant border-outline-variant mt-3 border-t pt-3 normal-case">
                  {depositCount(toNumber(r.deposits))}
                  {r.last_paid_on ? ` · last on ${formatDate(r.last_paid_on)}` : ''}
                </p>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="bg-surface shadow-card hidden overflow-hidden rounded-xl lg:block">
            <ScrollRow arrows="overlay" label="Table, scrolls sideways">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">Member</th>
                    <th className="p-4 font-semibold">Month</th>
                    <th className="p-4 text-center font-semibold">Deposits</th>
                    <th className="p-4 text-right font-semibold">Saved</th>
                    <th className="p-4 font-semibold">Last deposit</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {rows.map((r) => (
                    <tr
                      key={r.schedule_id}
                      className="hover:bg-surface-container-low transition-colors"
                    >
                      <td className="p-4">
                        <Link
                          href={`/staff/members/${r.member_id}`}
                          className="min-h-touch-target-min flex items-center gap-3"
                        >
                          <Avatar name={r.member_name} src={r.member_photo} size={32} />
                          <span className="min-w-0">
                            <span className="text-primary block truncate font-semibold">
                              {r.member_name}
                            </span>
                            <span className="text-on-surface-variant tabular block text-xs">
                              {r.member_no}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">{r.cycle}</td>
                      <td className="tabular p-4 text-center">{toNumber(r.deposits)}</td>
                      <td className="tabular text-tertiary p-4 text-right font-semibold">
                        {formatUGX(r.saved_amount)}
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {r.last_paid_on ? formatDate(r.last_paid_on) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRow>
          </div>

          {totalPages > 1 ? (
            <nav
              className="flex items-center justify-between gap-3 print:hidden"
              aria-label="Savings record pages"
            >
              <Button
                variant="outline"
                icon="chevron_left"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                Previous
              </Button>
              <span className="text-label-md font-label-md text-on-surface-variant normal-case">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                iconEnd="chevron_right"
                disabled={page >= totalPages}
                onClick={() => setParam('page', String(page + 1))}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-label-md font-label-md text-on-surface-variant truncate">{label}</p>
      <Money
        value={value}
        compact
        className={clsx('text-body-lg font-body-lg mt-0.5 font-bold', tone ?? 'text-on-surface')}
      />
    </div>
  );
}
