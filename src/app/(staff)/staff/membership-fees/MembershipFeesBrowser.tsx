'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Avatar, Icon } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { Button, SearchInput } from '@/components/ui/form';
import { ScrollRow } from '@/components/ui/scroll';
import { CollectMembershipFeeDialog } from '@/components/fees/CollectMembershipFeeDialog';
import { formatDate } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { MEMBERSHIP_FEE_STATUS_LABELS, MEMBERSHIP_FEE_STATUS_TONES } from '@/lib/fees';
import { clsx } from '@/lib/clsx';
import type { CollectionAccount } from '@/types/access';
import type { MembershipFeeRow } from '@/types/db';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Everyone' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Part paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'waived', label: 'Waived' },
];

/**
 * Every member and where they stand on the membership fee.
 *
 * Members who owe something are listed first, because they are the reason a
 * cashier opens this screen. What a member was charged is shown beside what
 * they have paid: the two differ for anyone who joined when the fee was a
 * different amount, and the balance is always measured against the charge, not
 * against today's price list.
 */
export function MembershipFeesBrowser({
  rows,
  total,
  page,
  pageSize,
  accounts,
  canCollect,
}: {
  rows: MembershipFeeRow[];
  total: number;
  page: number;
  pageSize: number;
  accounts: CollectionAccount[];
  canCollect: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [collecting, setCollecting] = useState<MembershipFeeRow | null>(null);

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
  const filtered = !!(status || q);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 print:hidden">
        <SearchInput
          defaultValue={q}
          onSearch={(v) => setParam('q', v)}
          placeholder="Search by member name or number…"
        />

        <ScrollRow label="Filter by status" className="no-scrollbar flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
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
      </div>

      <div className="flex items-center justify-between gap-3 print:hidden">
        <p className="text-label-md font-label-md text-on-surface-variant normal-case">
          {total.toLocaleString()} {total === 1 ? 'member' : 'members'}
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
            icon="badge"
            title={filtered ? 'No members match' : 'No members yet'}
            description={
              filtered
                ? 'Try a different search or filter.'
                : 'A member appears here as soon as they are registered and charged the membership fee.'
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden print:hidden">
            {rows.map((r) => (
              <li
                key={r.member_id}
                className="bg-surface border-surface-container shadow-card rounded-xl border p-3"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={r.full_name} size={44} />
                  <Link
                    href={`/staff/members/${r.member_id}`}
                    className="min-h-touch-target-min flex min-w-0 flex-1 flex-col justify-center"
                  >
                    <span className="text-body-lg font-body-lg text-primary block truncate font-semibold">
                      {r.full_name}
                    </span>
                    <span className="text-label-md font-label-md text-on-surface-variant tabular block truncate normal-case">
                      {r.member_no}
                      {r.registered_on ? ` · joined ${formatDate(r.registered_on)}` : ''}
                    </span>
                  </Link>
                  <StatusChip status={r.status} />
                </div>

                <dl className="border-outline-variant mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                  <Cell label="Required" value={r.required_amount} />
                  <Cell label="Paid" value={r.paid_amount} tone="text-tertiary" />
                  <Cell label="Balance" value={r.outstanding_amount} tone="text-primary" />
                </dl>

                <p className="text-label-md font-label-md text-on-surface-variant mt-2 normal-case">
                  {r.last_payment_on
                    ? `Last paid ${formatDate(r.last_payment_on)}${r.last_receipt_no ? ` · ${r.last_receipt_no}` : ''}`
                    : 'No payment yet'}
                </p>

                {canCollect && toNumber(r.outstanding_amount) > 0 ? (
                  <Button
                    size="sm"
                    icon="payments"
                    className="mt-3"
                    onClick={() => setCollecting(r)}
                  >
                    Collect fee
                  </Button>
                ) : null}
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
                    <th className="p-4 font-semibold">Registered</th>
                    <th className="p-4 text-right font-semibold">Required</th>
                    <th className="p-4 text-right font-semibold">Paid</th>
                    <th className="p-4 text-right font-semibold">Balance</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Last payment</th>
                    <th className="p-4 font-semibold">Receipt</th>
                    <th className="p-4 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {rows.map((r) => (
                    <tr key={r.member_id} className="hover:bg-surface-container-low transition-colors">
                      <td className="p-4">
                        <Link
                          href={`/staff/members/${r.member_id}`}
                          className="min-h-touch-target-min flex items-center gap-3"
                        >
                          <Avatar name={r.full_name} size={32} />
                          <span className="min-w-0">
                            <span className="text-primary block truncate font-semibold">
                              {r.full_name}
                            </span>
                            <span className="text-on-surface-variant tabular block text-xs">
                              {r.member_no}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {r.registered_on ? formatDate(r.registered_on) : '—'}
                      </td>
                      <td className="tabular p-4 text-right">{formatUGX(r.required_amount)}</td>
                      <td className="tabular text-tertiary p-4 text-right font-semibold">
                        {formatUGX(r.paid_amount)}
                      </td>
                      <td
                        className={clsx(
                          'tabular p-4 text-right font-semibold',
                          toNumber(r.outstanding_amount) > 0 ? 'text-primary' : 'text-on-surface-variant',
                        )}
                      >
                        {formatUGX(r.outstanding_amount)}
                      </td>
                      <td className="p-4">
                        <StatusChip status={r.status} />
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {r.last_payment_on ? formatDate(r.last_payment_on) : '—'}
                      </td>
                      <td className="text-on-surface-variant tabular p-4 whitespace-nowrap">
                        {r.last_receipt_no ?? r.last_reference ?? '—'}
                      </td>
                      <td className="p-4 text-right">
                        {canCollect && toNumber(r.outstanding_amount) > 0 ? (
                          <Button size="sm" icon="payments" onClick={() => setCollecting(r)}>
                            Collect
                          </Button>
                        ) : (
                          <span className="text-on-surface-variant text-xs">—</span>
                        )}
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
              aria-label="Membership fee pages"
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

      {collecting ? (
        <CollectMembershipFeeDialog
          memberId={collecting.member_id}
          memberName={collecting.full_name}
          required={toNumber(collecting.required_amount)}
          paid={toNumber(collecting.paid_amount)}
          outstanding={toNumber(collecting.outstanding_amount)}
          accounts={accounts}
          onClose={() => {
            setCollecting(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function StatusChip({ status }: { status: MembershipFeeRow['status'] }) {
  return (
    <span
      className={clsx(
        'text-label-md font-label-md inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 normal-case',
        MEMBERSHIP_FEE_STATUS_TONES[status],
      )}
    >
      <Icon
        name={
          status === 'paid'
            ? 'check_circle'
            : status === 'partial'
              ? 'pending'
              : status === 'waived'
                ? 'block'
                : 'schedule'
        }
        size={16}
      />
      {MEMBERSHIP_FEE_STATUS_LABELS[status]}
    </span>
  );
}

function Cell({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate normal-case">
        {label}
      </dt>
      <dd className={clsx('text-body-md tabular truncate font-semibold', tone ?? 'text-on-surface')}>
        {formatUGX(value)}
      </dd>
    </div>
  );
}
