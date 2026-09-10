import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getCategoryAnalytics, getSavingsDashboard } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { documentName } from '@/lib/print';
import { Badge, Icon, Money, PageTitle, ProgressBar } from '@/components/ui/primitives';
import { EmptyState, ErrorState, StatGridSkeleton } from '@/components/ui/states';
import { StatementRange } from '@/components/StatementRange';
import {
  SAVINGS_FREQUENCY_ADVERB,
  SAVINGS_FREQUENCY_LABELS,
  categoryTier,
} from '@/lib/categories';
import { formatDate, monthStart, toISODate } from '@/lib/format';
import { formatAmount, formatUGX, percent, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import { ScrollRow } from '@/components/ui/scroll';
import type { SavingsCategoryAnalytics, SavingsDashboard } from '@/types/db';

export const metadata: Metadata = { title: 'Savings' };

/**
 * The savings dashboard — sections 13 and 14 of the brief.
 *
 * Members by savings category, expected against collected, the schedule counts
 * by status, and a per-category collection rate. Every figure is an aggregate
 * over member schedules and the ledger, computed in two round trips. Where the
 * database has nothing to report — a category with no members, a period with no
 * schedules — the screen says so rather than filling the space with a
 * plausible-looking number.
 */
export default async function StaffSavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePermission('savings.view');
  const sp = await searchParams;

  const today = new Date();
  const from = isDate(sp.from) ? sp.from! : monthStart(today);
  const to = isDate(sp.to) ? sp.to! : toISODate(today);

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageTitle
          title="Savings"
          subtitle="What the membership is expected to save, and what has actually come in."
          action={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/staff/savings/schedules"
                className="bg-surface text-primary hover:bg-surface-container-high h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold shadow-neu-sm transition-colors"
              >
                <Icon name="calendar_month" size={20} />
                <span className="hidden sm:inline">Schedules</span>
                <span className="sm:hidden">Sched.</span>
              </Link>
              {can(user.role, 'savings.record') ? (
                <Link
                  href="/staff/savings/collect"
                  className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold transition-colors"
                >
                  <Icon name="point_of_sale" size={20} />
                  <span className="hidden sm:inline">Collect savings</span>
                  <span className="sm:hidden">Collect</span>
                </Link>
              ) : null}
            </div>
          }
        />

        <StatementRange from={from} to={to} />
      </div>

      <Suspense key={`${from}-${to}`} fallback={<StatGridSkeleton />}>
        <Board from={from} to={to} generatedBy={user.fullName} />
      </Suspense>
    </div>
  );
}

