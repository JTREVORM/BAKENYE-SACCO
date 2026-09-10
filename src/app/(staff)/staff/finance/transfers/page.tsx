import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission, type SessionUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/treasury';
import { Icon, PageTitle } from '@/components/ui/primitives';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { ApprovalControls } from '@/components/finance/ApprovalControls';
import { DocStatusBadge } from '@/components/finance/DocStatusBadge';
import { DocumentsButton } from '@/components/finance/Documents';
import { Pager } from '@/components/finance/Pager';
import { FilterChips, SearchBox } from '@/components/finance/SearchBox';
import { ExportButtons } from '@/components/ExportButtons';
import { ActionLink } from '@/components/finance/ActionLink';
import { TRANSFER_KIND_META, TRANSFER_KINDS, isTransferKind } from '@/lib/treasury-format';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import type { TransferRegisterRow } from '@/types/treasury';

export const metadata: Metadata = { title: 'Transfers' };

const PAGE_SIZE = 20;
type SP = { status?: string; kind?: string; from?: string; to?: string; q?: string; page?: string };

/**
 * Internal transfers: merchant to bank, cash to bank, bank to cash, bank to
 * bank. Each is one linked ledger row once completed; before that it is a
 * request with a status, and a manager decides it here.
 */
export default async function TransfersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission('finance.view');
  const sp = await searchParams;
  const record = can(user.role, 'finance.record');

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="swap_horiz"
        title="Transfers"
        subtitle="Money moving between the SACCO's own accounts. Not income, not expense - total funds stay the same."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Transfers' }]}
        action={
          record ? (
            <>
              <ActionLink href="/staff/finance/new/transfer?kind=merchant_to_bank" icon="swap_horiz" label="Merchant to bank" primary />
              <ActionLink href="/staff/finance/new/transfer?kind=cash_to_bank" icon="local_atm" label="Deposit cash" />
              <ActionLink href="/staff/finance/new/transfer?kind=bank_to_cash" icon="account_balance" label="Withdraw" />
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3">
        <FilterChips
          param="status"
          options={[
            { value: '', label: 'All' },
            { value: 'open', label: 'Open (draft or waiting)' },
            { value: 'submitted', label: 'Awaiting approval' },
            { value: 'completed', label: 'Completed' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'reversed', label: 'Reversed' },
          ]}
        />
        <FilterChips
          param="kind"
          options={[{ value: '', label: 'Every kind' }, ...TRANSFER_KINDS.map((k) => ({ value: k, label: TRANSFER_KIND_META[k].label }))]}
        />
      </div>

      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={6} />}>
        <Rows sp={sp} user={user} />
      </Suspense>
    </div>
  );
}

