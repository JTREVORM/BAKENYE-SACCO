import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/treasury';
import { PageTitle, Panel } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PanelSkeleton } from '@/components/ui/states';
import { PeriodPicker } from '@/components/finance/PeriodPicker';
import { ActionLink } from '@/components/finance/ActionLink';
import { PaymentRegister } from '@/components/finance/PaymentRegister';
import { formatDate, monthStart, toISODate } from '@/lib/format';
import { formatUGX, percent, toNumber } from '@/lib/money';
import type { Cashbook } from '@/types/db';

export const metadata: Metadata = { title: 'Expenses' };

type SP = { status?: string; from?: string; to?: string; q?: string; page?: string; category?: string };

/**
 * Operating expenses. Filing one is a request against the account it will be
 * paid from; approving it is what moves the money. The categories are data a
 * manager edits under Accounts & Setup, never a list in the code.
 */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission('finance.view');
  const sp = await searchParams;
  const from = isIsoDate(sp.from) ? sp.from : monthStart();
  const to = isIsoDate(sp.to) ? sp.to : toISODate();

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="trending_down"
        title="Expenses"
        subtitle="Money actually spent by the SACCO. A bank withdrawal is not an expense - what the cash is spent on is."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Expenses' }]}
        action={
          <>
            {can(user, 'finance.record') ? <ActionLink href="/staff/finance/new/expense" icon="add" label="Record expense" primary /> : null}
            {can(user, 'finance.accounts') ? <ActionLink href="/staff/finance/accounts#categories" icon="category" label="Categories" /> : null}
          </>
        }
      />
      <PeriodPicker from={from} to={to} />
      <Suspense key={`${from}-${to}`} fallback={<PanelSkeleton height="h-40" />}>
        <ByCategory from={from} to={to} />
      </Suspense>
      <PaymentRegister sp={{ ...sp, from, to }} user={user} onlyExpenses />
    </div>
  );
}

async function ByCategory({ from, to }: { from: string; to: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cashbook', { p_from: from, p_to: to });
  if (error || !data) return <ErrorState title="Unable to load expense totals" />;
  const book = data as Cashbook;
  const total = toNumber(book.total_expenses);

  return (
    <Panel
      title="Approved expenses by category"
      subtitle={`${formatDate(from)} – ${formatDate(to)} · reversed entries excluded`}
      icon="trending_down"
      action={<span className="tabular text-button-text font-bold text-error">{formatUGX(total)}</span>}
      padded={false}
    >
      {book.expenses.length === 0 ? (
        <EmptyState compact icon="trending_down" title="No approved expenses in this period"
          description="Approved expenses are totalled here by category." />
      ) : (
        <ul className="divide-y divide-outline-variant/70">
          {book.expenses.map((l) => (
            <li key={l.category} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body-md font-semibold text-on-surface">{l.category}</span>
                <span className="tabular text-body-md font-semibold text-on-surface">{formatUGX(l.total)}</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
                  <div className="h-full rounded-full bg-error" style={{ width: `${percent(l.total, total)}%` }} />
                </div>
                <span className="shrink-0 text-label-md font-normal text-on-surface-variant">
                  {Math.round(percent(l.total, total))}% · {l.entries} {l.entries === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-outline-variant/70 px-5 py-2.5 text-label-md font-normal text-on-surface-variant">
        The full income and expenditure account is under{' '}
        <Link href={`/staff/finance/income-expenses?from=${from}&to=${to}`} className="font-semibold text-primary underline">
          Income &amp; Expenses
        </Link>
        .
      </p>
    </Panel>
  );
}