async function Board({
  from,
  to,
  generatedBy,
}: {
  from: string;
  to: string;
  generatedBy: string;
}) {
  const [dash, analytics] = await Promise.all([
    getSavingsDashboard(from, to),
    getCategoryAnalytics(from, to),
  ]);

  if (!dash) {
    return (
      <ErrorState
        title="Unable to load the savings dashboard"
        description="Please check your connection and try again."
      />
    );
  }

  const rate = percent(dash.collected_savings, dash.expected_savings);

  return (
    <div className="flex flex-col gap-6">
      <PrintLetterhead
        title="Savings Dashboard"
        subtitle={`${formatDate(from)} to ${formatDate(to)}`}
        generatedBy={generatedBy}
        meta={[
          { label: 'Members', value: String(dash.total_members) },
          { label: 'Expected', value: formatUGX(dash.expected_savings) },
          { label: 'Collected', value: formatUGX(dash.collected_savings) },
          { label: 'Outstanding', value: formatUGX(dash.outstanding_savings) },
          { label: 'Rate', value: `${rate.toFixed(2)}%` },
        ]}
      />

      {/* ------------------------------------------------------- headline */}
      <section className="gap-gutter grid grid-cols-2 lg:grid-cols-4">
        <Tile label="Total savings held" money={dash.total_savings} icon="savings" />
        <Tile label="Expected this period" money={dash.expected_savings} icon="calendar_month" />
        <Tile
          label="Collected"
          money={dash.collected_savings}
          icon="check_circle"
          tone="text-tertiary"
        />
        <div className="bg-surface shadow-card rounded-xl p-5">
          <div className="bg-primary-fixed text-primary mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg">
            <Icon name="assessment" size={20} />
          </div>
          <p className="text-label-md font-label-md text-on-surface-variant mb-1">
            Collection rate
          </p>
          <p className="text-display-currency font-display-currency text-on-surface tabular">
            {rate.toFixed(2)}%
          </p>
          <ProgressBar
            value={rate}
            tone={rate >= 80 ? 'tertiary' : rate >= 40 ? 'secondary' : 'error'}
            label="Collection rate"
            className="mt-3"
          />
        </div>
      </section>

      {/* ------------------------------------------- schedules, by status */}
      <section className="bg-surface shadow-card grid grid-cols-2 gap-4 rounded-xl p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Count label="Paid" value={dash.paid_schedules} tone="text-tertiary" />
        <Count label="Partial" value={dash.partial_schedules} />
        <Count label="Pending" value={dash.pending_schedules} />
        <Count label="Missed" value={dash.missed_schedules} tone="text-error" />
        <Count label="Waived" value={dash.waived_schedules} />
        <Count label="Due today" value={dash.due_today} />
      </section>

      {/* ------------------------------------------------ savings tiers */}
      <CategoryTiles dash={dash} />

      {/* ------------------------------------------- category analytics */}
      <CategoryAnalytics analytics={analytics} from={from} to={to} />

      {/* ------------------------------------------------ share tiers */}
      <ShareTiles dash={dash} />

      {/* Members with nothing expected of them are a real operational
        problem, not a rounding error — surface them where a manager will act. */}
      {dash.uncategorised_members > 0 ? (
        <section className="bg-secondary-fixed text-on-secondary-fixed flex flex-wrap items-start justify-between gap-3 rounded-xl p-4">
          <div className="flex min-w-0 items-start gap-3">
            <Icon name="info" size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-button-text font-button-text">
                {dash.uncategorised_members}{' '}
                {dash.uncategorised_members === 1 ? 'member has' : 'members have'} no savings
                category
              </p>
              <p className="text-body-md font-body-md mt-0.5">
                No schedule is raised for them and nothing is expected, so they will never appear
                as being in arrears.
              </p>
            </div>
          </div>
          <Link
            href="/staff/members?category=none"
            className="text-label-md font-label-md h-touch-target-min inline-flex shrink-0 items-center font-semibold normal-case underline"
          >
            Review them →
          </Link>
        </section>
      ) : null}

      {toNumber(dash.total_arrears) > 0 ? (
        <section className="bg-error-container text-on-error-container flex items-start gap-3 rounded-xl p-4">
          <Icon name="warning" size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-button-text font-button-text">
              {formatUGX(dash.total_arrears)} in savings arrears
            </p>
            <p className="text-body-md font-body-md mt-0.5">
              From cycles whose due date has already passed. Partial and missed schedules stay
              visible until they are settled or waived.
            </p>
            <Link
              href="/staff/savings/schedules?status=missed"
              className="text-label-md font-label-md mt-2 inline-block font-semibold normal-case underline"
            >
              Review outstanding schedules →
            </Link>
          </div>
        </section>
      ) : null}

      <PrintFooter note="Every figure is computed from member schedules and the transaction ledger." />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/** Membership and expected value by savings category. */
function CategoryTiles({ dash }: { dash: SavingsDashboard }) {
  if (dash.savings_categories.length === 0) {
    return (
      <section className="bg-surface rounded-xl shadow-neu-sm print:hidden">
        <EmptyState
          icon="workspace_premium"
          title="No savings categories yet"
          description="Create the categories members save under before schedules can be raised."
          action={
            <Link
              href="/staff/categories"
              className="bg-surface text-primary h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold shadow-neu-sm"
            >
              <Icon name="workspace_premium" size={20} />
              Open category management
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-button-text font-button-text text-on-surface">Savings categories</h2>
        <Link
          href="/staff/categories"
          className="text-label-md font-label-md text-primary normal-case hover:underline print:hidden"
        >
          Manage categories →
        </Link>
      </div>

      <ul className="gap-gutter grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {dash.savings_categories.map((c) => {
          const tier = categoryTier(c.code);
          return (
            <li key={c.id} className="bg-surface shadow-card flex flex-col gap-3 rounded-xl p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="bg-primary-fixed text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                    <Icon name={tier.icon} size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                      {c.name}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                      {formatUGX(c.amount)} {SAVINGS_FREQUENCY_ADVERB[c.frequency]}
                    </p>
                  </div>
                </div>
                {c.status === 'inactive' ? <Badge tone="neutral">Retired</Badge> : null}
              </div>

              <dl className="border-outline-variant grid grid-cols-2 gap-2 border-t pt-3">
                <div className="min-w-0">
                  <dt className="text-label-md font-label-md text-on-surface-variant truncate">
                    Members
                  </dt>
                  <dd className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface tabular">
                    {c.members}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-label-md font-label-md text-on-surface-variant truncate">
                    Expected each {SAVINGS_FREQUENCY_LABELS[c.frequency].toLowerCase() === 'weekly' ? 'week' : 'month'}
                  </dt>
                  <dd className="text-body-lg font-body-lg text-on-surface tabular font-bold">
                    <Money value={c.expected_per_cycle} compact />
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Section 14 — expected, collected, outstanding and rate, per category. */
function CategoryAnalytics({
  analytics,
  from,
  to,
}: {
  analytics: SavingsCategoryAnalytics | null;
  from: string;
  to: string;
}) {
  if (!analytics || analytics.rows.length === 0) return null;

  const csv = [
    [
      'Category',
      'Frequency',
      'Members',
      'Expected',
      'Collected',
      'Outstanding',
      'Paid',
      'Partial',
      'Missed',
      'Collection rate %',
    ],
    ...analytics.rows.map((r) => [
      r.name,
      r.frequency,
      r.members,
      formatAmount(r.expected),
      formatAmount(r.collected),
      formatAmount(r.outstanding),
      r.paid_schedules,
      r.partial_schedules,
      r.missed_schedules,
      formatAmount(r.collection_rate),
    ]),
    [],
    [
      'TOTAL',
      '',
      analytics.totals.members,
      formatAmount(analytics.totals.expected),
      formatAmount(analytics.totals.collected),
      formatAmount(analytics.totals.outstanding),
      '',
      '',
      '',
      formatAmount(analytics.collection_rate),
    ],
  ];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-button-text font-button-text text-on-surface">
          Category performance
        </h2>
        <div className="print:hidden">
          <ExportButtons
            rows={csv}
            filename={`savings-categories-${from}-to-${to}`}
            documentTitle={documentName('Savings by Category', `${from} to ${to}`)}
          />
        </div>
      </div>

      <div className="bg-surface shadow-card overflow-hidden rounded-xl">
        <ScrollRow arrows="overlay" label="Table, scrolls sideways">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                <th className="p-4 font-semibold">Category</th>
                <th className="p-4 text-center font-semibold">Members</th>
                <th className="p-4 text-right font-semibold">Expected</th>
                <th className="p-4 text-right font-semibold">Collected</th>
                <th className="p-4 text-right font-semibold">Outstanding</th>
                <th className="p-4 font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
              {analytics.rows.map((r) => (
                <tr key={r.savings_category_id} className="hover:bg-surface-container-low transition-colors">
                  <td className="p-4">
                    <div className="text-on-surface font-semibold">{r.name}</div>
                    <div className="text-on-surface-variant text-xs">
                      {formatUGX(r.amount)} {SAVINGS_FREQUENCY_ADVERB[r.frequency]}
                    </div>
                  </td>
                  <td className="tabular p-4 text-center">{r.members}</td>
                  <td className="tabular p-4 text-right">{formatUGX(r.expected)}</td>
                  <td className="tabular text-tertiary p-4 text-right font-semibold">
                    {formatUGX(r.collected)}
                  </td>
                  <td
                    className={clsx(
                      'tabular p-4 text-right',
                      toNumber(r.outstanding) > 0 && 'text-error font-semibold',
                    )}
                  >
                    {formatUGX(r.outstanding)}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        value={toNumber(r.collection_rate)}
                        tone={toNumber(r.collection_rate) >= 80 ? 'tertiary' : 'secondary'}
                        label={`${r.name} collection rate`}
                        className="w-20"
                      />
                      <span className="tabular text-xs">{r.collection_rate}%</span>
                    </div>
                    <span className="text-on-surface-variant text-xs">
                      {r.paid_schedules} paid · {r.partial_schedules} partial ·{' '}
                      {r.missed_schedules} missed
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-container-low text-body-md font-body-md text-on-surface border-outline-variant border-t font-semibold">
                <td className="p-4">Total</td>
                <td className="tabular p-4 text-center">{analytics.totals.members}</td>
                <td className="tabular p-4 text-right">{formatUGX(analytics.totals.expected)}</td>
                <td className="tabular p-4 text-right">{formatUGX(analytics.totals.collected)}</td>
                <td className="tabular p-4 text-right">
                  {formatUGX(analytics.totals.outstanding)}
                </td>
                <td className="tabular p-4">{analytics.collection_rate}%</td>
              </tr>
            </tfoot>
          </table>
        </ScrollRow>
      </div>
    </section>
  );
}

/** Take-up of each share category, and who is running out of time. */
function ShareTiles({ dash }: { dash: SavingsDashboard }) {
  if (dash.share_categories.length === 0) return null;

  return (
    <section>
      <h2 className="text-button-text font-button-text text-on-surface mb-3">
        Share categories
      </h2>
      <ul className="gap-gutter grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {dash.share_categories.map((c) => {
          const tier = categoryTier(c.code);
          const rate = percent(c.qualified, c.members);
          return (
            <li key={c.id} className="bg-surface shadow-card flex flex-col gap-3 rounded-xl p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="bg-primary-fixed text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                    <Icon name={tier.icon} size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                      {c.name}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                      {c.required_shares} {c.required_shares === 1 ? 'share' : 'shares'} ·{' '}
                      {formatUGX(c.required_amount)}
                    </p>
                  </div>
                </div>
                {c.lapsed > 0 ? <Badge tone="error">{c.lapsed} lapsed</Badge> : null}
              </div>

              <div>
                <p className="text-label-md font-label-md text-on-surface-variant mb-1.5 normal-case">
                  {c.qualified} of {c.members} {c.members === 1 ? 'member' : 'members'} qualified
                </p>
                <ProgressBar
                  value={rate}
                  tone={rate >= 80 ? 'tertiary' : 'secondary'}
                  label={`${c.name} qualification rate`}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Tile({
  label,
  money,
  icon,
  tone,
}: {
  label: string;
  money: unknown;
  icon: string;
  tone?: string;
}) {
  return (
    <div className="bg-surface shadow-card rounded-xl p-5">
      <div className="bg-primary-fixed text-primary mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg">
        <Icon name={icon} size={20} />
      </div>
      <p className="text-label-md font-label-md text-on-surface-variant mb-1">{label}</p>
      <Money
        value={money}
        compact
        className={clsx('text-display-currency font-display-currency', tone ?? 'text-on-surface')}
      />
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-label-md font-label-md text-on-surface-variant truncate">{label}</p>
      <p
        className={clsx(
          'text-headline-lg-mobile font-headline-lg-mobile tabular mt-0.5',
          tone ?? 'text-on-surface',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function isDate(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