async function Rows({ sp, user }: { sp: SP; user: SessionUser }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let q = supabase
    .from('transfer_register')
    .select('*', { count: 'exact' })
    .order('transfer_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (sp.status === 'open') q = q.in('status', ['draft', 'submitted']);
  else if (sp.status && ['submitted', 'draft', 'completed', 'rejected', 'cancelled', 'reversed'].includes(sp.status)) {
    q = q.eq('status', sp.status as TransferRegisterRow['status']);
  }
  if (isTransferKind(sp.kind)) q = q.eq('kind', sp.kind);
  if (isIsoDate(sp.from)) q = q.gte('transfer_date', sp.from);
  if (isIsoDate(sp.to)) q = q.lte('transfer_date', sp.to);
  if (sp.q?.trim()) {
    const term = `%${sp.q.trim().replace(/[,()*%]/g, ' ').trim()}%`;
    q = q.or(`transfer_no.ilike.${term},source_reference.ilike.${term},destination_reference.ilike.${term},description.ilike.${term}`);
  }

  const { data, count, error } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) return <ErrorState title="Unable to load transfers" />;
  const rows = (data ?? []) as TransferRegisterRow[];

  const ids = rows.map((r) => r.id);
  const { data: docs } = ids.length
    ? await supabase.from('finance_documents').select('id, owner_id, file_name, created_at').eq('owner_type', 'transfer').in('owner_id', ids)
    : { data: [] as { id: string; owner_id: string; file_name: string; created_at: string }[] };

  const canApprove = can(user.role, 'finance.approve');

  const csv: (string | number)[][] = [
    ['Transfer no', 'Date', 'Kind', 'From', 'To', 'Amount', 'Source ref', 'Destination ref', 'Handled by', 'Status', 'Recorded by', 'Approved by'],
    ...rows.map((r) => [r.transfer_no, r.transfer_date, TRANSFER_KIND_META[r.kind].label, r.source_account_name, r.destination_account_name,
      toNumber(r.amount), r.source_reference ?? '', r.destination_reference ?? '', r.handled_by ?? '', r.status,
      r.created_by_name ?? '', r.approved_by_name ?? '']),
  ];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search transfer no, slip or reference…" />
        <ExportButtons rows={csv} filename="BUD-SACCO-transfers" showPrint={false} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-surface shadow-neu">
          <EmptyState
            icon="swap_horiz"
            title={Object.values(sp).some(Boolean) ? 'No transfers match these filters' : 'No transfers yet'}
            description="Merchant-to-bank transfers, cash deposits and bank withdrawals will appear here once recorded."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const meta = TRANSFER_KIND_META[r.kind];
            const mine = r.created_by === user.id;
            return (
              <li key={r.id} className="rounded-2xl bg-surface p-4 shadow-neu-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon name={meta.icon} size={18} className="text-primary" />
                      <span className="text-body-md font-semibold text-on-surface">{meta.label}</span>
                      <DocStatusBadge status={r.status} />
                    </div>
                    <p className="tabular text-label-md font-normal text-on-surface-variant">
                      {r.transfer_no} · {formatDate(r.transfer_date)}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-body-md text-on-surface">
                      <span className="font-semibold">{r.source_account_name}</span>
                      <Icon name="arrow_forward" size={16} className="text-on-surface-variant" />
                      <span className="font-semibold">{r.destination_account_name}</span>
                    </p>
                    <p className="text-label-md font-normal text-on-surface-variant">
                      {[r.source_reference && `Source ref ${r.source_reference}`, r.destination_reference && `Destination ref ${r.destination_reference}`, r.handled_by && `Handled by ${r.handled_by}`]
                        .filter(Boolean)
                        .join(' · ') || 'No references recorded'}
                    </p>
                    {r.purpose ? <p className="text-label-md font-normal text-on-surface-variant">Purpose: {r.purpose}</p> : null}
                    <p className="mt-1 text-label-md font-normal text-on-surface-variant">
                      Recorded by {r.created_by_name ?? 'staff'} · {formatDateTime(r.created_at)}
                      {r.approved_by_name ? ` · approved by ${r.approved_by_name}` : ''}
                      {r.rejected_by_name ? ` · rejected by ${r.rejected_by_name}: “${r.rejection_reason}”` : ''}
                      {r.status === 'reversed' && r.reversal_reason ? ` · reversed: “${r.reversal_reason}”` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-button-text font-bold text-on-surface">{formatUGX(r.amount)}</p>
                    {r.transaction_id ? (
                      <Link href={`/staff/transactions/${r.transaction_id}`} className="text-label-md font-semibold text-primary hover:underline">
                        View entry
                      </Link>
                    ) : (
                      <p className="text-label-md font-normal text-on-surface-variant">No money moved yet</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/70 pt-3">
                  <ApprovalControls
                    kind="transfer"
                    id={r.id}
                    number={r.transfer_no}
                    amount={toNumber(r.amount)}
                    status={r.status}
                    canApprove={canApprove}
                    canCancel={mine || canApprove}
                    canSubmit={mine || canApprove}
                  />
                  <DocumentsButton ownerType="transfer" ownerId={r.id}
                    documents={(docs ?? []).filter((d) => d.owner_id === r.id)} canAttach={can(user.role, 'finance.record')} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={page} total={count ?? 0} pageSize={PAGE_SIZE} />
    </section>
  );
}
