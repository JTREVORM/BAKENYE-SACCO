import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { DashboardHeader } from '@/components/staff/DashboardHeader';
import { Panel, QuickAction } from '@/components/ui/primitives';
import { ListSkeleton, StatGridSkeleton } from '@/components/ui/states';
import { toISODate } from '@/lib/format';
import type { LoanBalanceRow, LoanStatus } from '@/types/db';

import { LoanPortfolioFigures, LoanPipelinePanel, LoanArrearsPanel, LoansDuePanel, type Pipeline } from '@/components/staff/LoanDeskPanels';

export const metadata: Metadata = { title: 'Loans desk' };

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
    <div data-staff-dashboard="loans" className="space-y-gutter">
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

  return <LoanPortfolioFigures pending={pending} live={live} outstanding={outstanding} overdue={overdue} overdueSum={overdueSum} />;
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

  return <LoanPipelinePanel rows={rows} />;
}

async function ArrearsPanel() {
  const live = await liveBalances();
  const rows = live
    .filter((l) => Number(l.overdue_amount) > 0)
    .sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0))
    .slice(0, 8);
  const names = await memberNames(rows.map((r) => r.member_id));

  return <LoanArrearsPanel rows={rows} names={names} />;
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

  return <LoansDuePanel rows={rows} names={names} />;
}
