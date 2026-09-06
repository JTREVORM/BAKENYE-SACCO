import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getCollectionsTrend, getDashboardMetrics } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { Icon, Money, Avatar, PageTitle } from '@/components/ui/primitives';
import { StatGridSkeleton, ListSkeleton, ErrorState, EmptyState } from '@/components/ui/states';
import { TrendChart } from '@/components/staff/TrendChart';
import { formatAgo, formatDate, LOAN_STATUS_LABELS } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { AuditLogRow } from '@/types/db';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Staff dashboard.
 *
 * `staff_dashboard_desktop/code.html` connected to `dashboard_metrics()` — the
 * four-up stat row with its royal-blue Share Capital card, the compact
 * secondary stats strip, the Recent Activities timeline and the Pending Loan
 * Applications table.
 *
 * Two changes were necessary rather than cosmetic:
 *
 *  - the "+12%" growth pills Stitch printed on the stat cards were decoration;
 *    they now show a real month-on-month figure, or nothing at all. An invented
 *    growth number on a financial dashboard is worse than no number.
 *  - the pending-applications table becomes a card list below `md`. A five-column
 *    table at 360px is unreadable, which the brief calls out explicitly.
 */
export default async function StaffDashboard() {
  await requirePermission('dashboard.staff');

  return (
    <div className="space-y-8">
      <PageTitle title="Overview" subtitle="Real-time cooperative performance metrics." />

      <Suspense fallback={<StatGridSkeleton />}>
        <Metrics />
      </Suspense>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <RecentActivity />
          </Suspense>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <PendingLoans />
          </Suspense>

          <Suspense fallback={<div className="skeleton h-64 rounded-xl" />}>
            <Collections />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function Metrics() {
  const m = await getDashboardMetrics();

  if (!m) {
    return (
      <ErrorState
        title="Unable to load dashboard figures"
        description="Please refresh the page. If this continues, contact your administrator."
      />
    );
  }

  return (
    <>
      <section className="gap-gutter grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="group"
          iconTone="bg-primary-container/20 text-primary-container"
          label="Total Members"
          value={m.total_members.toLocaleString()}
          badge={
            m.members_this_month > 0
              ? { text: `+${m.members_this_month} this month`, tone: 'tertiary' }
              : undefined
          }
          href="/staff/members"
        />

        {/* Share Capital — the one high-contrast tile, as in the Stitch export. */}
        <Link
          href="/staff/shares"
          className="bg-primary text-on-primary relative flex flex-col justify-between overflow-hidden rounded-xl border border-primary p-5 shadow-[0_4px_12px_rgba(14,52,131,0.2)]"
        >
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10 blur-xl" />
          <div className="relative z-10 mb-4 flex items-start justify-between">
            <div className="rounded-lg bg-white/20 p-2 backdrop-blur-sm">
              <Icon name="pie_chart" className="text-white" />
            </div>
          </div>
          <div className="relative z-10">
            <div className="text-primary-fixed-dim text-label-md font-label-md mb-1 uppercase tracking-wider">
              Share Capital
            </div>
            <Money
              value={m.share_capital}
              compact
              className="text-display-currency font-display-currency text-white"
            />
          </div>
        </Link>

        <StatCard
          icon="account_balance_wallet"
          iconTone="bg-secondary-container/30 text-on-secondary-container"
          label="Total Savings"
          value={<Money value={m.total_savings} compact className="text-display-currency font-display-currency text-on-surface" />}
          href="/staff/savings"
        />

        <StatCard
          icon="payments"
          iconTone="bg-error-container/30 text-on-error-container"
          label="Active Loans"
          value={<Money value={m.active_loan_value} compact className="text-display-currency font-display-currency text-on-surface" />}
          badge={{ text: `${m.active_loan_count} active`, tone: 'neutral' }}
          href="/staff/loans"
        />
      </section>

      {/* Compact secondary stats strip */}
      <section className="bg-surface-container-lowest border-outline-variant/50 grid grid-cols-2 gap-4 rounded-xl border p-4 shadow-sm md:grid-cols-4">
        <MiniStat label="Outstanding Loans" value={m.outstanding_loans} />
        <MiniStat label="Today's Collections" value={m.todays_collections} tone="text-tertiary-container" />
        <MiniStat label="Income (MTD)" value={m.income_mtd} />
        <MiniStat label="Expenses (MTD)" value={m.expenses_mtd} tone="text-error" />
      </section>

      {/* Things that need someone's attention. Shown only when non-zero — an
          alert strip that is always present stops being an alert. */}
      {m.overdue_count > 0 || m.pending_loans > 0 || m.pending_expenses > 0 ? (
        <section className="flex flex-wrap gap-3">
          {m.overdue_count > 0 ? (
            <AttentionChip
              href="/staff/loans?status=overdue"
              icon="warning"
              tone="error"
              label={`${m.overdue_count} overdue ${m.overdue_count === 1 ? 'loan' : 'loans'}`}
              detail={formatUGX(m.overdue_loans)}
            />
          ) : null}
          {m.pending_loans > 0 ? (
            <AttentionChip
              href="/staff/loans?status=applied"
              icon="assignment"
              tone="warning"
              label={`${m.pending_loans} loan ${m.pending_loans === 1 ? 'application' : 'applications'}`}
              detail="awaiting review"
            />
          ) : null}
          {m.pending_expenses > 0 ? (
            <AttentionChip
              href="/staff/finance?tab=expenses&approval=pending"
              icon="receipt"
              tone="warning"
              label={`${m.pending_expenses} ${m.pending_expenses === 1 ? 'expense' : 'expenses'}`}
              detail="awaiting approval"
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function StatCard({
  icon,
  iconTone,
  label,
  value,
  badge,
  href,
}: {
  icon: string;
  iconTone: string;
  label: string;
  value: React.ReactNode;
  badge?: { text: string; tone: 'tertiary' | 'neutral' };
  href: string;
}) {
  return (
    <Link
      href={href}
      className="bg-surface border-outline-variant/30 elev-1 flex flex-col justify-between rounded-xl border p-5 transition-shadow hover:shadow-lg"
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className={clsx('rounded-lg p-2', iconTone)}>
          <Icon name={icon} />
        </div>
        {badge ? (
          <span
            className={clsx(
              'font-label-md text-label-md flex items-center rounded-full px-2 py-0.5 normal-case',
              badge.tone === 'tertiary'
                ? 'text-tertiary bg-tertiary-fixed-dim/30'
                : 'text-on-surface-variant bg-surface-container',
            )}
          >
            {badge.tone === 'tertiary' ? (
              <Icon name="trending_up" size={14} className="mr-1" />
            ) : null}
            {badge.text}
          </span>
        ) : null}
      </div>
      <div>
        <div className="text-on-surface-variant text-label-md font-label-md mb-1 uppercase tracking-wider">
          {label}
        </div>
        <div className="text-display-currency font-display-currency text-on-surface">{value}</div>
      </div>
    </Link>
  );
}

function MiniStat({
  label,
  value,
  tone = 'text-on-surface',
}: {
  label: string;
  value: unknown;
  tone?: string;
}) {
  return (
    <div className="p-3">
      <div className="text-label-md font-label-md text-on-surface-variant mb-1">{label}</div>
      <Money
        value={value}
        className={clsx('text-headline-lg-mobile font-headline-lg-mobile font-semibold', tone)}
      />
    </div>
  );
}

function AttentionChip({
  href,
  icon,
  tone,
  label,
  detail,
}: {
  href: string;
  icon: string;
  tone: 'error' | 'warning';
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        'flex items-center gap-2 rounded-xl px-4 py-3 transition-opacity hover:opacity-90',
        tone === 'error'
          ? 'bg-error-container text-on-error-container'
          : 'bg-secondary-container text-on-secondary-container',
      )}
    >
      <Icon name={icon} size={20} className="shrink-0" />
      <span className="text-button-text font-button-text">{label}</span>
      <span className="text-body-md font-body-md opacity-80">· {detail}</span>
      <Icon name="chevron_right" size={18} className="shrink-0" />
    </Link>
  );
}

/* ------------------------------------------------------------------------ */

async function RecentActivity() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, action, module, summary, actor_name, created_at')
    .order('created_at', { ascending: false })
    .limit(8);

  const rows = (data ?? []) as Pick<
    AuditLogRow,
    'id' | 'action' | 'module' | 'summary' | 'actor_name' | 'created_at'
  >[];

  return (
    <div className="bg-surface border-outline-variant/30 elev-1 flex max-h-[500px] flex-col overflow-hidden rounded-xl border">
      <div className="border-outline-variant/30 bg-surface-bright flex items-center justify-between border-b p-5">
        <h2 className="text-button-text font-button-text text-on-surface font-bold">
          Recent Activities
        </h2>
        <Link href="/staff/audit" className="text-primary text-label-md font-label-md hover:underline">
          View All
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {rows.length === 0 ? (
          <EmptyState
            icon="history"
            title="No activity yet"
            description="Member registrations, savings and loan decisions will appear here."
          />
        ) : (
          <div className="space-y-4">
            {rows.map((a, i) => (
              <div key={a.id} className="flex gap-4">
                <div className="relative mt-1">
                  <div
                    className={clsx(
                      'relative z-10 flex h-8 w-8 items-center justify-center rounded-full',
                      activityTone(a.action),
                    )}
                  >
                    <Icon name={activityIcon(a.action)} size={18} />
                  </div>
                  {i < rows.length - 1 ? (
                    <div className="bg-outline-variant/50 absolute left-1/2 top-8 -z-0 h-full w-px -translate-x-1/2" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="text-body-md font-body-md text-on-surface">{a.summary}</div>
                  <div className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
                    {a.actor_name} · {formatAgo(a.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function activityIcon(action: string): string {
  if (action.startsWith('member.')) return 'person_add';
  if (action.startsWith('savings.')) return 'savings';
  if (action.startsWith('shares.')) return 'pie_chart';
  if (action.startsWith('loan.')) return 'credit_score';
  if (action.startsWith('expense.') || action.startsWith('income.')) return 'account_balance';
  if (action.startsWith('transaction.')) return 'undo';
  if (action.startsWith('user.')) return 'manage_accounts';
  return 'history';
}

function activityTone(action: string): string {
  if (action.startsWith('member.')) return 'bg-secondary-container text-on-secondary-container';
  if (action.startsWith('savings.')) return 'bg-tertiary-container/20 text-tertiary-container';
  if (action.startsWith('transaction.reversed')) return 'bg-error-container text-on-error-container';
  return 'bg-primary-container/20 text-primary-container';
}

/* ------------------------------------------------------------------------ */

async function PendingLoans() {
  const user = await requirePermission('dashboard.staff');
  const supabase = await createClient();

  const { data } = await supabase
    .from('loans')
    .select(
      'id, loan_no, principal, status, applied_on, ' +
        'members!loans_member_id_fkey(full_name, member_no, photo_url), ' +
        'loan_products!loans_product_id_fkey(name)',
    )
    .in('status', ['applied', 'under_review'])
    .order('applied_on', { ascending: true })
    .limit(6);

  type Row = {
    id: string;
    loan_no: string;
    principal: number;
    status: 'applied' | 'under_review';
    applied_on: string;
    members: { full_name: string; member_no: string; photo_url: string | null } | null;
    loan_products: { name: string } | null;
  };

  const rows = (data ?? []) as unknown as Row[];
  const canReview = can(user.role, 'loans.assess');

  return (
    <div className="bg-surface border-outline-variant/30 elev-1 overflow-hidden rounded-xl border">
      <div className="border-outline-variant/30 bg-surface-bright flex items-center justify-between gap-3 border-b p-5">
        <h2 className="text-button-text font-button-text text-on-surface font-bold">
          Pending Loan Applications
        </h2>
        <Link
          href="/staff/loans?status=applied"
          className="bg-primary text-on-primary hover:bg-primary-container text-label-md font-label-md rounded-md px-3 py-1.5 font-semibold shadow-sm transition-colors"
        >
          View all
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="done_all"
          title="No applications waiting"
          description="Every loan application has been reviewed."
        />
      ) : (
        <>
          {/* Mobile: cards. Rule 27 — no five-column table at 360px. */}
          <ul className="divide-outline-variant/30 divide-y md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/staff/loans/${r.id}`}
                  className="hover:bg-surface-container-lowest flex items-center gap-3 p-4 transition-colors"
                >
                  <Avatar name={r.members?.full_name} src={r.members?.photo_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-md font-body-md text-primary truncate font-semibold">
                      {r.members?.full_name ?? 'Unknown member'}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                      {r.members?.member_no} · {r.loan_products?.name}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant/70 normal-case">
                      {formatDate(r.applied_on)} · {LOAN_STATUS_LABELS[r.status]}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money
                      value={r.principal}
                      className="text-body-md font-body-md text-on-surface font-semibold"
                    />
                    <p className="text-label-md font-label-md text-primary mt-1 normal-case">
                      {canReview ? 'Review' : 'View'}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: the Stitch table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant/50 border-b uppercase tracking-wider">
                  <th className="p-4 font-semibold">Applicant</th>
                  <th className="p-4 font-semibold">Loan Type</th>
                  <th className="p-4 text-right font-semibold">Amount Requested</th>
                  <th className="p-4 font-semibold">Date Submitted</th>
                  <th className="p-4 text-center font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/30 divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-container-lowest transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.members?.full_name} src={r.members?.photo_url} size={32} />
                        <div className="min-w-0">
                          <div className="text-primary truncate font-semibold">
                            {r.members?.full_name ?? 'Unknown member'}
                          </div>
                          <div className="text-on-surface-variant tabular text-xs">
                            {r.members?.member_no}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">{r.loan_products?.name ?? '—'}</td>
                    <td className="tabular p-4 text-right font-semibold">
                      {formatUGX(r.principal)}
                    </td>
                    <td className="text-on-surface-variant p-4 whitespace-nowrap">
                      {formatDate(r.applied_on)}
                    </td>
                    <td className="p-4 text-center">
                      <Link
                        href={`/staff/loans/${r.id}`}
                        className="bg-surface-container-high hover:bg-surface-container border-outline-variant/50 text-label-md font-label-md text-primary inline-flex h-touch-target-min items-center rounded-lg border px-3 font-semibold transition-colors"
                      >
                        {canReview ? 'Review' : 'View'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function Collections() {
  const points = await getCollectionsTrend(6);
  const thisMonth = points[points.length - 1];
  const total = thisMonth
    ? toNumber(thisMonth.savings) + toNumber(thisMonth.repayments) + toNumber(thisMonth.shares)
    : 0;

  return (
    <div className="bg-surface border-outline-variant/30 elev-1 overflow-hidden rounded-xl border">
      <div className="border-outline-variant/30 bg-surface-bright flex items-center justify-between gap-3 border-b p-5">
        <div>
          <h2 className="text-button-text font-button-text text-on-surface font-bold">
            Collections
          </h2>
          <p className="text-label-md font-label-md text-on-surface-variant normal-case">
            Last six months
          </p>
        </div>
        <div className="text-right">
          <p className="text-label-md font-label-md text-on-surface-variant">This month</p>
          <Money
            value={total}
            className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface font-semibold"
          />
        </div>
      </div>
      <div className="p-5">
        <TrendChart points={points} />
      </div>
    </div>
  );
}
