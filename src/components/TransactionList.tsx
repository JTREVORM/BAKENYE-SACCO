'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { TransactionRow } from '@/components/member/TransactionRow';
import { EmptyState } from '@/components/ui/states';
import { Button, SearchInput } from '@/components/ui/form';
import { TXN_LABELS } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { TransactionFeedRow, TxnType } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

/**
 * Filterable, paginated transaction feed.
 *
 * Filters live in the URL, so a cashier can bookmark "today's mobile-money
 * collections" and the back button behaves. Paging is server-side — the phone
 * receives one page, never the whole ledger.
 */

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'savings', label: 'Savings' },
  { value: 'share_purchase', label: 'Shares' },
  { value: 'loan_repayment', label: 'Repayments' },
  { value: 'loan_disbursement', label: 'Disbursements' },
  { value: 'deposit', label: 'Deposits' },
  { value: 'withdrawal', label: 'Withdrawals' },
];

export function TransactionList({
  rows,
  total,
  page,
  pageSize,
  basePath,
  showMember = false,
  showSearch = true,
}: {
  rows: TransactionFeedRow[];
  total: number;
  page: number;
  pageSize: number;
  /** `/transactions` for members, `/staff/transactions` for staff. */
  basePath: string;
  showMember?: boolean;
  showSearch?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      // Any filter change resets to the first page — otherwise you land on
      // page 4 of a 2-page result and see an empty screen.
      if (key !== 'page') next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const activeType = params.get('type') ?? '';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      {showSearch ? (
        <SearchInput
          defaultValue={params.get('q') ?? ''}
          onSearch={(v) => setParam('q', v)}
          placeholder="Search by reference or member…"
        />
      ) : null}

      {/* Horizontally scrolling filter chips — the pattern Stitch used for the
          loans screen, reused here so the two feel like one app. */}
      <ScrollRow
        label="Filter by type"
        wrapperClassName="-mx-container-margin-mobile md:mx-0"
        className="no-scrollbar flex gap-2 px-container-margin-mobile md:flex-wrap md:px-0"
      >
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setParam('type', f.value)}
            aria-pressed={activeType === f.value}
            className={clsx(
              'text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors',
              activeType === f.value
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
            )}
          >
            {f.label}
          </button>
        ))}
      </ScrollRow>

      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="receipt_long"
            title={activeType || params.get('q') ? 'No matching transactions' : 'No transactions yet'}
            description={
              activeType || params.get('q')
                ? 'Try a different filter or search term.'
                : 'Your transactions will appear here.'
            }
            action={
              activeType || params.get('q') ? (
                <Button
                  variant="outline"
                  onClick={() => router.push(pathname)}
                  icon="refresh"
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <p className="text-label-md font-label-md text-on-surface-variant normal-case">
            {total.toLocaleString()} transaction{total === 1 ? '' : 's'}
            {activeType ? ` · ${TYPE_FILTERS.find((f) => f.value === activeType)?.label}` : ''}
          </p>

          <div className="flex flex-col gap-2">
            {rows.map((t) => (
              <TransactionRow
                key={t.id}
                txn={t}
                href={`${basePath}/${t.id}`}
                showMember={showMember}
              />
            ))}
          </div>

          {totalPages > 1 ? (
            <nav
              className="mt-2 flex items-center justify-between gap-3"
              aria-label="Transaction pages"
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

/** Maps the friendly `type` query value onto the `txn_type` values it covers. */
export function typeFilterToTypes(value: string | undefined): TxnType[] | null {
  if (!value) return null;
  if (value === 'savings') return ['weekly_savings', 'monthly_savings'];
  if (value in TXN_LABELS) return [value as TxnType];
  return null;
}
