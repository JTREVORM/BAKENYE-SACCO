import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getDashboardMetrics } from '@/lib/queries';
import { DashboardHeader } from '@/components/staff/DashboardHeader';
import { RecentTransactions } from '@/components/staff/RecentTransactions';
import { FinancialActivity } from '@/components/staff/FinancialActivity';
import { FundsStrip } from '@/components/finance/FundsStrip';
import { KpiCard, Panel, QuickAction, Badge, Icon } from '@/components/ui/primitives';
import { EmptyState, PanelSkeleton, StatGridSkeleton } from '@/components/ui/states';
import { formatAgo } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { AuditLogRow } from '@/types/db';
import type { SecurityOverview } from '@/types/access';

export const metadata: Metadata = { title: 'Administration' };

/**
 * The administration dashboard - where a Super Admin or Admin lands.
 *
 * Accounts and sign-in security first, because that is what only they can
 * look after; then the SACCO in four figures, and the doors to configuration.
 * Every block asks for its own permission, so a custom role pointed at this
 * dashboard sees only what it may.
 */
export default async function AdministrationDashboard({
  searchParams,
}: {
  searchParams?: Promise<{ flow?: string }>;
}) {
  const user = await requirePermission('dashboard.staff');
  const sp = (await searchParams) ?? {};
  const flowMonths = sp.flow === '12' ? 12 : 6;
  const seesFinance = can(user, 'finance.view');

  const shortcuts = [
    can(user, 'users.manage') && { href: '/staff/users', icon: 'manage_accounts', label: 'Staff accounts', tone: 'primary' as const },
    can(user, 'roles.manage') && { href: '/staff/roles', icon: 'admin_panel_settings', label: 'Roles & permissions', tone: 'accent' as const },
    can(user, 'members.create') && { href: '/staff/members/new', icon: 'person_add', label: 'Register member', tone: 'success' as const },
    can(user, 'settings.view') && { href: '/staff/settings?section=fees', icon: 'sell', label: 'Fees', tone: 'neutral' as const },
    can(user, 'settings.view') && { href: '/staff/settings', icon: 'settings', label: 'Settings', tone: 'neutral' as const },
    can(user, 'audit.view') && { href: '/staff/audit', icon: 'policy', label: 'Audit log', tone: 'neutral' as const },
  ].filter(Boolean) as { href: string; icon: string; label: string; tone: 'primary' | 'accent' | 'success' | 'neutral' }[];

  return (
    <div className="space-y-gutter">
      <DashboardHeader
        roleName={user.roleName}
        fullName={user.fullName}
        subtitle="Accounts, security and configuration"
      />

      {can(user, 'users.manage') || can(user, 'audit.view') ? (
        <Suspense fallback={<StatGridSkeleton />}>
          <SecurityFigures />
        </Suspense>
      ) : null}

      {/* Where the money is: Cash at Merchant, Bank and Hand, and their total,
          straight from the account ledger. */}
      {seesFinance ? (
        <Suspense fallback={<StatGridSkeleton />}>
          <FundsStrip />
        </Suspense>
      ) : null}

      {can(user, 'transactions.view') || seesFinance ? (
        <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
          {can(user, 'transactions.view') ? (
            <div className="min-w-0 xl:col-span-2">
              <Suspense fallback={<PanelSkeleton height="h-80" />}>
                <RecentTransactions />
              </Suspense>
            </div>
          ) : null}
          {seesFinance ? (
            <div className="min-w-0">
              <Suspense fallback={<PanelSkeleton height="h-80" />}>
                <FinancialActivity months={flowMonths} baseHref="/staff/admin" />
              </Suspense>
            </div>
          ) : null}
        </div>
      ) : null}

      <Suspense fallback={<StatGridSkeleton />}>
        <SaccoFigures />
      </Suspense>

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {can(user, 'audit.view') ? (
            <Suspense fallback={<PanelSkeleton height="h-64" />}>
              <SecurityActivity />
            </Suspense>
          ) : (
            <Panel title="Security activity" icon="policy">
              <EmptyState compact icon="lock" title="Needs the audit permission" description="Sign-in activity is part of the audit log." />
            </Panel>
          )}
        </div>

        <Panel title="Administration" icon="tune">
          {shortcuts.length === 0 ? (
            <EmptyState compact icon="tune" title="Nothing to administer" description="Your role holds no administration permissions." />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {shortcuts.map((s) => (
                <QuickAction key={s.href} href={s.href} icon={s.icon} label={s.label} tone={s.tone} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

async function SecurityFigures() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('security_overview');
  if (error || !data) return null;
  const s = data as SecurityOverview;

  return (
    <section aria-label="Accounts and sign-in" className="grid grid-cols-2 gap-gutter lg:grid-cols-4">
      <KpiCard
        icon="manage_accounts"
        label="Active staff accounts"
        value={s.staff_accounts}
        tone="primary"
        href="/staff/users"
        footnote={`${s.member_logins} member ${s.member_logins === 1 ? 'login' : 'logins'}`}
      />
      <KpiCard
        icon="key"
        label="On a temporary password"
        value={s.must_change}
        tone={s.must_change > 0 ? 'warning' : 'neutral'}
        footnote={"Must choose their own at next sign\u2011in"}
      />
      <KpiCard
        icon="login"
        label="Sign-ins, last 24 hours"
        value={s.signins_24h}
        tone="success"
        footnote={`${s.failures_24h} failed ${s.failures_24h === 1 ? 'attempt' : 'attempts'}`}
      />
      <KpiCard
        icon="lock"
        label="Identifiers paused now"
        value={s.paused_now}
        tone={s.paused_now > 0 ? 'danger' : 'neutral'}
        footnote={
          s.members_without_login > 0
            ? `${s.members_without_login} ${s.members_without_login === 1 ? 'member has' : 'members have'} no login`
            : 'Every member has a login'
        }
      />
    </section>
  );
}

async function SaccoFigures() {
  const m = await getDashboardMetrics();
  if (!m) return null;
  return (
    <section aria-label="The SACCO" className="grid grid-cols-2 gap-gutter lg:grid-cols-4">
      <KpiCard
        icon="group"
        label="Active members"
        value={m.total_members}
        href="/staff/members"
        footnote={
          m.members_this_month > 0
            ? `${m.members_this_month} joined this month`
            : 'No new members this month'
        }
        trend={m.members_this_month > 0 ? 'up' : 'flat'}
      />
      <KpiCard icon="savings" label="Total savings" value={formatUGX(m.total_savings)} tone="success" href="/staff/savings" />
      <KpiCard icon="payments" label="Loans outstanding" value={formatUGX(m.outstanding_loans)} tone="accent" footnote={`${m.active_loan_count} active`} href="/staff/loans" />
      <KpiCard
        icon="pending_actions"
        label="Loans awaiting a decision"
        value={m.pending_loans}
        tone={m.pending_loans > 0 ? 'warning' : 'neutral'}
        href="/staff/loans"
      />
    </section>
  );
}

async function SecurityActivity() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, actor_name, action, summary, created_at, module')
    .in('module', ['Security', 'User Management'])
    .order('created_at', { ascending: false })
    .limit(12);
  const rows = (data ?? []) as Pick<AuditLogRow, 'id' | 'actor_name' | 'action' | 'summary' | 'created_at' | 'module'>[];

  return (
    <Panel
      title="Security activity"
      icon="policy"
      padded={false}
      action={
        <Link href="/staff/audit?module=Security" className="text-primary text-label-md font-semibold hover:underline">
          Full log
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact icon="policy" title="No sign-in activity yet" description="Sign-ins, failed attempts, resets and role changes appear here." />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              <span className="bg-surface-container text-on-surface-variant mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <Icon name={r.action.includes('failed') ? 'warning' : r.action.includes('password') || r.action.includes('code') ? 'key' : r.action.includes('role') ? 'admin_panel_settings' : 'login'} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-md text-on-surface break-words">{r.summary}</p>
                <p className="text-label-md text-on-surface-variant font-normal">
                  {r.actor_name} · {formatAgo(r.created_at)}
                </p>
              </div>
              {r.action.includes('failed') ? <Badge tone="warning">Failed</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
