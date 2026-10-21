import Link from 'next/link';
import { KpiCard, Money, Panel } from '@/components/ui/primitives';
import { LoanStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { LoanBalanceRow, LoanStatus } from '@/types/db';

export type Pipeline = {
  id: string;
  loan_no: string;
  principal: number;
  status: LoanStatus;
  applied_on: string;
  member: { full_name: string; member_no: string } | null;
};

/** Presentation only; the loans route retains portfolio arithmetic and access checks. */
export function LoanPortfolioFigures({ pending, live, outstanding, overdue, overdueSum }: { pending: { count: number | null }; live: LoanBalanceRow[]; outstanding: number; overdue: LoanBalanceRow[]; overdueSum: number }) {
  return (
    <section aria-label="Portfolio" className="grid grid-cols-2 gap-gutter lg:grid-cols-4">
      <KpiCard icon="pending_actions" label="Awaiting assessment" value={pending.count ?? 0} tone={(pending.count ?? 0) > 0 ? 'warning' : 'neutral'} />
      <KpiCard icon="payments" label="Active loans" value={live.length} tone="primary" href="/staff/loans" />
      <KpiCard icon="account_balance" label="Outstanding" value={formatUGX(outstanding)} tone="accent" />
      <KpiCard
        icon="warning"
        label="In arrears"
        value={formatUGX(overdueSum)}
        tone={overdue.length > 0 ? 'danger' : 'neutral'}
        footnote={`${overdue.length} ${overdue.length === 1 ? 'loan' : 'loans'}`}
      />
    </section>
  );
}

export function LoanPipelinePanel({ rows }: { rows: Pipeline[] }) {
  return (
    <Panel title="Waiting on the loans desk" icon="pending_actions" padded={false}>
      {rows.length === 0 ? (
        <EmptyState compact icon="task_alt" title="Nothing waiting" description="New applications, and approved loans still to pay out, appear here." />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {rows.map((l) => (
            <li key={l.id}>
              <Link href={`/staff/loans/${l.id}`} className="hover:bg-surface-container-low flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-body-md text-on-surface truncate font-semibold">{l.member?.full_name ?? '—'}</p>
                  <p className="text-label-md text-on-surface-variant font-normal">
                    <span className="font-mono">{l.loan_no}</span> · applied {formatDate(l.applied_on)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Money value={l.principal} className="text-body-md text-on-surface font-semibold" />
                  <LoanStatusBadge status={l.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function LoanArrearsPanel({ rows, names }: { rows: LoanBalanceRow[]; names: Map<string, { full_name: string; member_no: string }> }) {
  return (
    <Panel title="In arrears" icon="warning" padded={false}>
      {rows.length === 0 ? (
        <EmptyState compact icon="verified" title="No loans in arrears" description="Every repayment due so far has been made." />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {rows.map((l) => (
            <li key={l.loan_id}>
              <Link href={`/staff/loans/${l.loan_id}`} className="hover:bg-surface-container-low flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-body-md text-on-surface truncate font-semibold">{names.get(l.member_id)?.full_name ?? '—'}</p>
                  <p className="text-label-md text-on-surface-variant font-normal">
                    <span className="font-mono">{l.loan_no}</span> · {l.days_overdue ?? 0} days overdue
                  </p>
                </div>
                <Money value={l.overdue_amount} className="text-body-md text-error shrink-0 font-semibold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function LoansDuePanel({ rows, names }: { rows: LoanBalanceRow[]; names: Map<string, { full_name: string; member_no: string }> }) {
  return (
    <Panel title="Due in the next 7 days" icon="event" padded={false}>
      {rows.length === 0 ? (
        <EmptyState compact icon="event_available" title="Nothing due this week" />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {rows.map((l) => (
            <li key={l.loan_id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-body-md text-on-surface truncate font-semibold">{names.get(l.member_id)?.full_name ?? '—'}</p>
                <p className="text-label-md text-on-surface-variant font-normal">{formatDate(l.next_due_on)}</p>
              </div>
              <Money value={l.next_due_amount ?? 0} className="text-body-md text-on-surface shrink-0 font-semibold" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
