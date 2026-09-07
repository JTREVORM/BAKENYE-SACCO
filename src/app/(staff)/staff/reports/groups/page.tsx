import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getActiveGroups } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { Icon, Money, PageTitle, ProgressBar } from '@/components/ui/primitives';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { MemberStatusBadge } from '@/components/ui/status';
import { StatementRange } from '@/components/StatementRange';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { documentName } from '@/lib/print';
import { GroupReportPicker } from './GroupReportPicker';
import { savingDayLabel, SAVING_FREQUENCY_LABELS } from '@/lib/groups';
import { formatDate, formatPhone, monthStart, toISODate } from '@/lib/format';
import { formatAmount, formatUGX, percent, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { GroupReport } from '@/types/db';

export const metadata: Metadata = { title: 'Group report' };

/**
 * Group performance over a date range.
 *
 * The worked example from the brief, computed: 25 members at UGX 20,000 is
 * UGX 500,000 expected; 23 who paid is UGX 460,000 collected and UGX 40,000
 * outstanding. Every one of those figures is a sum over member schedules, which
 * is why the report and the individual statements always agree.
 */
export default async function GroupReportPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission('groups.view');
  const sp = await searchParams;

  const today = new Date();
  const from = isDate(sp.from) ? sp.from! : monthStart(today);
  const to = isDate(sp.to) ? sp.to! : toISODate(today);
  const groups = await getActiveGroups();

  return (
    <div className="space-y-6">
      <Link
        href="/staff/reports"
        className="text-label-md font-label-md text-on-surface-variant hover:text-primary inline-flex items-center gap-1 normal-case print:hidden"
      >
        <Icon name="arrow_back" size={18} />
        Reports
      </Link>

      <div className="print:hidden">
        <PageTitle
          title="Group report"
          subtitle="Expected against collected for one group, member by member."
        />
      </div>

      <div className="flex flex-col gap-4 print:hidden">
        <GroupReportPicker groups={groups} selected={sp.group ?? ''} />
        <StatementRange from={from} to={to} />
      </div>

      {!sp.group ? (
        <div className="bg-surface border-outline-variant rounded-xl border">
          <EmptyState
            icon="groups"
            title="Choose a group"
            description="Pick a group above to see what it was expected to collect and what it actually did."
          />
        </div>
      ) : (
        <Suspense key={`${sp.group}-${from}-${to}`} fallback={<TableSkeleton rows={8} cols={6} />}>
          <Report groupId={sp.group} from={from} to={to} generatedBy={user.fullName} />
        </Suspense>
      )}
    </div>
  );
}

