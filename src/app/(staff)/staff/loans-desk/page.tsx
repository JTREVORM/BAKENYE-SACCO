import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { DashboardHeader } from '@/components/staff/DashboardHeader';
import { KpiCard, Money, Panel, QuickAction } from '@/components/ui/primitives';
import { LoanStatusBadge } from '@/components/ui/status';
import { EmptyState, ListSkeleton, StatGridSkeleton } from '@/components/ui/states';
import { formatDate, toISODate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { LoanBalanceRow, LoanStatus } from '@/types/db';

export const metadata: Metadata = { title: 'Loans desk' };

type Pipeline = {
  id: string;
  loan_no: string;
  principal: number;
  status: LoanStatus;
  applied_on: string;
  member: { full_name: string; member_no: string } | null;
};

/**
 * The loans desk - where a loan officer lands.
 *
 * Work waiting on them (applications to assess, approvals to pay out), money
 * coming due this week, and loans already behind - each read from the loans
 * and their balances, never estimated.
 */
export default async function LoansDesk() {
  const user = await requirePermission('loans.view');

  const actions = [
    can(user, 'loans.assess') && { href: '/staff/members', icon: 'request_quote', label: 'New application', tone: 'primary' as const },
    { href: '/staff/loans', icon: 'payments', label: 'All loans', tone: 'neutral' as const },
    { href: '/staff/loans/products', icon: 'inventory_2', label: 'Loan products', tone: 'neutral' as const },
    can(user, 'reports.member') && { href: '/staff/reports', icon: 'summarize', label: 'Reports', tone: 'accent' as const },
  ].filter(Boolean) as { href: string; icon: string; label: string; tone: 'primary' | 'accent' | 'neutral' }[];

  return (
    <div className="space-y-6">
      <DashboardHeader roleName={user.roleName} fullName={user.fullName} subtitle="Applications, repayments and arrears" />

      <Suspense fallback={<StatGridSkeleton />}>
        <PortfolioFigures />
      </Suspense>

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
        <div className="space-y-gutter xl:col-span-2">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <PipelinePanel />
          </Suspense>
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <ArrearsPanel />
          </Suspense>
        </div>
        <div className="space-y-gutter">
          <Panel title="Quick actions" icon="bolt">
            <div className="grid grid-cols-2 gap-2">
              {actions.map((a) => (
                <QuickAction key={a.href} href={a.href} icon={a.icon} label={a.label} tone={a.tone} />
              ))}
            </div>
          </Panel>
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <DueThisWeek />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

const LIVE: LoanStatus[] = ['active', 'disbursed', 'defaulted'];

async function liveBalances(): Promise<LoanBalanceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('loan_balances').select('*').in('status', LIVE);
  return (data ?? []) as LoanBalanceRow[];
}

async function memberNames(ids: string[]): Promise<Map<string, { full_name: string; member_no: string }>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from('members').select('id, full_name, member_no').in('id', ids);
  return new Map((data ?? []).map((m) => [m.id as string, m as { full_name: string; member_no: string }]));
}

async function PortfolioFigures() {
  const supabase = await createClient();
  const [live, pending] = await Promise.all([
    liveBalances(),
    supabase.from('loans').select('id', { count: 'exact', head: true }).in('status', ['applied', 'under_review']),
  ]);
  const outstanding = live.reduce((s, l) => s + Number(l.outstanding), 0);
  const overdue = live.filter((l) => Number(l.overdue_amount) > 0);
  const overdueSum = overdue.reduce((s, l) => s + Number(l.overdue_amount), 0);

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

async function PipelinePanel() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('loans')
    .select('id, loan_no, principal, status, applied_on, member:members!loans_member_id_fkey(full_name, member_no)')
    .in('status', ['applied', 'under_review', 'approved'])
    .order('applied_on', { ascending: true })
    .limit(10);
  const rows = (data ?? []) as unknown as Pipeline[];

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

async function ArrearsPanel() {
  const live = await liveBalances();
  const rows = live
    .filter((l) => Number(l.overdue_amount) > 0)
    .sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0))
    .slice(0, 8);
  const names = await memberNames(rows.map((r) => r.member_id));

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

async function DueThisWeek() {
  const today = toISODate();
  const week = toISODate(new Date(Date.now() + 7 * 86_400_000));
  const live = await liveBalances();
  const rows = live
    .filter((l) => l.next_due_on && l.next_due_on >= today && l.next_due_on <= week && Number(l.overdue_amount) === 0)
    .sort((a, b) => (a.next_due_on ?? '').localeCompare(b.next_due_on ?? ''))
    .slice(0, 8);
  const names = await memberNames(rows.map((r) => r.member_id));

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
