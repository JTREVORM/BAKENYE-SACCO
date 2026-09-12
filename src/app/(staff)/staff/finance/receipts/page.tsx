import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can, canAny } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getReceiptsAndPayments, isIsoDate } from '@/lib/treasury';
import { DataTable, PageTitle, Panel } from '@/components/ui/primitives';
import { ActionLink } from '@/components/finance/ActionLink';
import { TxnStatusBadge } from '@/components/ui/status';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { PeriodPicker } from '@/components/finance/PeriodPicker';
import { Pager } from '@/components/finance/Pager';
import { SearchBox } from '@/components/finance/SearchBox';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintLetterhead } from '@/components/print/PrintLetterhead';
import { formatDate, monthStart, toISODate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatAmount, formatUGX, toNumber } from '@/lib/money';
import type { ReceiptRegisterRow } from '@/types/treasury';

export const metadata: Metadata = { title: 'Receipts' };

const PAGE_SIZE = 25;
type SP = { from?: string; to?: string; q?: string; page?: string };

/**
 * Every sum of money received, with its RCT receipt number: member
 * savings, shares, repayments, fees and other income, and the account it
 * landed in. Receipts are issued by the database the moment money is posted.
 */
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission('finance.view');
  const sp = await searchParams;
  const from = isIsoDate(sp.from) ? sp.from : monthStart();
  const to = isIsoDate(sp.to) ? sp.to : toISODate();

  const collect = canAny(user, 'finance.record', 'savings.record');
  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="receipt_long"
        title="Receipts"
        subtitle="Money received by the SACCO, with the receipt number and the account it went into."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Receipts' }]}
        action={
          <>
            {collect ? <ActionLink href="/staff/finance/new/collection" icon="add" label="Record collection" primary /> : null}
            {collect ? <ActionLink href="/staff/finance/new/collection?preset=merchant" icon="smartphone" label="Merchant collection" /> : null}
            {can(user, 'finance.record') ? <ActionLink href="/staff/finance/new/receipt" icon="call_received" label="Other receipt" /> : null}
          </>
        }
      />
      <PeriodPicker from={from} to={to} />
      <Suspense key={`${from}-${to}`} fallback={<TableSkeleton rows={4} cols={3} />}>
        <Totals from={from} to={to} />
      </Suspense>
      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={7} />}>
        <Register sp={sp} from={from} to={to} generatedBy={user.fullName} />
      </Suspense>
    </div>
  );
}

