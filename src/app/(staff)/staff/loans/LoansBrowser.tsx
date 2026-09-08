'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Avatar, Money } from '@/components/ui/primitives';
import { LoanStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { Button, SearchInput } from '@/components/ui/form';
import { formatDate } from '@/lib/format';
import { toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { LoanPortfolioRow } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

/**
 * Loan portfolio.
 *
 * Server-filtered and server-paged through `loan_portfolio()`. The status chips
 * map to the lifecycle states the brief defines, plus an "Overdue" view that is
 * a filter over live loans rather than a status of its own — a loan can be
 * active and overdue at the same time, and collapsing that into one status
 * would lose information the collections officer needs.
 */

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'applied', label: 'Applied' },
  { value: 'under_review', label: 'Under review' },
  { value: 'approved', label: 'Approved' },
  { value: 'active', label: 'Active' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
];

export function LoansBrowser({
  rows,
  total,
  page,
  pageSize,
  canReview,
}: {
  rows: LoanPortfolioRow[];
  total: number;
  page: number;
  pageSize: number;
  canReview: boolean;
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
  const q = params.get('q') ?? '';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // The search box filters the current page client-side. Loan volumes are far
  // lower than member volumes, and the status filter is the primary cut.
  const visible = q.trim()
    ? rows.filter((r) =>
        `${r.member_name} ${r.member_no} ${r.loan_no} ${r.product_name}`
          .toLowerCase()
          .includes(q.trim().toLowerCase()),
      )
    : rows;

  return (
    <div className="flex flex-col gap-4">
      <SearchInput
        defaultValue={q}
        onSearch={(v) => setParam('q', v)}
        placeholder="Search by member, loan number or product…"
      />

      <ScrollRow label="Filter by status" className="no-scrollbar flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setParam('status', f.value)}
            aria-pressed={status === f.value}
            className={clsx(
              'text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors',
              status === f.value
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
            )}
          >
            {f.label}
          </button>
        ))}
      </ScrollRow>

      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
        {total.toLocaleString()} {total === 1 ? 'loan' : 'loans'}
        {status ? ` · ${STATUS_FILTERS.find((f) => f.value === status)?.label}` : ''}
      </p>

      {visible.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="payments"
            title={status || q ? 'No matching loans' : 'No loans yet'}
            description={
              status || q
                ? 'Try a different filter or search term.'
                : 'Loan applications will appear here as members submit them.'
            }
            action={
              status || q ? (
                <Button variant="outline" icon="refresh" onClick={() => router.push(pathname)}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {visible.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/staff/loans/${l.id}`}
                  className="bg-surface border-surface-container shadow-card hover:bg-surface-container-low block rounded-xl border p-3 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={l.member_name} src={l.photo_url} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                        {l.member_name}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                        {l.loan_no} · {l.product_name}
                      </p>
                    </div>
                    <LoanStatusBadge status={l.status} />
                  </div>

                  <dl className="border-outline-variant mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                    <Cell label="Principal" value={l.principal} />
                    <Cell label="Outstanding" value={l.outstanding} />
                    <Cell
                      label="Overdue"
                      value={l.overdue_amount}
                      tone={toNumber(l.overdue_amount) > 0 ? 'text-error' : undefined}
                    />
                  </dl>

                  <p className="text-label-md font-label-md text-on-surface-variant mt-2 normal-case">
                    Applied {formatDate(l.applied_on)}
                    {l.next_due_on ? ` · next payment ${formatDate(l.next_due_on)}` : ''}
                  </p>
                </Link>
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
                    <th className="p-4 font-semibold">Loan</th>
                    <th className="p-4 text-right font-semibold">Principal</th>
                    <th className="p-4 text-right font-semibold">Outstanding</th>
                    <th className="p-4 font-semibold">Next due</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 text-center font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {visible.map((l) => (
                    <tr key={l.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={l.member_name} src={l.photo_url} size={32} />
                          <div className="min-w-0">
                            <div className="text-primary truncate font-semibold">
                              {l.member_name}
                            </div>
                            <div className="text-on-surface-variant tabular text-xs">
                              {l.member_no}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="tabular font-medium">{l.loan_no}</div>
                        <div className="text-on-surface-variant text-xs">{l.product_name}</div>
                      </td>
                      <td className="tabular p-4 text-right">
                        <Money value={l.principal} />
                      </td>
                      <td className="tabular p-4 text-right">
                        <Money value={l.outstanding} />
                        {toNumber(l.overdue_amount) > 0 ? (
                          <span className="text-error block text-xs">
                            <Money value={l.overdue_amount} /> overdue
                          </span>
                        ) : null}
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {formatDate(l.next_due_on)}
                      </td>
                      <td className="p-4">
                        <LoanStatusBadge status={l.status} />
                      </td>
                      <td className="p-4 text-center">
                        <Link
                          href={`/staff/loans/${l.id}`}
                          className="bg-surface-container-high hover:bg-surface-container text-label-md font-label-md text-primary inline-flex h-touch-target-min items-center rounded-lg px-3 font-semibold transition-colors shadow-neu-sm"
                        >
                          {canReview && ['applied', 'under_review'].includes(l.status)
                            ? 'Review'
                            : 'View'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRow>
          </div>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3" aria-label="Loan pages">
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

function Cell({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd className={clsx('text-body-md font-body-md truncate font-semibold', tone ?? 'text-on-surface')}>
        <Money value={value} />
      </dd>
    </div>
  );
}
