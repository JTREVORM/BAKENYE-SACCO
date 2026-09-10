'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Avatar, Money } from '@/components/ui/primitives';
import { SavingsStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { Button, SearchInput } from '@/components/ui/form';
import { SAVINGS_STATUS_LABELS, formatDate } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import { SAVINGS_FREQUENCY_ADVERB } from '@/lib/categories';
import type { SavingsCategoryRow, SavingsScheduleRow, SavingsStatus } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

/**
 * Every scheduled contribution, filterable.
 *
 * This is the arrears view: a schedule is never deleted, so a member who missed
 * three weeks in July is still here in September with the shortfall attached.
 */

const STATUSES: ('' | SavingsStatus)[] = ['', 'pending', 'partial', 'paid', 'missed', 'waived'];

export function SchedulesBrowser({
  rows,
  total,
  page,
  pageSize,
  categories,
  totals,
}: {
  rows: SavingsScheduleRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: SavingsCategoryRow[];
  totals: { expected: number; paid: number; outstanding: number };
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

  const status = params.get('status') ?? '';
  const category = params.get('category') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const q = params.get('q') ?? '';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = !!(status || category || from || to || q);

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------- controls */}
      <div className="flex flex-col gap-3 print:hidden">
        <SearchInput
          defaultValue={q}
          onSearch={(v) => setParam('q', v)}
          placeholder="Search by member name or number…"
        />

        <ScrollRow label="Filter by status" className="no-scrollbar flex gap-2">
          {STATUSES.map((s) => (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => setParam('status', s)}
              aria-pressed={status === s}
              className={clsx(
                'text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors',
                status === s
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              {s ? SAVINGS_STATUS_LABELS[s] : 'All'}
            </button>
          ))}
        </ScrollRow>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">
              Savings category
            </span>
            <select
              value={category}
              onChange={(e) => setParam('category', e.target.value)}
              className="bg-surface-container text-body-md font-body-md text-on-surface shadow-neu-inset focus:ring-2 focus:ring-primary/40 h-touch-target-primary rounded-full border-0 px-4 outline-none"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {formatUGX(c.amount)} {SAVINGS_FREQUENCY_ADVERB[c.frequency]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">
              Due from
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setParam('from', e.target.value)}
              className="bg-surface-container text-body-md font-body-md text-on-surface shadow-neu-inset focus:ring-2 focus:ring-primary/40 h-touch-target-primary rounded-full border-0 px-4 outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">
              Due to
            </span>
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
      <section className="bg-surface shadow-card grid grid-cols-3 gap-4 rounded-xl p-4">
        <Total label="Expected" value={totals.expected} />
        <Total label="Paid" value={totals.paid} tone="text-tertiary" />
        <Total
          label="Outstanding"
          value={totals.outstanding}
          tone={totals.outstanding > 0 ? 'text-error' : undefined}
        />
      </section>

      <div className="flex items-center justify-between gap-3 print:hidden">
        <p className="text-label-md font-label-md text-on-surface-variant normal-case">
          {total.toLocaleString()} {total === 1 ? 'schedule' : 'schedules'} on this page of results
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
            title={filtered ? 'No schedules match' : 'No schedules yet'}
            description={
              filtered
                ? 'Try a different status, category or date range.'
                : 'Schedules appear once members are given a savings category and their cycles open.'
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
                      {r.member_no}
                      {r.savings_category_name
                        ? ` · ${r.savings_category_name}`
                        : ' · no category'}
                    </span>
                  </Link>
                  <SavingsStatusBadge status={r.status} />
                </div>

                <dl className="border-outline-variant mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                  <Cell label="Expected" value={r.expected_amount} />
                  <Cell label="Paid" value={r.paid_amount} tone="text-tertiary" />
                  <Cell
                    label="Outstanding"
                    value={r.outstanding}
                    tone={toNumber(r.outstanding) > 0 ? 'text-error' : undefined}
                  />
                </dl>

                <p className="text-label-md font-label-md text-on-surface-variant mt-2 normal-case">
                  {r.period_label} · due {formatDate(r.due_on)}
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
                    <th className="p-4 font-semibold">Category</th>
                    <th className="p-4 font-semibold">Cycle</th>
                    <th className="p-4 font-semibold">Due</th>
                    <th className="p-4 text-right font-semibold">Expected</th>
                    <th className="p-4 text-right font-semibold">Paid</th>
                    <th className="p-4 text-right font-semibold">Outstanding</th>
                    <th className="p-4 font-semibold">Status</th>
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
                      <td className="p-4">
                        {r.savings_category_name ? (
                          <span className="text-on-surface">{r.savings_category_name}</span>
                        ) : (
                          <span className="text-on-surface-variant">—</span>
                        )}
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {r.cycle}
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {formatDate(r.due_on)}
                      </td>
                      <td className="tabular p-4 text-right">{formatUGX(r.expected_amount)}</td>
                      <td className="tabular text-tertiary p-4 text-right font-semibold">
                        {formatUGX(r.paid_amount)}
                      </td>
                      <td
                        className={clsx(
                          'tabular p-4 text-right',
                          toNumber(r.outstanding) > 0 && 'text-error font-semibold',
                        )}
                      >
                        {formatUGX(r.outstanding)}
                      </td>
                      <td className="p-4">
                        <SavingsStatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRow>
          </div>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3 print:hidden" aria-label="Schedule pages">
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
      <p className="text-label-md font-label-md text-on-surface-variant truncate">
        {label}
      </p>
      <Money
        value={value}
        compact
        className={clsx('text-body-lg font-body-lg mt-0.5 font-bold', tone ?? 'text-on-surface')}
      />
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd
        className={clsx(
          'text-body-md font-body-md truncate font-semibold',
          tone ?? 'text-on-surface',
        )}
      >
        <Money value={value} />
      </dd>
    </div>
  );
}
