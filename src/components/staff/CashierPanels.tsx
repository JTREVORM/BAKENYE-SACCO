import Link from 'next/link';
import { KpiCard, Money, Panel } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { formatAgo } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { DashboardMetrics } from '@/types/db';
import type { ReceiptRegisterRow } from '@/types/treasury';

export type CashierReceipt = Pick<ReceiptRegisterRow, 'id' | 'receipt_no' | 'transaction_id' | 'amount' | 'payer' | 'category' | 'receiving_account_name' | 'created_at' | 'status'>;

/** Presentation only; the cashier route retains its reads, totals and access checks. */
export function CashierFigures({ m }: { m: Pick<DashboardMetrics, 'todays_collections' | 'savings_this_month' | 'savers_this_month' | 'total_members'> }) {
  return (
    <section aria-label="Today" className="grid grid-cols-2 gap-gutter lg:grid-cols-4">
      <KpiCard icon="payments" label="Collected today" value={formatUGX(m.todays_collections)} tone="success" />
      <KpiCard
        icon="savings"
        label="Saved this month"
        value={formatUGX(m.savings_this_month)}
        tone={Number(m.savings_this_month) > 0 ? 'primary' : 'neutral'}
        href="/staff/savings/records"
      />
      <KpiCard
        icon="group_add"
        label="Members who saved"
        value={m.savers_this_month}
        tone="neutral"
        href="/staff/savings/performance"
      />
      <KpiCard icon="group" label="Active members" value={m.total_members} href="/staff/members" />
    </section>
  );
}

export function CashierReceiptsPanel({ rows, total }: { rows: CashierReceipt[]; total: number }) {
  return (
    <Panel
      title="Receipts you issued today"
      icon="receipt_long"
      padded={false}
      action={
        rows.length ? (
          <span className="text-label-md text-on-surface-variant font-semibold">{formatUGX(total)}</span>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact icon="receipt_long" title="No receipts yet today" description="Everything you receive today is listed here, with its receipt." />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/staff/transactions/${r.transaction_id}`} className="hover:bg-surface-container-low flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-body-md text-on-surface truncate font-semibold">{r.payer ?? '—'}</p>
                  <p className="text-label-md text-on-surface-variant font-normal">
                    <span className="font-mono">{r.receipt_no}</span> · {r.category} · {r.receiving_account_name ?? '—'} · {formatAgo(r.created_at)}
                  </p>
                </div>
                <Money value={r.amount} className="text-body-md text-on-surface shrink-0 font-semibold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
