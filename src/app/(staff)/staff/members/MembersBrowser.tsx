'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Avatar, Icon, Money } from '@/components/ui/primitives';
import { MemberStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { Button, SearchInput } from '@/components/ui/form';
import { formatDate, formatPhone } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import { shareCount } from '@/lib/savings';
import { formatUGX } from '@/lib/money';
import type { MemberFinancialsRow, MemberStatus } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

/**
 * Member directory.
 *
 * Search, status filter, sort and paging are all query-string state handled by
 * `search_members()` on the server. The client never holds more than one page,
 * which is the difference between a directory that works at 500 members and one
 * that stops working at 500 members.
 *
 * Below `md` each member is the card the brief specifies — name, member number,
 * savings, shares, loan, and a way through to the profile. From `md` up it is
 * the full table from `members_staff_mobile` extended to desktop widths.
 */

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

const SORTS: { value: string; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'recent', label: 'Newest' },
  { value: 'number', label: 'Member no.' },
  { value: 'savings', label: 'Savings' },
  { value: 'shares', label: 'Shares' },
  { value: 'loan', label: 'Loan balance' },
];

export function MembersBrowser({
  rows,
  total,
  page,
  pageSize,
  canRegister,
}: {
  rows: MemberFinancialsRow[];
  total: number;
  page: number;
  pageSize: number;
  canRegister: boolean;
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
  const sort = params.get('sort') ?? 'name';
  const q = params.get('q') ?? '';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = !!(status || q);

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-col gap-3">
        <SearchInput
          defaultValue={q}
          onSearch={(v) => setParam('q', v)}
          placeholder="Search by name, member number or phone…"
        />

        <div className="flex flex-wrap items-center gap-3">
          <ScrollRow label="Filter by status" wrapperClassName="min-w-0 flex-1" className="no-scrollbar flex gap-2">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setParam('status', s.value)}
                aria-pressed={status === s.value}
                className={clsx(
                  'text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors',
                  status === s.value
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
                )}
              >
                {s.label}
              </button>
            ))}
          </ScrollRow>

          <label className="flex shrink-0 items-center gap-2">
            <span className="text-label-md font-label-md text-on-surface-variant">Sort</span>
            <select
              value={sort}
              onChange={(e) => setParam('sort', e.target.value)}
              className="bg-surface-container text-label-md font-label-md text-on-surface shadow-neu-inset focus:ring-2 focus:ring-primary/40 h-touch-target-min rounded-full border-0 py-0 pl-4 pr-8 normal-case outline-none"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
        {total.toLocaleString()} {total === 1 ? 'member' : 'members'}
        {status ? ` · ${STATUSES.find((s) => s.value === status)?.label}` : ''}
      </p>

      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="group"
            title={filtered ? 'No matching members' : 'No members yet'}
            description={
              filtered
                ? 'Try a different search term or filter.'
                : 'Register your first member to get started.'
            }
            action={
              filtered ? (
                <Button variant="outline" icon="refresh" onClick={() => router.push(pathname)}>
                  Clear filters
                </Button>
              ) : canRegister ? (
                <Link
                  href="/staff/members/new"
                  className="bg-primary text-on-primary h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-5 font-semibold"
                >
                  <Icon name="person_add" size={20} />
                  Register a member
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/staff/members/${m.id}`}
                  className="bg-surface border-surface-container shadow-card hover:bg-surface-container-low block rounded-xl border p-3 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={m.full_name} src={m.photo_url} size={48} />
                    <div className="min-w-0 flex-1">
                      <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                        {m.full_name}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                        {m.member_no} · {formatPhone(m.phone)}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant/80 truncate normal-case">
                        Joined {formatDate(m.joined_on)}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <MemberStatusBadge status={m.status as MemberStatus} />
                    </div>
                  </div>

                  <dl className="border-outline-variant mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                    <Figure label="Savings" value={m.savings_balance} />
                    <Figure label="Shares" value={m.share_value} />
                    <Figure
                      label="Loan"
                      value={m.loan_balance}
                      tone={Number(m.loan_balance) > 0 ? 'text-error' : undefined}
                    />
                  </dl>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="bg-surface shadow-card hidden overflow-hidden rounded-xl md:block">
            <ScrollRow arrows="overlay" label="Table, scrolls sideways">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">Member</th>
                    <th className="p-4 font-semibold">Phone</th>
                    <th className="p-4 font-semibold">This month</th>
                    <th className="p-4 text-right font-semibold">Savings</th>
                    <th className="p-4 text-right font-semibold">Shares</th>
                    <th className="p-4 text-right font-semibold">Loan balance</th>
                    <th className="p-4 font-semibold">Joined</th>
                    <th className="p-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {rows.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="p-4">
                        <Link href={`/staff/members/${m.id}`} className="min-h-touch-target-min flex items-center gap-3">
                          <Avatar name={m.full_name} src={m.photo_url} size={36} />
                          <div className="min-w-0">
                            <div className="text-primary truncate font-semibold">{m.full_name}</div>
                            <div className="text-on-surface-variant tabular text-xs">
                              {m.member_no}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="tabular text-on-surface-variant p-4 whitespace-nowrap">
                        {formatPhone(m.phone)}
                      </td>
                      {/* What they have saved since the first of the month.
                        There is no target beside it, because there is none. */}
                      <td className="p-4">
                        <span className="text-on-surface tabular font-semibold">
                          {formatUGX(m.savings_this_month)}
                        </span>
                        <span className="text-on-surface-variant block text-xs">
                          {m.last_saved_on
                            ? `last saved ${formatDate(m.last_saved_on)}`
                            : 'nothing saved yet'}
                        </span>
                      </td>
                      <td className="tabular p-4 text-right">
                        <Money value={m.savings_balance} />
                      </td>
                      <td className="tabular p-4 text-right">
                        <Money value={m.share_value} />
                        <span className="text-on-surface-variant block text-xs">
                          {shareCount(Number(m.share_count))}
                        </span>
                      </td>
                      <td
                        className={clsx(
                          'tabular p-4 text-right',
                          Number(m.loan_balance) > 0 && 'text-error font-semibold',
                        )}
                      >
                        <Money value={m.loan_balance} />
                        {Number(m.overdue_amount) > 0 ? (
                          <span className="text-error block text-xs">
                            {formatDate(m.next_due_on)} overdue
                          </span>
                        ) : null}
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {formatDate(m.joined_on)}
                      </td>
                      <td className="p-4">
                        <MemberStatusBadge status={m.status as MemberStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRow>
          </div>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3" aria-label="Member pages">
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

function Figure({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd className={clsx('text-body-md font-body-md truncate font-semibold', tone ?? 'text-on-surface')}>
        <Money value={value} />
      </dd>
    </div>
  );
}