async function Report({
  groupId,
  from,
  to,
  generatedBy,
}: {
  groupId: string;
  from: string;
  to: string;
  generatedBy: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('group_report', {
    p_group_id: groupId,
    p_from: from,
    p_to: to,
  });

  if (error || !data) {
    return (
      <ErrorState
        title="Unable to build this report"
        description="Please check your connection and try again."
      />
    );
  }

  const report = data as unknown as GroupReport;
  const g = report.group;
  const rows = report.rows ?? [];
  const rate = toNumber(report.collection_rate);

  const csv = [
    ['Member number', 'Member', 'Phone', 'Schedules', 'Expected', 'Paid', 'Outstanding', 'Paid', 'Partial', 'Missed'],
    ...rows.map((r) => [
      r.member_no,
      r.full_name,
      r.phone,
      r.schedules,
      formatAmount(r.expected),
      formatAmount(r.paid),
      formatAmount(r.outstanding),
      r.paid_count,
      r.partial_count,
      r.missed_count,
    ]),
    [],
    [
      'TOTAL',
      '',
      '',
      '',
      formatAmount(report.totals.expected),
      formatAmount(report.totals.paid),
      formatAmount(report.totals.outstanding),
    ],
  ];

  return (
    <div className="space-y-6">
      <PrintLetterhead
        title="Group Report"
        subtitle={`${g.name} · ${g.group_code}`}
        generatedBy={generatedBy}
        meta={[
          { label: 'Period', value: `${formatDate(from)} to ${formatDate(to)}` },
          { label: 'Saving day', value: savingDayLabel(g.saving_day) },
          { label: 'Members', value: String(report.totals.members) },
          {
            label: 'Officer',
            value: g.loan_officer_name ?? 'Not assigned',
          },
        ]}
      />

      {/* --------------------------------------------------------- header */}
      <section className="bg-surface border-outline-variant shadow-card print-plain rounded-xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
              {g.name}
            </h2>
            <p className="text-body-md font-body-md text-on-surface-variant mt-1">
              {g.group_code} · saves on {savingDayLabel(g.saving_day)} ·{' '}
              {SAVING_FREQUENCY_LABELS[g.saving_frequency].toLowerCase()}
              {g.location ? ` · ${g.location}` : ''}
            </p>
            <p className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
              {formatDate(from)} to {formatDate(to)} · {report.totals.members} members ·{' '}
              {g.loan_officer_name ? `officer ${g.loan_officer_name}` : 'no officer assigned'}
            </p>
          </div>
          <ExportButtons
            filename={`group-report-${g.group_code}-${from}-to-${to}`}
            documentTitle={documentName('Group Report', `${g.name} ${from} to ${to}`)}
            rows={csv}
          />
        </div>

        <dl className="border-outline-variant mt-5 grid grid-cols-2 gap-4 border-t pt-5 lg:grid-cols-4">
          <Total label="Expected" value={report.totals.expected} />
          <Total label="Collected" value={report.totals.paid} tone="text-tertiary" />
          <Total
            label="Outstanding"
            value={report.totals.outstanding}
            tone={toNumber(report.totals.outstanding) > 0 ? 'text-error' : undefined}
          />
          <div className="min-w-0">
            <dt className="text-label-md font-label-md text-on-surface-variant">
              Collection rate
            </dt>
            <dd className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface tabular mt-0.5">
              {rate.toFixed(2)}%
            </dd>
            <ProgressBar
              value={rate}
              tone={rate >= 80 ? 'tertiary' : rate >= 40 ? 'secondary' : 'error'}
              label="Collection rate"
              className="mt-2"
            />
          </div>
        </dl>
      </section>

      {/* ----------------------------------------------------------- rows */}
      {rows.length === 0 ? (
        <div className="bg-surface border-outline-variant rounded-xl border">
          <EmptyState
            icon="group"
            title="No members in this group"
            description="Assign members to the group, then open a cycle to start collecting."
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden print:hidden">
            {rows.map((r) => (
              <li
                key={r.member_id}
                className="bg-surface border-surface-container shadow-card rounded-xl border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/staff/members/${r.member_id}`}
                    className="min-h-touch-target-min flex min-w-0 flex-col justify-center"
                  >
                    <span className="text-body-lg font-body-lg text-primary block truncate font-semibold">
                      {r.full_name}
                    </span>
                    <span className="text-label-md font-label-md text-on-surface-variant tabular block truncate normal-case">
                      {r.member_no} · {formatPhone(r.phone)}
                    </span>
                  </Link>
                  <MemberStatusBadge status={r.status} />
                </div>

                <dl className="border-outline-variant mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                  <Cell label="Expected" value={r.expected} />
                  <Cell label="Paid" value={r.paid} tone="text-tertiary" />
                  <Cell
                    label="Outstanding"
                    value={r.outstanding}
                    tone={toNumber(r.outstanding) > 0 ? 'text-error' : undefined}
                  />
                </dl>

                <p className="text-label-md font-label-md text-on-surface-variant mt-2 normal-case">
                  {r.paid_count} paid · {r.partial_count} partial · {r.missed_count} missed
                </p>
              </li>
            ))}
          </ul>

          {/* Desktop and print */}
          <div className="bg-surface border-outline-variant shadow-card hidden overflow-hidden rounded-xl border lg:block print:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">Member</th>
                    <th className="p-4 text-center font-semibold">Schedules</th>
                    <th className="p-4 text-right font-semibold">Expected</th>
                    <th className="p-4 text-right font-semibold">Paid</th>
                    <th className="p-4 text-right font-semibold">Outstanding</th>
                    <th className="p-4 font-semibold">Breakdown</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {rows.map((r) => (
                    <tr key={r.member_id} className="hover:bg-surface-container-low">
                      <td className="p-4">
                        <Link
                          href={`/staff/members/${r.member_id}`}
                          className="text-primary font-semibold"
                        >
                          {r.full_name}
                        </Link>
                        <span className="text-on-surface-variant tabular block text-xs">
                          {r.member_no}
                        </span>
                      </td>
                      <td className="tabular p-4 text-center">{r.schedules}</td>
                      <td className="tabular p-4 text-right">{formatUGX(r.expected)}</td>
                      <td className="tabular text-tertiary p-4 text-right font-semibold">
                        {formatUGX(r.paid)}
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
                            value={percent(r.paid, r.expected)}
                            tone={percent(r.paid, r.expected) >= 80 ? 'tertiary' : 'secondary'}
                            label={`${r.full_name} collection rate`}
                            className="w-20"
                          />
                          <span className="tabular text-xs">
                            {Math.round(percent(r.paid, r.expected))}%
                          </span>
                        </div>
                        <span className="text-on-surface-variant text-xs">
                          {r.paid_count} paid · {r.partial_count} partial · {r.missed_count} missed
                        </span>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-surface-container-low/50 font-semibold">
                    <td className="p-4">Total</td>
                    <td className="p-4" />
                    <td className="tabular p-4 text-right">
                      {formatUGX(report.totals.expected)}
                    </td>
                    <td className="tabular p-4 text-right">{formatUGX(report.totals.paid)}</td>
                    <td className="tabular p-4 text-right">
                      {formatUGX(report.totals.outstanding)}
                    </td>
                    <td className="tabular p-4">{rate.toFixed(2)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <PrintFooter />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function isDate(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function Total({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant">
        {label}
      </dt>
      <dd>
        <Money
          value={value}
          className={clsx(
            'text-headline-lg-mobile font-headline-lg-mobile mt-0.5 block',
            tone ?? 'text-on-surface',
          )}
        />
      </dd>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd
        className={clsx(
          'text-body-md font-body-md truncate font-semibold',
          tone ?? 'text-on-surface',
        )}
      >
        <Money value={value} />
      </dd>
    </div>
  );
}
