import Link from 'next/link';
import { Badge, DataTable, Icon, Panel, ViewAllLink, type BadgeTone } from '@/components/ui/primitives';
import { TxnStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { queryTransactions } from '@/lib/txn-query';
import { formatDate, formatTime, TXN_LABELS } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { TransactionFeedRow, TxnType } from '@/types/db';

/**
 * The SACCO's latest movements, as the dashboard shows them.
 *
 * Straight from `transaction_feed` through the same `queryTransactions()` the
 * transactions register uses, so the dashboard and the register can never
 * disagree about what happened. RLS scopes the rows; staff see the SACCO's,
 * and nothing here widens that.
 *
 * The table is swapped for a card list by *container* width rather than by
 * viewport width. This panel is two-thirds of a dashboard grid on one screen
 * and the full width of a phone on another, so the viewport says very little
 * about how much room the columns actually have — at 1280px, with the rail out
 * and the grid in three columns, there is less room for it than at 1100px. The
 * container query asks the only question that matters: does the table fit here?
 */

/** The short form of a type, for a column that has to stay narrow. */
const SHORT_TYPE: Record<TxnType, string> = {
  share_purchase: 'Share',
  weekly_savings: 'Saving',
  monthly_savings: 'Saving',
  loan_disbursement: 'Loan',
  loan_repayment: 'Repayment',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  income: 'Income',
  expense: 'Expense',
  fee: 'Fee',
  penalty: 'Penalty',
  transfer: 'Transfer',
  payment: 'Payment',
};

/** Money in is green, money out is red, and the SACCO's equity is gold. */
const TYPE_TONE: Record<TxnType, BadgeTone> = {
  share_purchase: 'accent',
  weekly_savings: 'success',
  monthly_savings: 'success',
  loan_disbursement: 'info',
  loan_repayment: 'info',
  deposit: 'success',
  withdrawal: 'warning',
  income: 'success',
  expense: 'error',
  fee: 'neutral',
  penalty: 'warning',
  transfer: 'neutral',
  payment: 'warning',
};

export async function RecentTransactions({ limit = 6 }: { limit?: number }) {
  const { rows } = await queryTransactions({ page: 1, pageSize: limit });
  return <TransactionsPanel rows={rows} />;
}

/**
 * The panel itself, given rows.
 *
 * Split from the read above so the design harness at `/dev/preview` can render
 * the real markup against fixtures, without a database and without a second
 * copy of the table to drift from this one.
 */
export function TransactionsPanel({ rows }: { rows: TransactionFeedRow[] }) {
  return (
    <Panel
      title="Recent Transactions"
      icon="description"
      action={<ViewAllLink href="/staff/transactions" />}
      padded={false}
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon="receipt_long"
          title="Nothing recorded yet"
          description="Savings, repayments, share purchases and payments appear here as they are recorded."
        />
      ) : (
        <div className="@container">
          {/* Narrow: one card per movement. A six-column table at 360px is not
              a table, it is a word search. */}
          <ul className="divide-outline-variant divide-y @[45rem]:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/staff/transactions/${r.id}`}
                  className="hover:bg-surface-container-low flex items-start gap-3 px-4 py-3.5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TYPE_TONE[r.type]}>{SHORT_TYPE[r.type]}</Badge>
                      <span className="tabular text-label-md text-on-surface-variant">
                        {r.member_no ?? r.reference}
                      </span>
                    </div>
                    <p className="text-body-md text-on-surface mt-1.5 font-medium">
                      {r.description ?? TXN_LABELS[r.type]}
                    </p>
                    <p className="text-label-md text-on-surface-variant mt-0.5">
                      {formatDate(r.occurred_on)} · {formatTime(r.created_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-body-md text-on-surface font-bold">
                      {formatUGX(r.amount)}
                    </p>
                    <p className="mt-1.5">
                      <TxnStatusBadge status={r.status} />
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden @[45rem]:block">
            <DataTable
              dense
              className="rounded-none border-0 shadow-none"
              head={
                <>
                  <th>Date &amp; Time</th>
                  <th>Type</th>
                  <th>Member / Reference</th>
                  {/* The description is the first column to go when the panel
                      is narrow: it is the one thing on the row that the
                      transaction itself repeats in full. */}
                  <th className="hidden @[64rem]:table-cell">Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th className="w-10">
                    <span className="sr-only">Open</span>
                  </th>
                </>
              }
            >
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-on-surface-variant whitespace-nowrap">
                    <span className="block font-medium">{formatDate(r.occurred_on)}</span>
                    <span className="text-label-md block">{formatTime(r.created_at)}</span>
                  </td>
                  <td>
                    <Badge tone={TYPE_TONE[r.type]}>{SHORT_TYPE[r.type]}</Badge>
                  </td>
                  <td className="tabular whitespace-nowrap font-medium">
                    {r.member_no ?? r.reference}
                  </td>
                  <td className="text-on-surface-variant hidden max-w-[26ch] @5xl:table-cell">
                    {r.description ?? TXN_LABELS[r.type]}
                  </td>
                  <td className="tabular whitespace-nowrap font-bold">{formatUGX(r.amount)}</td>
                  <td>
                    <TxnStatusBadge status={r.status} />
                  </td>
                  <td>
                    <Link
                      href={`/staff/transactions/${r.id}`}
                      aria-label={`Open transaction ${r.reference}`}
                      className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                    >
                      <Icon name="more_horiz" size={18} />
                    </Link>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </div>
      )}
    </Panel>
  );
}
