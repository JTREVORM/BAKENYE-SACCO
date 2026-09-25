import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { documentName } from '@/lib/print';
import { can } from '@/lib/rbac';
import { PageTitle, Icon, Money, Avatar } from '@/components/ui/primitives';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { DateRangeTabs } from './DateRangeTabs';
import { formatUGX, toNumber } from '@/lib/money';
import { formatDate, monthStart, toISODate } from '@/lib/format';
import { depositCount } from '@/lib/savings';
import { clsx } from '@/lib/clsx';
import type { SavingsPerformanceRow } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

export const metadata: Metadata = { title: 'Savings activity' };

/**
 * Savings activity.
 *
 * This report used to score members against their category's target and rank
 * them on compliance. Monthly savings are open, so there is no target, nothing
 * to be short of and nobody to rank. What is left is the question the SACCO
 * actually has: over this period, who saved, how often, and how much?
 *
 * Every figure comes from `savings_performance()`, which reads the ledger, so
 * it agrees with each member's own statement to the shilling.
 */
export default async function SavingsActivityPage({
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
    <div>
      <div className="print:hidden">
        <PageTitle
          title="Savings activity"
          subtitle="Who saved over the period, how often, and how much. Savings are open — there is no target to measure anyone against."
          action={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/staff/savings/collect"
                className="bg-surface text-primary hover:bg-surface-container-high h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold shadow-neu-sm transition-colors"
              >
                <Icon name="point_of_sale" size={20} />
                <span className="hidden sm:inline">Collect savings</span>
                <span className="sm:hidden">Collect</span>
              </Link>
              {can(user, 'savings.record') ? (
                <Link
                  href="/staff/savings/record"
                  className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold transition-colors"
                >
                  <Icon name="add" size={20} />
                  <span className="hidden sm:inline">Record savings</span>
                  <span className="sm:hidden">Record</span>
                </Link>
              ) : null}
            </div>
          }
        />
      </div>

      <div className="print:hidden">
        <DateRangeTabs from={from} to={to} />
      </div>

      <Suspense key={`${from}-${to}`} fallback={<TableSkeleton rows={8} cols={5} />}>
        <Activity
          from={from}
          to={to}
          canRecord={can(user, 'savings.record')}
          generatedBy={user.fullName}
        />
      </Suspense>
    </div>
  );
}

