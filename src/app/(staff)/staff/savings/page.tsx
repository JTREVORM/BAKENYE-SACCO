import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { PageTitle, Icon, Money, Avatar, ProgressBar } from '@/components/ui/primitives';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { SavingsKindTabs } from './SavingsKindTabs';
import { OpenPeriodsButton } from './OpenPeriodsButton';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { monthStart, toISODate } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { SavingsKind, SavingsPerformanceRow } from '@/types/db';

export const metadata: Metadata = { title: 'Savings' };

/**
 * Savings register.
 *
 * The collection sheet a cashier works from: every active member, what they
 * were expected to save in the period, what they actually paid, and how far
 * behind they are. `savings_performance()` computes it in one query rather than
 * a row-per-member round trip.
 */
export default async function StaffSavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission('savings.view');
  const sp = await searchParams;
  const kind: SavingsKind = sp.kind === 'monthly' ? 'monthly' : 'weekly';

  const today = new Date();
  const from = isDate(sp.from) ? sp.from! : monthStart(today);
  const to = isDate(sp.to) ? sp.to! : toISODate(today);

  return (
    <div>
      <PageTitle
        title="Savings"
        subtitle="Contribution performance across the membership."
        action={
          <div className="flex flex-wrap gap-2">
            {can(user.role, 'savings.record') ? (
              <>
                <OpenPeriodsButton kind={kind} />
                <Link
                  href="/staff/savings/record"
                  className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold transition-colors"
                >
                  <Icon name="add" size={20} />
                  <span className="hidden sm:inline">Record savings</span>
                  <span className="sm:hidden">Record</span>
                </Link>
              </>
            ) : null}
          </div>
        }
      />

      <SavingsKindTabs kind={kind} from={from} to={to} />

      <Suspense key={`${kind}-${from}-${to}`} fallback={<TableSkeleton rows={8} cols={6} />}>
        <Performance kind={kind} from={from} to={to} canRecord={can(user.role, 'savings.record')} />
      </Suspense>
    </div>
  );
}

