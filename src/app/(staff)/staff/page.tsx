import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getCategoryAnalytics, getCollectionsTrend, getDashboardMetrics } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { can, type Access } from '@/lib/rbac';
import {
  Icon,
  Money,
  Avatar,
  ProgressBar,
  Panel,
  KpiCard,
  KpiCardFeature,
  MiniStat,
  QuickAction,
  ViewAllLink,
  Badge,
  DataTable,
} from '@/components/ui/primitives';
import {
  StatGridSkeleton,
  ListSkeleton,
  PanelSkeleton,
  ErrorState,
  EmptyState,
} from '@/components/ui/states';
import { TrendChart } from '@/components/staff/TrendChart';
import { FundsStrip } from '@/components/finance/FundsStrip';
import { ScrollArea } from '@/components/ui/scroll';
import { daysUntil, formatAgo, formatDate, toISODate, LOAN_STATUS_LABELS } from '@/lib/format';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { AuditLogRow } from '@/types/db';
import { getBrand } from '@/lib/brand';
import { splitName } from '@/lib/sacco-brand';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Staff dashboard — the executive overview of the SACCO.
 *
 * Everything on this page is computed from the database. There is one rule the
 * layout is built around: a figure that has no real comparison behind it shows
 * no trend indicator, and a section with no data shows an empty state that says
 * so. A dashboard that always displays a green "+12%" trains people to stop
 * reading it, which is worse than showing nothing.
 *
 * Each block is its own `Suspense` boundary so a slow query — the six-month
 * trend, typically — never holds up the metrics a manager opened the page for.
 */
