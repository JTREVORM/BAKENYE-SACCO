import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getDashboardMetrics } from '@/lib/queries';
import { DashboardHeader } from '@/components/staff/DashboardHeader';
import { RecentTransactions } from '@/components/staff/RecentTransactions';
import { FinancialActivity } from '@/components/staff/FinancialActivity';
import { FundsStrip } from '@/components/finance/FundsStrip';
import { Panel, QuickAction } from '@/components/ui/primitives';
import { EmptyState, PanelSkeleton, StatGridSkeleton } from '@/components/ui/states';
import { AdminSecurityFigures, AdminSaccoFigures, AdminSecurityActivity, type SecurityActivityRow } from '@/components/staff/AdministrationPanels';
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
    <div data-admin-dashboard data-staff-dashboard={user.role !== 'super_admin' ? 'administration' : undefined} className="space-y-gutter">
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
          <FundsStrip fullAmounts />
        </Suspense>
      ) : null}

      {can(user, 'transactions.view') || seesFinance ? (
        <div data-admin-panels className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
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
                <FinancialActivity compact months={flowMonths} baseHref="/staff/admin" />
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

  return <AdminSecurityFigures s={s} />;
}

async function SaccoFigures() {
  const m = await getDashboardMetrics();
  if (!m) return null;
  return <AdminSaccoFigures m={m} />;
}

async function SecurityActivity() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, actor_name, action, summary, created_at, module')
    .in('module', ['Security', 'User Management'])
    .order('created_at', { ascending: false })
    .limit(12);
  const rows = (data ?? []) as SecurityActivityRow[];

  return <AdminSecurityActivity rows={rows} />;
}