async function Performance({
  kind,
  from,
  to,
  canRecord,
}: {
  kind: SavingsKind;
  from: string;
  to: string;
  canRecord: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('savings_performance', {
    p_kind: kind,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return (
      <ErrorState
        title="Unable to load savings performance"
        description="Please check your connection and try again."
      />
    );
  }

  const rows = (data ?? []) as SavingsPerformanceRow[];
  const withActivity = rows.filter((r) => r.periods > 0);

  const totals = rows.reduce(
    (acc, r) => ({
      expected: acc.expected + toNumber(r.expected),
      paid: acc.paid + toNumber(r.paid),
      balance: acc.balance + toNumber(r.balance),
    }),
    { expected: 0, paid: 0, balance: 0 },
  );

  return (
    <div className="mt-6 flex flex-col gap-6">
      {/* Period totals */}
      <section className="gap-gutter grid grid-cols-2 lg:grid-cols-4">
        <Total label="Expected" value={totals.expected} />
        <Total label="Collected" value={totals.paid} tone="text-tertiary" />
        <Total label="Shortfall" value={totals.balance} tone="text-error" />
        <div className="bg-surface border-outline-variant/30 elev-1 rounded-xl border p-5">
          <p className="text-label-md font-label-md text-on-surface-variant mb-1 uppercase tracking-wider">
            Collection rate
          </p>
          <p className="text-display-currency font-display-currency text-on-surface tabular">
            {Math.round(percent(totals.paid, totals.expected))}%
          </p>
          <ProgressBar
            value={percent(totals.paid, totals.expected)}
            tone="tertiary"
            label="Collection rate"
            className="mt-3"
          />
        </div>
      </section>

      {withActivity.length === 0 ? (
        <div className="bg-surface border-outline-variant/30 rounded-xl border">
          <EmptyState
            icon="savings"
            title="No savings activity in this period"
            description={
              canRecord
                ? 'Open the periods for this cycle, then record contributions as members pay.'
                : 'Nothing has been recorded for this date range.'
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {withActivity.map((r) => (
              <li
                key={r.member_id}
                className="bg-surface border-surface-container elev-1 rounded-xl border p-3"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={r.full_name} size={44} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/staff/members/${r.member_id}`}
                      className="text-body-lg font-body-lg text-primary block truncate font-semibold"
                    >
                      {r.full_name}
                    </Link>
                    <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                      {r.member_no} · {r.periods} {r.periods === 1 ? 'period' : 'periods'}
                    </p>
                  </div>
                  {canRecord ? (
                    <Link
                      href={`/staff/savings/record?member=${r.member_id}&kind=${kind}`}
                      aria-label={`Record savings for ${r.full_name}`}
                      className="bg-primary text-on-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                    >
                      <Icon name="add" size={20} />
                    </Link>
                  ) : null}
                </div>

                <dl className="border-outline-variant/40 mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                  <Cell label="Expected" value={r.expected} />
                  <Cell label="Paid" value={r.paid} tone="text-tertiary" />
                  <Cell
                    label="Shortfall"
                    value={r.balance}
                    tone={toNumber(r.balance) > 0 ? 'text-error' : undefined}
                  />
                </dl>

                <div className="mt-3">
                  <ProgressBar
                    value={toNumber(r.compliance)}
                    tone={toNumber(r.compliance) >= 80 ? 'tertiary' : 'secondary'}
                    label={`${r.full_name} compliance`}
                  />
                  <p className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
                    {r.paid_periods} paid · {r.missed_periods} missed · {r.compliance}% on target
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="bg-surface border-outline-variant/30 elev-1 hidden overflow-hidden rounded-xl border lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant/50 border-b uppercase tracking-wider">
                    <th className="p-4 font-semibold">Member</th>
                    <th className="p-4 text-center font-semibold">Periods</th>
                    <th className="p-4 text-right font-semibold">Expected</th>
                    <th className="p-4 text-right font-semibold">Paid</th>
                    <th className="p-4 text-right font-semibold">Shortfall</th>
                    <th className="p-4 font-semibold">Compliance</th>
                    {canRecord ? <th className="p-4 text-center font-semibold">Action</th> : null}
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/30 divide-y">
                  {withActivity.map((r) => (
                    <tr key={r.member_id} className="hover:bg-surface-container-lowest transition-colors">
                      <td className="p-4">
                        <Link href={`/staff/members/${r.member_id}`} className="min-h-touch-target-min flex items-center gap-3">
                          <Avatar name={r.full_name} size={32} />
                          <div className="min-w-0">
                            <div className="text-primary truncate font-semibold">{r.full_name}</div>
                            <div className="text-on-surface-variant tabular text-xs">
                              {r.member_no}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="tabular p-4 text-center">{r.periods}</td>
                      <td className="tabular p-4 text-right">{formatUGX(r.expected)}</td>
                      <td className="tabular text-tertiary p-4 text-right font-semibold">
                        {formatUGX(r.paid)}
                      </td>
                      <td
                        className={clsx(
                          'tabular p-4 text-right',
                          toNumber(r.balance) > 0 && 'text-error font-semibold',
                        )}
                      >
                        {formatUGX(r.balance)}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <ProgressBar
                            value={toNumber(r.compliance)}
                            tone={toNumber(r.compliance) >= 80 ? 'tertiary' : 'secondary'}
                            label={`${r.full_name} compliance`}
                            className="w-20"
                          />
                          <span className="tabular text-xs">{r.compliance}%</span>
                        </div>
                        <span className="text-on-surface-variant text-xs">
                          {r.paid_periods} paid · {r.missed_periods} missed
                        </span>
                      </td>
                      {canRecord ? (
                        <td className="p-4 text-center">
                          <Link
                            href={`/staff/savings/record?member=${r.member_id}&kind=${kind}`}
                            className="bg-surface-container-high hover:bg-surface-container border-outline-variant/50 text-label-md font-label-md text-primary inline-flex h-touch-target-min items-center rounded-lg border px-3 font-semibold transition-colors"
                          >
                            Record
                          </Link>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Total({ label, value, tone = 'text-on-surface' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-surface border-outline-variant/30 elev-1 rounded-xl border p-5">
      <p className="text-label-md font-label-md text-on-surface-variant mb-1 uppercase tracking-wider">
        {label}
      </p>
      <Money value={value} compact className={clsx('text-display-currency font-display-currency', tone)} />
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd className={clsx('text-body-md font-body-md truncate font-semibold', tone ?? 'text-on-surface')}>
        <Money value={value} />
      </dd>
    </div>
  );
}

function isDate(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
