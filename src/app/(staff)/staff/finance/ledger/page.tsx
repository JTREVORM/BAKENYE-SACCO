import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getAccounts, getStaffUsers, isIsoDate, LEDGER_PAGE_SIZE, queryLedger } from '@/lib/treasury';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { LedgerFilters } from '@/components/finance/LedgerFilters';
import { LedgerTable } from '@/components/finance/LedgerTable';
import { Pager } from '@/components/finance/Pager';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { MOVEMENT_LABELS } from '@/lib/treasury-format';
import { formatDate, TXN_LABELS } from '@/lib/format';
import { toNumber } from '@/lib/money';

export const metadata: Metadata = { title: 'Transaction Ledger' };

type SP = { account?: string; kind?: string; user?: string; member?: string; q?: string; from?: string; to?: string; page?: string };

/**
 * The unified transaction ledger: every entry on every SACCO account, with
 * the account's running balance, filterable by account, date, type, the
 * person who recorded it, member and reference.
 */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission('finance.view');
  const sp = await searchParams;

  return (
    <div>
      <PageTitle
        icon="list_alt"
        title="Transaction Ledger"
        subtitle="Every entry on Cash at Merchant, Cash at Bank and Cash at Hand, with the running balance."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Ledger' }]}
      />
      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={10} cols={7} />}>
        <Body sp={sp} generatedBy={user.fullName} />
      </Suspense>
    </div>
  );
}

async function Body({ sp, generatedBy }: { sp: SP; generatedBy: string }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const [accounts, users] = await Promise.all([getAccounts(), getStaffUsers()]);
  let result;
  try {
    result = await queryLedger({
      account: sp.account,
      kind: sp.kind,
      user: sp.user,
      member: sp.member,
      q: sp.q,
      from: isIsoDate(sp.from) ? sp.from : undefined,
      to: isIsoDate(sp.to) ? sp.to : undefined,
      page,
    });
  } catch {
    return <ErrorState title="Unable to load the ledger" description="Please check your connection and try again." />;
  }

  const csv: (string | number)[][] = [
    ['Date', 'Reference', 'Provider/bank ref', 'Account', 'Type', 'Movement', 'Member', 'Description', 'Money in', 'Money out', 'Balance', 'Recorded by', 'Status'],
    ...result.rows.map((r) => [
      r.entry_date,
      r.reference,
      r.external_ref ?? '',
      r.account_name,
      TXN_LABELS[r.txn_type],
      MOVEMENT_LABELS[r.movement_class],
      r.member_name ? `${r.member_name} (${r.member_no})` : '',
      r.description ?? '',
      toNumber(r.money_in),
      toNumber(r.money_out),
      toNumber(r.running_balance),
      r.recorded_by_name ?? '',
      r.txn_status,
    ]),
  ];

  const accountName = sp.account ? accounts?.find((a) => a.id === sp.account)?.name : undefined;

  return (
    <>
      <PrintLetterhead
        title="Transaction Ledger"
        subtitle={accountName ?? 'All accounts'}
        meta={[
          ...(sp.from || sp.to ? [{ label: 'Period', value: `${formatDate(sp.from ?? null, 'start')} – ${formatDate(sp.to ?? null, 'today')}` }] : []),
          { label: 'Entries', value: `${result.total}` },
        ]}
        generatedBy={generatedBy}
      />
      <LedgerFilters accounts={(accounts ?? []).map((a) => ({ id: a.id, name: a.name }))} users={users} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-label-md font-normal text-on-surface-variant">
          {result.total.toLocaleString()} {result.total === 1 ? 'entry' : 'entries'}
          {accountName ? ` on ${accountName}` : ''}
        </p>
        <ExportButtons rows={csv} filename="BUD-SACCO-ledger" documentTitle="BUD-SACCO Transaction Ledger" />
      </div>
      <LedgerTable
        rows={result.rows}
        emptyTitle={Object.values(sp).some(Boolean) ? 'No entries match these filters' : 'No transactions yet'}
        emptyBody={
          Object.values(sp).some(Boolean)
            ? 'Try a wider period or clear the filters.'
            : 'Collections, transfers and payments will appear here once they are recorded.'
        }
      />
      <Pager page={page} total={result.total} pageSize={LEDGER_PAGE_SIZE} />
      <PrintFooter note="Every figure on this document is read from the SACCO account ledger at the time of printing." />
    </>
  );
}
