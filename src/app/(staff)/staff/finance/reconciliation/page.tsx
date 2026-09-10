import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getAccounts } from '@/lib/treasury';
import { Badge, DataTable, PageTitle, Panel } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PanelSkeleton, TableSkeleton } from '@/components/ui/states';
import { DocumentsButton } from '@/components/finance/Documents';
import { ACCOUNT_TYPE_META } from '@/lib/treasury-format';
import { formatDate } from '@/lib/format';
import { formatAmount, formatUGX, toNumber } from '@/lib/money';
import type { ReconciliationRegisterRow } from '@/types/treasury';

export const metadata: Metadata = { title: 'Reconciliation' };

/**
 * Merchant, bank and cash reconciliation: what the system says each account
 * holds against what the provider, the bank statement or the cash count says.
 * A variance is recorded with its reason - never quietly absorbed.
 */
export default async function ReconciliationPage() {
  const user = await requirePermission('finance.view');
  const reconcile = can(user.role, 'finance.reconcile');

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="fact_check"
        title="Reconciliation"
        subtitle="System balance against the actual balance, for every account."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Reconciliation' }]}
        action={
          reconcile ? (
            <Link href="/staff/finance/reconciliation/new" className="inline-flex h-touch-target-min items-center gap-2 rounded-full bg-ink px-5 text-button-text font-semibold text-white shadow-neu-dark hover:bg-ink-soft">
              Reconcile an account
            </Link>
          ) : undefined
        }
      />
      <Suspense fallback={<PanelSkeleton height="h-56" />}>
        <Accounts reconcile={reconcile} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={6} cols={6} />}>
        <History canAttach={can(user.role, 'finance.record')} />
      </Suspense>
    </div>
  );
}

async function Accounts({ reconcile }: { reconcile: boolean }) {
  const accounts = await getAccounts();
  if (!accounts) return <ErrorState title="Unable to load accounts" />;
  const live = accounts.filter((a) => a.status !== 'closed');

  return (
    <Panel title="Where each account stands" icon="balance" padded={false}>
      {live.length === 0 ? (
        <EmptyState compact icon="account_balance" title="No accounts set up" description="Accounts appear here once they are set up." />
      ) : (
        <ul className="grid grid-cols-1 divide-y divide-outline-variant/70 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {live.map((a) => {
            const variance = a.last_variance === null ? null : toNumber(a.last_variance);
            return (
              <li key={a.id} className="flex flex-col gap-2 p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body-md font-semibold text-on-surface">{a.name}</span>
                  <Badge tone="neutral">{ACCOUNT_TYPE_META[a.account_type].short}</Badge>
                </div>
                <dl className="space-y-1 text-body-md">
                  <div className="flex justify-between gap-3">
                    <dt className="text-on-surface-variant">System balance</dt>
                    <dd className="tabular font-semibold">{formatUGX(a.balance)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-on-surface-variant">Last reconciled</dt>
                    <dd>{a.last_reconciled_on ? formatDate(a.last_reconciled_on) : 'Never'}</dd>
                  </div>
                  {variance !== null ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-on-surface-variant">Status</dt>
                      <dd>
                        {variance === 0 ? <Badge tone="success">Reconciled</Badge> : <Badge tone="error">Variance {formatUGX(variance)}</Badge>}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {reconcile ? (
                  <Link href={`/staff/finance/reconciliation/new?account=${a.id}`} className="mt-1 inline-flex h-10 items-center self-start rounded-full bg-surface px-4 text-label-md font-semibold text-primary shadow-neu-sm hover:shadow-card">
                    Reconcile now
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

async function History({ canAttach }: { canAttach: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reconciliation_register')
    .select('*')
    .order('reconciliation_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return <ErrorState title="Unable to load reconciliation history" />;
  const rows = (data ?? []) as ReconciliationRegisterRow[];

  const ids = rows.map((r) => r.id);
  const { data: docs } = ids.length
    ? await supabase.from('finance_documents').select('id, owner_id, file_name, created_at').eq('owner_type', 'reconciliation').in('owner_id', ids)
    : { data: [] as { id: string; owner_id: string; file_name: string; created_at: string }[] };

  return (
    <section>
      <h2 className="mb-3 text-title-md text-on-surface">History</h2>
      {rows.length === 0 ? (
        <div className="rounded-2xl bg-surface shadow-neu">
          <EmptyState icon="fact_check" title="No reconciliations yet"
            description="Each reconciliation is kept here with the system balance, the actual balance and the reason for any variance." />
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl bg-surface p-4 shadow-neu-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body-md font-semibold text-on-surface">{r.account_name}</p>
                    <p className="tabular text-label-md font-normal text-on-surface-variant">{r.reconciliation_no} · {formatDate(r.reconciliation_date)}</p>
                  </div>
                  {r.outcome === 'reconciled' ? <Badge tone="success">Reconciled</Badge> : <Badge tone="error">Variance</Badge>}
                </div>
                <p className="tabular mt-2 text-label-md text-on-surface-variant">
                  System {formatUGX(r.system_balance)} · actual {formatUGX(r.actual_balance)} · variance {formatUGX(r.variance)}
                </p>
                {r.reason ? <p className="mt-1 text-body-md text-on-surface-variant">“{r.reason}”</p> : null}
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <DataTable dense head={<>
              <th>Date</th><th>Number</th><th>Account</th><th className="text-right">System</th><th className="text-right">Actual</th>
              <th className="text-right">Variance</th><th>Status</th><th>Reason</th><th>By</th><th></th>
            </>}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{formatDate(r.reconciliation_date)}</td>
                  <td className="tabular whitespace-nowrap font-mono text-label-md">{r.reconciliation_no}</td>
                  <td className="whitespace-nowrap">{r.account_name}</td>
                  <td className="tabular text-right">{formatAmount(r.system_balance)}</td>
                  <td className="tabular text-right">{formatAmount(r.actual_balance)}</td>
                  <td className={`tabular text-right font-semibold ${toNumber(r.variance) === 0 ? '' : 'text-error'}`}>{formatAmount(r.variance)}</td>
                  <td>{r.outcome === 'reconciled' ? <Badge tone="success">Reconciled</Badge> : <Badge tone="error">Variance</Badge>}</td>
                  <td className="min-w-[180px] text-on-surface-variant">{r.reason ?? '—'}</td>
                  <td className="whitespace-nowrap text-on-surface-variant">{r.reconciled_by_name}</td>
                  <td>
                    <DocumentsButton ownerType="reconciliation" ownerId={r.id}
                      documents={(docs ?? []).filter((d) => d.owner_id === r.id)} canAttach={canAttach} />
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </section>
  );
}
