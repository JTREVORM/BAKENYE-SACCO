import Link from 'next/link';
import { Badge, DataTable, Icon } from '@/components/ui/primitives';
import { TxnStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { ACCOUNT_TYPE_META, MOVEMENT_LABELS } from '@/lib/treasury-format';
import { formatDate, TXN_LABELS } from '@/lib/format';
import { formatAmount, formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import { expenseCategoryLabel } from '@/lib/expenses';
import type { AccountMovementRow } from '@/types/treasury';

/**
 * The account ledger: every entry on every account, or on one.
 *
 * A real table from `md` up - date, reference, account, type, description,
 * money in, money out, balance, recorded by, status - and a card per entry
 * below it, so a phone never scrolls a ten-column grid sideways. The balance
 * is the account's running balance by date, computed by Postgres.
 */
export function LedgerTable({
  rows,
  showAccount = true,
  showBalance = true,
  emptyTitle = 'No transactions yet',
  emptyBody = 'Collections, transfers and payments will appear here once they are recorded.',
}: {
  rows: AccountMovementRow[];
  showAccount?: boolean;
  showBalance?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-surface shadow-neu">
        <EmptyState icon="list_alt" title={emptyTitle} description={emptyBody} />
      </div>
    );
  }

  return (
    <>
      {/* Phone: a card per entry. */}
      <ul className="flex flex-col gap-2.5 md:hidden print:hidden">
        {rows.map((r) => {
          const inflow = toNumber(r.money_in) > 0;
          return (
            <li key={r.entry_id}>
              <Link
                href={`/staff/transactions/${r.transaction_id}`}
                className="block rounded-2xl bg-surface p-4 shadow-neu-sm transition-shadow active:shadow-neu-pressed"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-body-md font-semibold text-on-surface">
                      {r.member_name ?? expenseCategoryLabel(r.category_label, r.custom_expense)}
                    </p>
                    <p className="tabular truncate text-label-md font-normal text-on-surface-variant">
                      {r.reference} · {formatDate(r.entry_date)}
                    </p>
                  </div>
                  <span
                    className={clsx(
                      'tabular shrink-0 text-body-md font-bold',
                      inflow ? 'text-tertiary' : 'text-error',
                    )}
                  >
                    {inflow ? '+' : '−'} {formatUGX(inflow ? r.money_in : r.money_out)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={classTone(r.movement_class)}>{MOVEMENT_LABELS[r.movement_class]}</Badge>
                  {showAccount ? <Badge tone="neutral">{r.account_name}</Badge> : null}
                  {r.txn_status !== 'posted' ? <TxnStatusBadge status={r.txn_status} /> : null}
                </div>
                {showBalance ? (
                  <p className="tabular mt-2 text-label-md font-normal text-on-surface-variant">
                    Balance after: {formatUGX(r.running_balance)}
                  </p>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Tablet and up, and always in print: the ledger table. */}
      <div className="hidden md:block print:block">
        <DataTable
          dense
          head={
            <>
              <th>Date</th>
              <th>Reference</th>
              {showAccount ? <th>Account</th> : null}
              <th>Type</th>
              <th>Description</th>
              <th className="text-right">Money in</th>
              <th className="text-right">Money out</th>
              {showBalance ? <th className="text-right">Balance</th> : null}
              <th>Recorded by</th>
              <th>Status</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.entry_id}>
              <td className="whitespace-nowrap text-on-surface-variant">{formatDate(r.entry_date)}</td>
              <td className="whitespace-nowrap">
                <Link
                  href={`/staff/transactions/${r.transaction_id}`}
                  className="tabular font-mono text-label-md font-semibold text-primary hover:underline"
                >
                  {r.reference}
                </Link>
                {r.external_ref ? (
                  <span className="tabular block text-label-md font-normal text-on-surface-variant">
                    {r.external_ref}
                  </span>
                ) : null}
              </td>
              {showAccount ? (
                <td className="whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={clsx('h-2 w-2 shrink-0 rounded-full', ACCOUNT_TYPE_META[r.account_type].stripe)}
                    />
                    {r.account_name}
                  </span>
                </td>
              ) : null}
              <td className="whitespace-nowrap">
                <span className="block font-semibold text-on-surface">{TXN_LABELS[r.txn_type]}</span>
                <span className="block text-label-md font-normal text-on-surface-variant">
                  {MOVEMENT_LABELS[r.movement_class]}
                  {r.counter_account_name ? ` · ${r.money_in > 0 ? 'from' : 'to'} ${r.counter_account_name}` : ''}
                </span>
              </td>
              <td className="min-w-[200px] max-w-[320px]">
                {r.custom_expense ? (
                  <span className="block break-words font-semibold">{expenseCategoryLabel(r.category_label, r.custom_expense)}</span>
                ) : null}
                <span className="line-clamp-2">
                  {r.member_name ? `${r.member_name} (${r.member_no}) · ` : ''}
                  {r.description ?? r.category_label}
                </span>
              </td>
              <td className="tabular whitespace-nowrap text-right font-semibold text-tertiary">
                {toNumber(r.money_in) > 0 ? formatAmount(r.money_in) : ''}
              </td>
              <td className="tabular whitespace-nowrap text-right font-semibold text-error">
                {toNumber(r.money_out) > 0 ? formatAmount(r.money_out) : ''}
              </td>
              {showBalance ? (
                <td className="tabular whitespace-nowrap text-right font-bold">
                  {formatAmount(r.running_balance)}
                </td>
              ) : null}
              <td className="whitespace-nowrap text-on-surface-variant">{r.recorded_by_name ?? 'System'}</td>
              <td>
                <TxnStatusBadge status={r.txn_status} />
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
    </>
  );
}

function classTone(c: AccountMovementRow['movement_class']) {
  switch (c) {
    case 'collection':
    case 'other_receipt':
      return 'success' as const;
    case 'transfer_in':
    case 'transfer_out':
      return 'info' as const;
    case 'reversal':
      return 'warning' as const;
    default:
      return 'error' as const;
  }
}

/** The "View in ledger" affordance used by panels that show a few entries. */
export function LedgerLink({ href, label = 'Open the ledger' }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-1 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
    >
      {label}
      <Icon name="arrow_forward" size={15} />
    </Link>
  );
}