async function Totals({ from, to }: { from: string; to: string }) {
  const rp = await getReceiptsAndPayments(from, to);
  if (!rp) return <ErrorState title="Unable to load the receipt totals" />;
  const total = rp.receipts.reduce((s, r) => s + toNumber(r.total), 0);

  return (
    <Panel title="Received in this period" subtitle={`${formatDate(from)} – ${formatDate(to)}`} icon="call_received"
      action={<span className="tabular text-button-text font-bold text-tertiary">{formatUGX(total)}</span>} padded={false}>
      {rp.receipts.length === 0 ? (
        <EmptyState compact icon="receipt_long" title="Nothing received in this period"
          description="Member collections and other receipts will be totalled here by category." />
      ) : (
        <ul className="grid grid-cols-1 divide-y divide-outline-variant/70 sm:grid-cols-2 sm:divide-y-0">
          {rp.receipts.map((r) => (
            <li key={r.category} className="flex items-baseline justify-between gap-3 px-5 py-3">
              <span className="text-body-md text-on-surface">
                {r.category}
                <span className="ml-1.5 text-label-md font-normal text-on-surface-variant">· {r.entries}</span>
              </span>
              <span className="tabular text-body-md font-semibold text-on-surface">{formatUGX(r.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

async function Register({ sp, from, to, generatedBy }: { sp: SP; from: string; to: string; generatedBy: string }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase
    .from('receipt_register')
    .select('*', { count: 'exact' })
    .gte('receipt_date', from)
    .lte('receipt_date', to)
    .order('receipt_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (sp.q?.trim()) {
    const term = `%${sp.q.trim().replace(/[,()*%]/g, ' ').trim()}%`;
    q = q.or(`receipt_no.ilike.${term},reference.ilike.${term},reference_no.ilike.${term},payer.ilike.${term},member_no.ilike.${term}`);
  }
  const { data, count, error } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) return <ErrorState title="Unable to load receipts" />;
  const rows = (data ?? []) as ReceiptRegisterRow[];

  const csv: (string | number)[][] = [
    ['Receipt no', 'Date', 'Payer', 'Member no', 'Category', 'Received into', 'Method', 'Reference', 'Amount', 'Recorded by', 'Status'],
    ...rows.map((r) => [r.receipt_no, r.receipt_date, r.payer ?? '', r.member_no ?? '', r.category, r.receiving_account_name ?? '',
      PAYMENT_METHOD_LABELS[r.method], r.reference_no ?? '', toNumber(r.amount), r.recorded_by_name ?? '', r.status]),
  ];

  return (
    <section>
      <PrintLetterhead title="Receipts Register" meta={[{ label: 'Period', value: `${formatDate(from)} – ${formatDate(to)}` }]} generatedBy={generatedBy} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search receipt no, reference, payer or member no…" />
        <ExportButtons rows={csv} filename="BUD-SACCO-receipts" documentTitle="BUD-SACCO Receipts Register" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-surface shadow-neu">
          <EmptyState icon="receipt_long" title={sp.q ? 'No receipts match your search' : 'No receipts in this period'}
            description="Every collection and other receipt gets an RCT receipt number the moment it is recorded." />
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5 md:hidden print:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/staff/transactions/${r.transaction_id}`} className="block rounded-2xl bg-surface p-4 shadow-neu-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-body-md font-semibold text-on-surface">{r.payer ?? 'Payer not recorded'}</p>
                      <p className="tabular truncate text-label-md font-normal text-on-surface-variant">{r.receipt_no} · {formatDate(r.receipt_date)}</p>
                      <p className="truncate text-label-md font-normal text-on-surface-variant">{r.category} · into {r.receiving_account_name}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-body-md font-bold text-tertiary">{formatUGX(r.amount)}</p>
                      {r.status !== 'posted' ? <TxnStatusBadge status={r.status} /> : null}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block print:block">
            <DataTable dense head={<>
              <th>Receipt no</th><th>Date</th><th>Payer</th><th>Category</th><th>Received into</th>
              <th>Method</th><th>Reference</th><th className="text-right">Amount</th><th>Recorded by</th><th>Status</th>
            </>}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/staff/transactions/${r.transaction_id}`} className="tabular font-mono text-label-md font-semibold text-primary hover:underline">
                      {r.receipt_no}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-on-surface-variant">{formatDate(r.receipt_date)}</td>
                  <td className="min-w-[160px]">
                    <span className="block font-semibold">{r.payer ?? '—'}</span>
                    {r.member_no ? <span className="tabular block text-label-md font-normal text-on-surface-variant">{r.member_no}</span> : null}
                  </td>
                  <td>{r.category}</td>
                  <td className="whitespace-nowrap">{r.receiving_account_name}</td>
                  <td className="whitespace-nowrap">{PAYMENT_METHOD_LABELS[r.method]}</td>
                  <td className="tabular whitespace-nowrap text-label-md">{r.reference_no ?? '—'}</td>
                  <td className="tabular whitespace-nowrap text-right font-semibold">{formatAmount(r.amount)}</td>
                  <td className="whitespace-nowrap text-on-surface-variant">{r.recorded_by_name ?? 'System'}</td>
                  <td><TxnStatusBadge status={r.status} /></td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
      <Pager page={page} total={count ?? 0} pageSize={PAGE_SIZE} />
    </section>
  );
}