export default async function StaffDashboard() {
  const brand = await getBrand();
  const user = await requirePermission('dashboard.staff');

  return (
    <div className="space-y-7">
      <Hero name={user.fullName} saccoName={brand.legalName} roleName={user.roleName} />

      <Suspense fallback={<StatGridSkeleton />}>
        <Metrics />
      </Suspense>

      {can(user, 'finance.view') ? (
        <Suspense fallback={<StatGridSkeleton />}>
          <FundsStrip />
        </Suspense>
      ) : null}

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
        <div className="space-y-gutter xl:col-span-2">
          <Suspense fallback={<PanelSkeleton height="h-40" />}>
            <CategoryPerformance />
          </Suspense>

          <Suspense fallback={<PanelSkeleton height="h-56" />}>
            <Collections />
          </Suspense>

          <Suspense fallback={<PanelSkeleton height="h-56" />}>
            <PendingLoans />
          </Suspense>
        </div>

        <div className="space-y-gutter xl:col-span-1">
          <QuickActions role={user} />

          <Suspense fallback={<PanelSkeleton height="h-56" />}>
            <UpcomingReminders />
          </Suspense>

          <Suspense fallback={<ListSkeleton rows={4} />}>
            <RecentActivity />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Hero
 * ------------------------------------------------------------------------ */

/**
 * The welcome banner.
 *
 * The photograph is the one already in the project. It sits behind a navy
 * gradient rather than beside the text, so the headline keeps AAA contrast at
 * every width and the image never has to be cropped to a shape it does not
 * suit. If the file is ever removed the gradient alone still reads correctly.
 */
function Hero({ name, saccoName, roleName }: { name: string; saccoName: string; roleName: string }) {
  const firstName = name.trim().split(/\s+/)[0];
  const [heroNameTop, heroNameBottom] = splitName(saccoName);

  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-ink shadow-brand">
      <Image
        src="/brand/fisherman-at-sunset-stockcake.jpg"
        alt=""
        fill
        priority
        sizes="(max-width: 768px) 100vw, 1200px"
        className="object-cover object-center opacity-45"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-ink via-ink/92 to-ink/35"
      />

      <div className="relative z-10 flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="max-w-xl">
          <p className="text-label-md font-semibold uppercase tracking-[0.14em] text-secondary-container">
            {roleName} Dashboard · Welcome back, {firstName}
          </p>
          <h1 className="mt-2 text-[26px] font-bold uppercase leading-[1.15] tracking-tight text-white md:text-[34px]">
            {heroNameTop}
            <br />
            {heroNameBottom}
          </h1>
          <span aria-hidden="true" className="mt-4 block h-1 w-16 rounded-full bg-secondary-container" />
          <p className="mt-4 max-w-md text-body-lg text-white/75">
            Your savings, our priority. Together we build a stronger and more prosperous
            community.
          </p>
        </div>

        <Suspense fallback={<div className="h-24 w-full max-w-xs md:w-72" />}>
          <HeroFigures />
        </Suspense>
      </div>
    </section>
  );
}

/** The three headline figures, read from the same RPC the KPI grid uses. */
async function HeroFigures() {
  const m = await getDashboardMetrics();
  if (!m) return null;

  const figures = [
    { icon: 'group', label: 'Active Members', value: m.total_members.toLocaleString() },
    { icon: 'savings', label: 'Total Savings', value: formatUGX(m.total_savings) },
    { icon: 'payments', label: 'Loans Outstanding', value: formatUGX(m.outstanding_loans) },
  ];

  return (
    <dl className="w-full shrink-0 space-y-1 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md md:w-auto md:min-w-[280px]">
      {figures.map((f) => (
        <div key={f.label} className="flex items-center gap-3 py-1.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
            <Icon name={f.icon} size={18} />
          </span>
          <div className="min-w-0">
            <dd className="tabular text-button-text font-bold leading-tight text-white">
              {f.value}
            </dd>
            <dt className="text-label-md font-medium text-white/65">{f.label}</dt>
          </div>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------------ *
 * KPI grid
 * ------------------------------------------------------------------------ */

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
      <section className="grid grid-cols-2 gap-3 sm:gap-gutter lg:grid-cols-4">
        <KpiCard
          icon="group"
          tone="primary"
          label="Active Members"
          value={m.total_members.toLocaleString()}
          footnote={
            m.members_this_month > 0
              ? `+${m.members_this_month} joined this month`
              : 'No new members this month'
          }
          href="/staff/members"
        />

        {/* Share capital is the one high-contrast tile — the single figure the
            board asks for first. */}
        <KpiCardFeature
          icon="pie_chart"
          label="Share Capital"
          value={<Money value={m.share_capital} compact />}
          footnote="Member equity held"
          href="/staff/shares"
        />

        <KpiCard
          icon="account_balance_wallet"
          tone="success"
          label="Total Savings"
          value={<Money value={m.total_savings} compact />}
          footnote={
            m.savings_arrears > 0
              ? `${formatUGX(m.savings_arrears)} in arrears`
              : 'No savings arrears'
          }
          href="/staff/savings"
        />

        <KpiCard
          icon="payments"
          tone={m.overdue_count > 0 ? 'danger' : 'warning'}
          label="Active Loans"
          value={<Money value={m.active_loan_value} compact />}
          footnote={`${m.active_loan_count} ${m.active_loan_count === 1 ? 'loan' : 'loans'} running${
            m.overdue_count > 0 ? ` · ${m.overdue_count} overdue` : ''
          }`}
          href="/staff/loans"
        />
      </section>

      {/* Secondary figures. Grouped in one strip rather than four more cards:
          they are context for the row above, not headline numbers. */}
      <section className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-2xl bg-surface p-5 shadow-neu md:grid-cols-4">
        <MiniStat
          icon="account_balance"
          label="Outstanding Loans"
          value={<Money value={m.outstanding_loans} />}
          href="/staff/loans"
        />
        <MiniStat
          icon="today"
          label="Today's Collections"
          value={<Money value={m.todays_collections} />}
          tone={toNumber(m.todays_collections) > 0 ? 'text-tertiary' : 'text-on-surface'}
          href="/staff/transactions"
        />
        <MiniStat
          icon="north_east"
          label="Income (MTD)"
          value={<Money value={m.income_mtd} />}
          tone="text-tertiary"
          href="/staff/finance/income-expenses"
        />
        <MiniStat
          icon="south_west"
          label="Expenses (MTD)"
          value={<Money value={m.expenses_mtd} />}
          tone="text-error"
          href="/staff/finance/expenses"
        />
      </section>

      {/* Things that need someone's attention. Shown only when non-zero — an
          alert strip that is always present stops being an alert. */}
      {m.overdue_count > 0 ||
      m.pending_loans > 0 ||
      m.pending_expenses > 0 ||
      m.savings_arrears > 0 ? (
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
          {m.savings_arrears > 0 ? (
            <AttentionChip
              href="/staff/savings/schedules?status=missed"
              icon="savings"
              tone="error"
              label="Savings arrears"
              detail={formatUGX(m.savings_arrears)}
            />
          ) : null}
          {m.pending_expenses > 0 ? (
            <AttentionChip
              href="/staff/finance/expenses?status=submitted"
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
        'card-interactive flex items-center gap-2.5 rounded-xl border px-4 py-3',
        tone === 'error'
          ? 'border-error/25 bg-error-container/60 text-on-error-container'
          : 'border-warning/25 bg-warning-container/70 text-on-warning-container',
      )}
    >
      <Icon name={icon} size={19} className="shrink-0" />
      <span className="text-button-text">{label}</span>
      <span className="text-body-md opacity-80">· {detail}</span>
      <Icon name="chevron_right" size={17} className="shrink-0 opacity-70" />
    </Link>
  );
}

/* ------------------------------------------------------------------------ *
 * Quick actions
 * ------------------------------------------------------------------------ */

/**
 * Only actions the signed-in role may actually perform are offered. A tile that
 * leads to a permission error is worse than no tile.
 */
function QuickActions({ role }: { role: Access }) {
  const actions = [
    { href: '/staff/members/new', icon: 'person_add', label: 'Add Member', permission: 'members.create', tone: 'primary' },
    { href: '/staff/savings/collect', icon: 'point_of_sale', label: 'Collect Savings', permission: 'savings.record', tone: 'success' },
    { href: '/staff/loans/new', icon: 'request_quote', label: 'New Loan', permission: 'loans.assess', tone: 'accent' },
    { href: '/staff/transactions/cash', icon: 'swap_horiz', label: 'Cash Movement', permission: 'cash.movement', tone: 'neutral' },
    { href: '/staff/categories', icon: 'workspace_premium', label: 'Categories', permission: 'categories.manage', tone: 'primary' },
    { href: '/staff/reports', icon: 'summarize', label: 'View Reports', permission: 'reports.view', tone: 'neutral' },
  ] as const;

  const visible = actions.filter((a) => can(role, a.permission));
  if (visible.length === 0) return null;

  return (
    <Panel title="Quick Actions" icon="bolt" bodyClassName="p-4">
      <div className="grid grid-cols-2 gap-3">
        {visible.map((a) => (
          <QuickAction key={a.href} href={a.href} icon={a.icon} label={a.label} tone={a.tone} />
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * Upcoming reminders
 * ------------------------------------------------------------------------ */

/**
 * What is due next, derived from the member schedules and the loan schedule.
 *
 * These are real rows: a savings reminder is a schedule that is genuinely open
 * and falls due, and a repayment reminder comes from `loan_schedule`. Nothing
 * here is a placeholder for a reminder system that does not exist yet — when
 * email reminders are added in a later phase they will send exactly these.
 */
async function UpcomingReminders() {
  const supabase = await createClient();
  const today = toISODate();

  const [{ data: schedules }, { data: due }] = await Promise.all([
    supabase
      .from('savings_schedules')
      .select(
        'schedule_id, member_id, member_name, savings_category_name, due_on, expected_amount, outstanding, status',
      )
      .in('status', ['pending', 'partial'])
      .gte('due_on', today)
      .order('due_on', { ascending: true })
      .limit(4),
    // `loan_schedule` has no status of its own — an installment is outstanding
    // when it falls in the future and its loan is still running, so the filter
    // belongs on the loan.
    supabase
      .from('loan_schedule')
      .select('id, due_on, total_due, loans!inner(id, loan_no, status, members!inner(full_name))')
      .in('loans.status', ['disbursed', 'active'])
      .gte('due_on', today)
      .order('due_on', { ascending: true })
      .limit(4),
  ]);

  type Reminder = {
    key: string;
    icon: string;
    tone: 'primary' | 'success' | 'warning';
    title: string;
    detail: string;
    on: string;
    href: string;
  };

  const items: Reminder[] = [
    ...((schedules ?? []) as {
      schedule_id: string;
      member_id: string;
      member_name: string;
      savings_category_name: string | null;
      due_on: string;
      expected_amount: number;
      outstanding: number;
    }[]).map((c) => ({
      key: `schedule-${c.schedule_id}`,
      icon: 'event_available',
      tone: 'success' as const,
      title: `Savings due · ${c.member_name}`,
      detail: `${formatUGX(c.outstanding)} outstanding${
        c.savings_category_name ? ` · ${c.savings_category_name}` : ''
      }`,
      on: c.due_on,
      href: `/staff/savings/collect?q=${encodeURIComponent(c.member_name)}&member=${c.member_id}`,
    })),
    ...((due ?? []) as unknown as {
      id: string;
      due_on: string;
      total_due: number;
      loans: { id: string; loan_no: string; members: { full_name: string } | null } | null;
    }[]).map((d) => ({
      key: `due-${d.id}`,
      icon: 'schedule',
      tone: 'warning' as const,
      title: `Loan repayment · ${d.loans?.members?.full_name ?? d.loans?.loan_no ?? 'Loan'}`,
      detail: `${formatUGX(d.total_due)} due`,
      on: d.due_on,
      href: d.loans ? `/staff/loans/${d.loans.id}` : '/staff/loans',
    })),
  ]
    .sort((a, b) => a.on.localeCompare(b.on))
    .slice(0, 5);

  return (
    <Panel
      title="Upcoming Reminders"
      icon="notifications_active"
      action={<ViewAllLink href="/staff/savings/schedules" />}
      padded={false}
    >
      {items.length === 0 ? (
        <EmptyState
          compact
          icon="event_busy"
          title="Nothing scheduled"
          description="Savings due dates and loan repayment dates appear here as they fall."
        />
      ) : (
        <ul className="divide-y divide-outline-variant/70">
          {items.map((r) => (
            <li key={r.key}>
              <Link
                href={r.href}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-container-low"
              >
                <span
                  className={clsx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                    r.tone === 'success'
                      ? 'bg-tertiary-fixed text-tertiary'
                      : 'bg-warning-container text-warning',
                  )}
                >
                  <Icon name={r.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-md font-semibold text-on-surface">
                    {r.title}
                  </span>
                  <span className="block truncate text-label-md font-normal text-on-surface-variant">
                    {r.detail}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-label-md font-semibold text-on-surface">
                    {relativeDay(r.on)}
                  </span>
                  <span className="block text-label-md font-normal text-on-surface-variant">
                    {formatDate(r.on)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** "Today" / "Tomorrow" / "In 5 days" — read at a glance, unlike a bare date. */
function relativeDay(iso: string): string {
  const days = daysUntil(iso) ?? 0;
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  return `In ${Math.round(days / 7)} weeks`;
}

/* ------------------------------------------------------------------------ *
 * Category performance
 * ------------------------------------------------------------------------ */

/**
 * How each savings category is performing this month.
 *
 * Replaces the collection-day board the group model needed: members save on
 * their own category's cadence now, so the question a manager arrives with is
 * "are the Silver Savers keeping up?", not "who meets on a Wednesday?".
 *
 * Every figure comes from `savings_category_analytics()`, which aggregates the
 * schedules actually raised. A category with no members shows zero and says so.
 */
async function CategoryPerformance() {
  const analytics = await getCategoryAnalytics();

  if (!analytics || analytics.rows.length === 0) {
    return (
      <Panel
        title="Category performance"
        icon="workspace_premium"
        action={<ViewAllLink href="/staff/categories">Manage categories</ViewAllLink>}
        padded={false}
      >
        <EmptyState
          compact
          icon="workspace_premium"
          title="No savings categories yet"
          description="Create the categories members save under, and their performance will be tracked here."
        />
      </Panel>
    );
  }

  const { totals } = analytics;
  const rate = percent(totals.collected, totals.expected);

  return (
    <Panel
      title="Category performance"
      subtitle={`${formatUGX(totals.collected)} of ${formatUGX(totals.expected)} expected this month`}
      icon="workspace_premium"
      action={
        <Link
          href="/staff/savings"
          className="text-button-text text-on-primary bg-primary hover:bg-primary-container inline-flex h-11 items-center gap-2 rounded-xl px-4 shadow-card transition-colors"
        >
          <Icon name="assessment" size={18} />
          Savings dashboard
        </Link>
      }
      padded={false}
    >
      <div className="border-outline-variant border-b px-5 py-3.5">
        <div className="text-label-md text-on-surface-variant mb-2 flex items-center justify-between font-semibold">
          <span>Overall collection rate</span>
          <span className="tabular text-on-surface">{rate.toFixed(0)}%</span>
        </div>
        <ProgressBar
          value={rate}
          tone={rate >= 80 ? 'tertiary' : rate >= 40 ? 'secondary' : 'error'}
          label="Overall collection rate this month"
        />
      </div>

      <ul className="divide-outline-variant/70 divide-y">
        {analytics.rows.map((c) => {
          const r = toNumber(c.collection_rate);
          return (
            <li key={c.savings_category_id}>
              <Link
                href={`/staff/savings/performance?category=${c.savings_category_id}`}
                className="min-h-touch-target-min hover:bg-surface-container-low flex items-center gap-4 px-5 py-3.5 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-body-md text-on-surface block truncate font-semibold">
                    {c.name}
                  </span>
                  <span className="text-label-md text-on-surface-variant block truncate font-normal">
                    {c.members} {c.members === 1 ? 'member' : 'members'} ·{' '}
                    {formatUGX(c.collected)} collected
                    {toNumber(c.outstanding) > 0
                      ? ` · ${formatUGX(c.outstanding)} outstanding`
                      : ''}
                  </span>
                </span>
                <span className="hidden w-28 shrink-0 sm:block">
                  <ProgressBar
                    value={r}
                    tone={r >= 80 ? 'tertiary' : r >= 40 ? 'secondary' : 'error'}
                    label={`${c.name} collection rate`}
                  />
                </span>
                <span className="tabular text-body-md text-on-surface w-12 shrink-0 text-right font-bold">
                  {r.toFixed(0)}%
                </span>
                <Icon name="chevron_right" size={19} className="text-on-surface-variant shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * Recent activity
 * ------------------------------------------------------------------------ */

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
    <Panel
      title="Recent Activity"
      icon="history"
      action={<ViewAllLink href="/staff/audit" />}
      className="max-h-[520px]"
      padded={false}
      bodyClassName="flex min-h-0 flex-col"
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon="history"
          title="No activity yet"
          description="Member registrations, savings and loan decisions will appear here."
        />
      ) : (
        <ScrollArea controls="edge" wrapperClassName="min-h-0 flex-1" className="p-5">
          <ol className="space-y-0">
          {rows.map((a, i) => (
            <li key={a.id} className="flex gap-3.5">
              <div className="relative flex shrink-0 flex-col items-center">
                <span
                  className={clsx(
                    'relative z-10 flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-surface',
                    activityTone(a.action),
                  )}
                >
                  <Icon name={activityIcon(a.action)} size={16} />
                </span>
                {i < rows.length - 1 ? (
                  <span className="w-px flex-1 bg-outline-variant" aria-hidden="true" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 pb-5">
                <p className="text-body-md text-on-surface">{a.summary}</p>
                <p className="mt-1 text-label-md font-normal text-on-surface-variant">
                  {a.actor_name} · {formatAgo(a.created_at)}
                </p>
              </div>
            </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </Panel>
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
  if (action.startsWith('member.')) return 'bg-secondary-fixed text-on-secondary-fixed-variant';
  if (action.startsWith('savings.')) return 'bg-tertiary-fixed text-tertiary';
  if (action.startsWith('transaction.reversed')) return 'bg-error-container text-error';
  return 'bg-primary-fixed text-primary';
}

/* ------------------------------------------------------------------------ *
 * Pending loan applications
 * ------------------------------------------------------------------------ */

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
  const canReview = can(user, 'loans.assess');

  return (
    <Panel
      title="Pending Loan Applications"
      icon="assignment"
      subtitle={rows.length > 0 ? `${rows.length} awaiting a decision` : undefined}
      action={<ViewAllLink href="/staff/loans?status=applied" />}
      padded={false}
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon="done_all"
          title="No applications waiting"
          description="Every loan application has been reviewed."
        />
      ) : (
        <>
          {/* Mobile: cards. A five-column table at 360px is unreadable. */}
          <ul className="divide-y divide-outline-variant/70 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/staff/loans/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-container-low"
                >
                  <Avatar name={r.members?.full_name} src={r.members?.photo_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-md font-semibold text-on-surface">
                      {r.members?.full_name ?? 'Unknown member'}
                    </p>
                    <p className="tabular truncate text-label-md font-normal text-on-surface-variant">
                      {r.members?.member_no} · {r.loan_products?.name}
                    </p>
                    <p className="mt-1 text-label-md font-normal text-on-surface-variant">
                      {formatDate(r.applied_on)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money value={r.principal} className="text-body-md font-bold text-on-surface" />
                    <p className="mt-1.5">
                      <Badge tone={r.status === 'applied' ? 'neutral' : 'warning'}>
                        {LOAN_STATUS_LABELS[r.status]}
                      </Badge>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <DataTable
              className="rounded-none border-0 shadow-none"
              head={
                <>
                  <th>Applicant</th>
                  <th>Loan type</th>
                  <th className="text-right">Amount</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </>
              }
            >
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.members?.full_name} src={r.members?.photo_url} size={34} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-on-surface">
                          {r.members?.full_name ?? 'Unknown member'}
                        </div>
                        <div className="tabular text-label-md font-normal text-on-surface-variant">
                          {r.members?.member_no}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-on-surface-variant">{r.loan_products?.name ?? '—'}</td>
                  <td className="tabular text-right font-bold">{formatUGX(r.principal)}</td>
                  <td className="whitespace-nowrap text-on-surface-variant">
                    {formatDate(r.applied_on)}
                  </td>
                  <td>
                    <Badge tone={r.status === 'applied' ? 'neutral' : 'warning'} dot>
                      {LOAN_STATUS_LABELS[r.status]}
                    </Badge>
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/staff/loans/${r.id}`}
                      className="inline-flex h-9 items-center gap-1 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
                    >
                      {canReview ? 'Review' : 'View'}
                      <Icon name="chevron_right" size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * Collections trend
 * ------------------------------------------------------------------------ */

async function Collections() {
  const points = await getCollectionsTrend(6);
  const thisMonth = points[points.length - 1];
  const total = thisMonth
    ? toNumber(thisMonth.savings) + toNumber(thisMonth.repayments) + toNumber(thisMonth.shares)
    : 0;

  return (
    <Panel
      title="Collections Overview"
      subtitle="Savings, repayments and shares over six months"
      icon="insights"
      action={
        <div className="text-right">
          <p className="text-label-md font-normal text-on-surface-variant">This month</p>
          <Money value={total} className="text-button-text font-bold text-on-surface" />
        </div>
      }
    >
      <TrendChart points={points} />
    </Panel>
  );
}
