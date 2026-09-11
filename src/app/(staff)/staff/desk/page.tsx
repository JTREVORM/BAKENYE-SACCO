import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can, type Access } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getDashboardMetrics } from '@/lib/queries';
import { DashboardHeader } from '@/components/staff/DashboardHeader';
import { FundsStrip } from '@/components/finance/FundsStrip';
import { KpiCard, Money, Panel, QuickAction } from '@/components/ui/primitives';
import { EmptyState, ListSkeleton, StatGridSkeleton } from '@/components/ui/states';
import { formatAgo, toISODate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { ReceiptRegisterRow } from '@/types/treasury';

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
    <div className="space-y-6">
      <DashboardHeader roleName={user.roleName} fullName={user.fullName} subtitle="The counter" />

      <Suspense fallback={<StatGridSkeleton />}>
        <TodayFigures />
      </Suspense>

      {can(user, 'finance.view') ? (
        <Suspense fallback={<StatGridSkeleton />}>
          <FundsStrip />
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
  return (
    <section aria-label="Today" className="grid grid-cols-2 gap-gutter lg:grid-cols-4">
      <KpiCard icon="payments" label="Collected today" value={formatUGX(m.todays_collections)} tone="success" />
      <KpiCard
        icon="event_available"
        label="Savings due today"
        value={m.schedules_due_today}
        tone={m.schedules_due_today > 0 ? 'primary' : 'neutral'}
        href="/staff/savings/schedules"
      />
      <KpiCard
        icon="event_busy"
        label="Savings in arrears"
        value={formatUGX(m.savings_arrears)}
        tone={Number(m.savings_arrears) > 0 ? 'warning' : 'neutral'}
      />
      <KpiCard icon="group" label="Active members" value={m.total_members} href="/staff/members" />
    </section>
  );
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
  const rows = (data ?? []) as Pick<ReceiptRegisterRow, 'id' | 'receipt_no' | 'transaction_id' | 'amount' | 'payer' | 'category' | 'receiving_account_name' | 'created_at' | 'status'>[];
  const total = rows.filter((r) => r.status === 'posted').reduce((s, r) => s + Number(r.amount), 0);

  return (
    <Panel
      title="Receipts you issued today"
      icon="receipt_long"
      padded={false}
      action={
        rows.length ? (
          <span className="text-label-md text-on-surface-variant font-semibold">{formatUGX(total)}</span>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact icon="receipt_long" title="No receipts yet today" description="Everything you receive today is listed here, with its receipt." />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/staff/transactions/${r.transaction_id}`} className="hover:bg-surface-container-low flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-body-md text-on-surface truncate font-semibold">{r.payer ?? '—'}</p>
                  <p className="text-label-md text-on-surface-variant font-normal">
                    <span className="font-mono">{r.receipt_no}</span> · {r.category} · {r.receiving_account_name ?? '—'} · {formatAgo(r.created_at)}
                  </p>
                </div>
                <Money value={r.amount} className="text-body-md text-on-surface shrink-0 font-semibold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
