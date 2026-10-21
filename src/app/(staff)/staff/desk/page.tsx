import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can, type Access } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getDashboardMetrics } from '@/lib/queries';
import { DashboardHeader } from '@/components/staff/DashboardHeader';
import { FundsStrip } from '@/components/finance/FundsStrip';
import { Panel, QuickAction } from '@/components/ui/primitives';
import { EmptyState, ListSkeleton, StatGridSkeleton } from '@/components/ui/states';
import { toISODate } from '@/lib/format';
import { CashierFigures, CashierReceiptsPanel, type CashierReceipt } from '@/components/staff/CashierPanels';

export const metadata: Metadata = { title: 'Cashier desk' };

/**
 * The cashier desk - where a cashier or teller lands.
 *
 * The counter's day: what has come in today, what the SACCO holds where, the
 * receipts this cashier issued, and the actions a queue of members needs.
 */
export default async function CashierDesk() {
  const user = await requirePermission('dashboard.staff');

  const actions = [
    can(user, 'savings.record') && { href: '/staff/savings/collect', icon: 'point_of_sale', label: 'Collect savings', tone: 'primary' as const },
    can(user, 'finance.record') && { href: '/staff/finance/new/collection', icon: 'receipt_long', label: 'Record a payment', tone: 'success' as const },
    { href: '/staff/members', icon: 'person_search', label: 'Find a member', tone: 'neutral' as const },
    can(user, 'members.create') && { href: '/staff/members/new', icon: 'person_add', label: 'Register member', tone: 'accent' as const },
    can(user, 'shares.sell') && { href: '/staff/shares/sell', icon: 'pie_chart', label: 'Sell shares', tone: 'accent' as const },
    can(user, 'finance.view') && { href: '/staff/finance/receipts', icon: 'receipt', label: 'Receipts', tone: 'neutral' as const },
  ].filter(Boolean) as { href: string; icon: string; label: string; tone: 'primary' | 'success' | 'accent' | 'neutral' }[];

  return (
    <div data-staff-dashboard="cashier" className="space-y-gutter">
      <DashboardHeader roleName={user.roleName} fullName={user.fullName} subtitle="The counter" />

      <Suspense fallback={<StatGridSkeleton />}>
        <TodayFigures />
      </Suspense>

      {can(user, 'finance.view') ? (
        <Suspense fallback={<StatGridSkeleton />}>
          <FundsStrip fullAmounts />
        </Suspense>
      ) : null}

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
        <Panel title="Quick actions" icon="bolt">
          <div className="grid grid-cols-2 gap-2">
            {actions.map((a) => (
              <QuickAction key={a.href} href={a.href} icon={a.icon} label={a.label} tone={a.tone} />
            ))}
          </div>
        </Panel>

        <div className="xl:col-span-2">
          <Suspense fallback={<ListSkeleton rows={5} />}>
            <MyReceiptsToday user={user} userId={user.id} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function TodayFigures() {
  const m = await getDashboardMetrics();
  if (!m) return null;
  return <CashierFigures m={m} />;
}

async function MyReceiptsToday({ user, userId }: { user: Access; userId: string }) {
  if (!can(user, 'finance.view')) {
    return (
      <Panel title="Receipts you issued today" icon="receipt_long">
        <EmptyState compact icon="receipt_long" title="Receipts are part of the books" description="Your role does not include viewing finance." />
      </Panel>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from('receipt_register')
    .select('id, receipt_no, transaction_id, amount, payer, category, receiving_account_name, created_at, status')
    .eq('recorded_by', userId)
    .eq('receipt_date', toISODate())
    .order('created_at', { ascending: false })
    .limit(8);
  const rows = (data ?? []) as CashierReceipt[];
  const total = rows.filter((r) => r.status === 'posted').reduce((s, r) => s + Number(r.amount), 0);

  return <CashierReceiptsPanel rows={rows} total={total} />;
}