async function Activity({
  from,
  to,
  canRecord,
  generatedBy,
}: {
  from: string;
  to: string;
  canRecord: boolean;
  generatedBy: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('savings_performance', {
    p_from: from,
    p_to: to,
  });

  if (error) {
    return (
      <ErrorState
        title="Unable to load savings activity"
        description="Please check your connection and try again."
      />
    );
  }

  const rows = (data ?? []) as SavingsPerformanceRow[];
  const savers = rows.filter((r) => toNumber(r.deposits) > 0);

  const totals = rows.reduce(
    (acc, r) => ({
      saved: acc.saved + toNumber(r.total_saved),
      deposits: acc.deposits + toNumber(r.deposits),
    }),
    { saved: 0, deposits: 0 },
  );
  const average = totals.deposits > 0 ? Math.round(totals.saved / totals.deposits) : 0;

  const csv = [
    ['Member No', 'Member', 'Deposits', 'Total saved', 'First saved', 'Last saved', 'Savings balance'],
    ...savers.map((r) => [
      r.member_no,
      r.full_name,
      r.deposits,
      toNumber(r.total_saved),
      r.first_saved_on ?? '',
      r.last_saved_on ?? '',
      toNumber(r.savings_balance),
    ]),
    [],
    ['TOTAL', '', totals.deposits, totals.saved],
  ];

  return (
    <div className="mt-6 flex flex-col gap-6">
      <PrintLetterhead
        title="Savings Activity"
        subtitle="Open monthly savings — no target, no arrears"
        generatedBy={generatedBy}
        meta={[
          { label: 'Period', value: `${formatDate(from)} to ${formatDate(to)}` },
          { label: 'Members who saved', value: String(savers.length) },
          { label: 'Deposits', value: String(totals.deposits) },
          { label: 'Total saved', value: formatUGX(totals.saved) },
          { label: 'Average deposit', value: formatUGX(average) },
        ]}
      />

      <div className="flex justify-end print:hidden">
        <ExportButtons
          rows={csv}
          filename={`savings-activity-${from}-to-${to}`}
          documentTitle={documentName('Savings Activity', `${from} to ${to}`)}
        />
      </div>

      {/* Period totals */}
      <section className="gap-gutter grid grid-cols-2 lg:grid-cols-4">
        <Total label="Total saved" value={totals.saved} tone="text-tertiary" />
        <div className="bg-surface shadow-card rounded-xl p-5">
          <p className="text-label-md font-label-md text-on-surface-variant mb-1">Deposits</p>
          <p className="text-display-currency font-display-currency text-on-surface tabular">
            {totals.deposits}
          </p>
        </div>
        <div className="bg-surface shadow-card rounded-xl p-5">
          <p className="text-label-md font-label-md text-on-surface-variant mb-1">
            Members who saved
          </p>
          <p className="text-display-currency font-display-currency text-on-surface tabular">
            {savers.length}
          </p>
        </div>
        <Total label="Average deposit" value={average} />
      </section>

      {savers.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="savings"
            title="No savings recorded in this period"
            description={
              canRecord
                ? 'Record savings as members bring them in. Nothing is due, so nothing is missing.'
                : 'Nothing has been recorded for this date range.'
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden print:hidden">
            {savers.map((r) => (
              <li
                key={r.member_id}
                className="bg-surface border-surface-container shadow-card rounded-xl border p-3"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={r.full_name} size={44} />
                  <Link
                    href={`/staff/members/${r.member_id}`}
                    className="min-h-touch-target-min flex min-w-0 flex-1 flex-col justify-center"
                  >
                    <span className="text-body-lg font-body-lg text-primary block truncate font-semibold">
                      {r.full_name}
                    </span>
                    <span className="text-label-md font-label-md text-on-surface-variant tabular block truncate normal-case">
                      {r.member_no} · {depositCount(toNumber(r.deposits))}
                      {r.last_saved_on ? ` · last ${formatDate(r.last_saved_on)}` : ''}
                    </span>
                  </Link>
                  {canRecord ? (
                    <Link
                      href={`/staff/savings/record?member=${r.member_id}`}
                      aria-label={`Record savings for ${r.full_name}`}
                      className="bg-primary text-on-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                    >
                      <Icon name="add" size={20} />
                    </Link>
                  ) : null}
                </div>

                <dl className="border-outline-variant mt-3 grid grid-cols-2 gap-2 border-t pt-3">
                  <Cell label="Saved in period" value={r.total_saved} tone="text-tertiary" />
                  <Cell label="Total savings" value={r.savings_balance} />
                </dl>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="bg-surface shadow-card hidden overflow-hidden rounded-xl lg:block">
            <ScrollRow arrows="overlay" label="Table, scrolls sideways">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">Member</th>
                    <th className="p-4 text-center font-semibold">Deposits</th>
                    <th className="p-4 text-right font-semibold">Saved in period</th>
                    <th className="p-4 font-semibold">Last saved</th>
                    <th className="p-4 text-right font-semibold">Total savings</th>
                    {canRecord ? <th className="p-4 text-center font-semibold">Action</th> : null}
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {savers.map((r) => (
                    <tr
                      key={r.member_id}
                      className="hover:bg-surface-container-low transition-colors"
                    >
                      <td className="p-4">
                        <Link
                          href={`/staff/members/${r.member_id}`}
                          className="min-h-touch-target-min flex items-center gap-3"
                        >
                          <Avatar name={r.full_name} size={32} />
                          <div className="min-w-0">
                            <div className="text-primary truncate font-semibold">
                              {r.full_name}
                            </div>
                            <div className="text-on-surface-variant tabular text-xs">
                              {r.member_no}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="tabular p-4 text-center">{toNumber(r.deposits)}</td>
                      <td className="tabular text-tertiary p-4 text-right font-semibold">
                        {formatUGX(r.total_saved)}
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {r.last_saved_on ? formatDate(r.last_saved_on) : '—'}
                      </td>
                      <td className="tabular p-4 text-right">{formatUGX(r.savings_balance)}</td>
                      {canRecord ? (
                        <td className="p-4 text-center">
                          <Link
                            href={`/staff/savings/record?member=${r.member_id}`}
                            className="bg-surface-container-high hover:bg-surface-container text-label-md font-label-md text-primary inline-flex h-touch-target-min items-center rounded-lg px-3 font-semibold transition-colors shadow-neu-sm"
                          >
                            Record
                          </Link>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRow>
          </div>
        </>
      )}

      <PrintFooter />
    </div>
  );
}

function Total({
  label,
  value,
  tone = 'text-on-surface',
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="bg-surface shadow-card rounded-xl p-5">
      <p className="text-label-md font-label-md text-on-surface-variant mb-1">{label}</p>
      <Money
        value={value}
        compact
        className={clsx('text-display-currency font-display-currency', tone)}
      />
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd
        className={clsx('text-body-md font-body-md truncate font-semibold', tone ?? 'text-on-surface')}
      >
        <Money value={value} />
      </dd>
    </div>
  );
}

function isDate(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
