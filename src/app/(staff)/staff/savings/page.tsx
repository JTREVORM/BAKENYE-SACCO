import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getSavingsDashboard } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { Icon, Money, PageTitle } from '@/components/ui/primitives';
import { ErrorState, StatGridSkeleton } from '@/components/ui/states';
import { StatementRange } from '@/components/StatementRange';
import { formatDate, monthStart, toISODate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import { clsx } from '@/lib/clsx';

export const metadata: Metadata = { title: 'Savings' };

/**
 * The savings dashboard.
 *
 * It used to lead with expected-against-collected, a collection rate and a
 * per-tier breakdown. Savings are open, so none of those exist: nothing is
 * expected, nothing is outstanding, there is no rate to collect at and no tier
 * to group anyone into.
 *
 * What a manager is told instead is what came in: how much was saved over the
 * period, by how many members, across how many deposits, and how that compares
 * with what the SACCO holds altogether. Every figure is an aggregate over the
 * one ledger.
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
          subtitle="What members saved over the period. Savings are open — there is no target and no arrears."
          action={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/staff/savings/records"
                className="bg-surface text-primary hover:bg-surface-container-high h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold shadow-neu-sm transition-colors"
              >
                <Icon name="calendar_month" size={20} />
                <span className="hidden sm:inline">Savings records</span>
                <span className="sm:hidden">Records</span>
              </Link>
              {can(user, 'savings.record') ? (
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
  const dash = await getSavingsDashboard(from, to);

  if (!dash) {
    return (
      <ErrorState
        title="Unable to load the savings dashboard"
        description="Please check your connection and try again."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PrintLetterhead
        title="Savings Dashboard"
        subtitle={`${formatDate(from)} to ${formatDate(to)}`}
        generatedBy={generatedBy}
        meta={[
          { label: 'Active members', value: String(dash.total_members) },
          { label: 'Members who saved', value: String(dash.saving_members) },
          { label: 'Deposits', value: String(dash.deposit_count) },
          { label: 'Saved in period', value: formatUGX(dash.collected_savings) },
          { label: 'Held in savings', value: formatUGX(dash.total_savings) },
        ]}
      />

      {/* ------------------------------------------------------- headline */}
      <section className="gap-gutter grid grid-cols-2 lg:grid-cols-4">
        <Tile label="Total savings held" money={dash.total_savings} icon="savings" />
        <Tile
          label="Saved this period"
          money={dash.collected_savings}
          icon="check_circle"
          tone="text-tertiary"
        />
        <Tile label="Average deposit" money={dash.average_deposit} icon="calculate" />
        <Tile label="Largest deposit" money={dash.largest_deposit} icon="trending_up" />
      </section>

      {/* ------------------------------------------------ activity counts */}
      <section className="bg-surface shadow-card grid grid-cols-2 gap-4 rounded-xl p-4 sm:grid-cols-4">
        <Count label="Members who saved" value={dash.saving_members} tone="text-tertiary" />
        <Count label="Deposits" value={dash.deposit_count} />
        <Count label="Active members" value={dash.total_members} />
        <Count label="Savers today" value={dash.savers_today} />
      </section>

      {/* -------------------------------------------------------- today */}
      <section className="bg-surface shadow-card flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
        <div className="min-w-0">
          <p className="text-label-md font-label-md text-on-surface-variant">Taken today</p>
          <Money
            value={dash.collected_today}
            className="text-display-currency font-display-currency text-on-surface"
          />
        </div>
        <Link
          href="/staff/savings/collect"
          className="bg-primary text-on-primary h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold"
        >
          <Icon name="point_of_sale" size={20} />
          Collect savings
        </Link>
      </section>

      {/* The one thing worth saying about the rules, said once. */}
      <section className="bg-secondary-fixed text-on-secondary-fixed flex items-start gap-3 rounded-xl p-4">
        <Icon name="info" size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-button-text font-button-text">
            Monthly savings are open
          </p>
          <p className="text-body-md font-body-md mt-0.5">
            A member saves any amount they choose, as often as they like. There is no monthly
            target, so a month without a deposit raises no arrears, no overdue amount and no
            penalty — and nobody is classified by what they save.
          </p>
        </div>
      </section>

      <PrintFooter note="Every figure is computed from the member transaction ledger." />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------ */

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
