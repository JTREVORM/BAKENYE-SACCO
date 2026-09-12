import { Suspense } from 'react';
import Link from 'next/link';
import type { SessionUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/treasury';
import { Badge } from '@/components/ui/primitives';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { ApprovalControls } from './ApprovalControls';
import { DocStatusBadge } from './DocStatusBadge';
import { DocumentsButton } from './Documents';
import { Pager } from './Pager';
import { FilterChips, SearchBox } from './SearchBox';
import { ExportButtons } from '@/components/ExportButtons';
import { formatDate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import type { FinanceDocumentRow, PaymentRegisterRow } from '@/types/treasury';

const PAGE_SIZE = 20;

export type PaymentRegisterParams = {
  status?: string;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
};

/**
 * Payments and expenses side by side, each with its own document number, the
 * account it left and who approved it. Waiting entries are decided in place.
 */
export function PaymentRegister({
  sp,
  user,
  onlyExpenses = false,
}: {
  sp: PaymentRegisterParams;
  user: SessionUser;
  onlyExpenses?: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <FilterChips
          param="status"
          options={[
            { value: '', label: 'All' },
            { value: 'submitted', label: 'Awaiting approval' },
            { value: 'draft', label: 'Drafts' },
            { value: 'completed', label: 'Completed' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'reversed', label: 'Reversed' },
          ]}
        />
        {onlyExpenses ? null : (
          <FilterChips
            param="source"
            options={[
              { value: '', label: 'Payments and expenses' },
              { value: 'payment', label: 'Payments only' },
              { value: 'expense', label: 'Expenses only' },
            ]}
          />
        )}
      </div>
      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={6} />}>
        <Rows sp={sp} user={user} onlyExpenses={onlyExpenses} />
      </Suspense>
    </>
  );
}

async function Rows({
  sp,
  user,
  onlyExpenses,
}: {
  sp: PaymentRegisterParams;
  user: SessionUser;
  onlyExpenses: boolean;
}) {
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let q = supabase
    .from('payment_register')
    .select('*', { count: 'exact' })
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });

  const source = onlyExpenses ? 'expense' : sp.source;
  if (source === 'payment' || source === 'expense') q = q.eq('source', source);
  if (sp.status && ['submitted', 'draft', 'completed', 'rejected', 'cancelled', 'reversed'].includes(sp.status)) {
    q = q.eq('status', sp.status as PaymentRegisterRow['status']);
  }
  if (isIsoDate(sp.from)) q = q.gte('payment_date', sp.from);
  if (isIsoDate(sp.to)) q = q.lte('payment_date', sp.to);
  if (sp.q?.trim()) {
    const term = `%${sp.q.trim().replace(/[,()*%]/g, ' ').trim()}%`;
    q = q.or(`payment_no.ilike.${term},payee.ilike.${term},reference.ilike.${term},description.ilike.${term},category.ilike.${term}`);
  }

  const { data, count, error } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) return <ErrorState title="Unable to load payments" />;
  const rows = (data ?? []) as PaymentRegisterRow[];

  const ids = rows.map((r) => r.id);
  const { data: docs } = ids.length
    ? await supabase.from('finance_documents').select('id, owner_id, file_name, created_at').in('owner_id', ids)
    : { data: [] as Pick<FinanceDocumentRow, 'id' | 'owner_id' | 'file_name' | 'created_at'>[] };

  const canApprove = can(user, 'finance.approve');
  const canRecord = can(user, 'finance.record');

  const csv: (string | number)[][] = [
    ['Payment no', 'Date', 'Kind', 'Payee', 'Category', 'Paid from', 'Method', 'Reference', 'Amount', 'Status', 'Recorded by', 'Approved by'],
    ...rows.map((r) => [
      r.payment_no ?? '', r.payment_date, r.is_expense ? 'Expense' : 'Payment', r.payee ?? '', r.category,
      r.payment_account_name ?? '', PAYMENT_METHOD_LABELS[r.method], r.reference ?? '', toNumber(r.amount), r.status,
      r.created_by_name ?? '', r.approved_by_name ?? '',
    ]),
  ];

  const filtered = Object.entries(sp).some(([k, v]) => k !== 'from' && k !== 'to' && !!v);

  return (
    <section className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search payment no, payee, reference or category…" />
        <ExportButtons rows={csv} filename={onlyExpenses ? 'BUD-SACCO-expenses' : 'BUD-SACCO-payments'} showPrint={false} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-surface shadow-neu">
          <EmptyState
            icon={onlyExpenses ? 'trending_down' : 'request_quote'}
            title={filtered ? 'Nothing matches these filters' : onlyExpenses ? 'No expenses yet' : 'No payments yet'}
            description={
              onlyExpenses
                ? 'Expenses appear here once submitted. Money leaves an account only after approval.'
                : 'Payments and approved expenses appear here with the account they were paid from.'
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const mine = r.created_by === user.id;
            const rowDocs = (docs ?? []).filter((d) => d.owner_id === r.id);
            return (
              <li key={`${r.source}-${r.id}`} className="rounded-2xl bg-surface p-4 shadow-neu-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body-md font-semibold text-on-surface">{r.payee ?? r.category}</span>
                      <Badge tone={r.is_expense ? 'error' : 'accent'}>{r.is_expense ? 'Expense' : 'Payment'}</Badge>
                      <DocStatusBadge status={r.status} />
                    </div>
                    <p className="tabular text-label-md font-normal text-on-surface-variant">
                      {r.payment_no ?? '—'} · {formatDate(r.payment_date)} · {r.category}
                    </p>
                    <p className="text-label-md font-normal text-on-surface-variant">
                      {r.payment_account_name ? `From ${r.payment_account_name}` : 'No account named'} · {PAYMENT_METHOD_LABELS[r.method]}
                      {r.reference ? ` · ref ${r.reference}` : ''}
                    </p>
                    {r.description ? <p className="mt-1 text-body-md text-on-surface-variant">{r.description}</p> : null}
                    <p className="mt-1 text-label-md font-normal text-on-surface-variant">
                      Recorded by {r.created_by_name ?? 'staff'}
                      {r.approved_by_name ? ` · ${r.status === 'rejected' ? 'rejected' : 'approved'} by ${r.approved_by_name}` : ''}
                      {r.rejection_reason ? ` · “${r.rejection_reason}”` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-button-text font-bold text-on-surface">{formatUGX(r.amount)}</p>
                    {r.transaction_id ? (
                      <Link href={`/staff/transactions/${r.transaction_id}`} className="tabular text-label-md font-semibold text-primary hover:underline">
                        {r.transaction_reference}
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/70 pt-3">
                  <ApprovalControls
                    kind={r.source}
                    id={r.id}
                    number={r.payment_no ?? ''}
                    amount={toNumber(r.amount)}
                    status={r.status}
                    canApprove={canApprove}
                    canCancel={r.source === 'payment' && (mine || canApprove)}
                    canSubmit={r.source === 'payment' && (mine || canApprove)}
                  />
                  <DocumentsButton ownerType={r.source} ownerId={r.id} documents={rowDocs} canAttach={canRecord} />
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
