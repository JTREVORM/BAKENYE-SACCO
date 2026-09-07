import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getSavingsDashboard } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { Icon, Money, PageTitle, ProgressBar } from '@/components/ui/primitives';
import { EmptyState, ErrorState, StatGridSkeleton } from '@/components/ui/states';
import { TodayControls } from './TodayControls';
import { savingDayLabel, SAVING_FREQUENCY_LABELS } from '@/lib/groups';
import { formatDate, toISODate } from '@/lib/format';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { GroupSavingToday } from '@/types/db';

export const metadata: Metadata = { title: 'Today’s collections' };

/**
 * Today's collections.
 *
 * The system works out which groups are due from their own configured saving
 * day — nothing on this page is hard-coded to a weekday, and moving a group
 * from Wednesday to Friday moves it here with no code change.
 */
export default async function TodayCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requirePermission('savings.view');
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : toISODate();
  const canRecord = can(user.role, 'savings.record');

  const isToday = date === toISODate();
  const weekday = savingDayLabel(
    (() => {
      const d = new Date(`${date}T12:00:00`).getDay();
      return d === 0 ? 7 : d;
    })(),
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title={isToday ? 'Today’s collections' : `${weekday} collections`}
        subtitle={`Groups whose saving day falls on ${formatDate(date)}.`}
      />

      <TodayControls date={date} canRecord={canRecord} />

      <Suspense key={date} fallback={<StatGridSkeleton />}>
        <Board date={date} weekday={weekday} canRecord={canRecord} />
      </Suspense>
    </div>
  );
}

async function Board({
  date,
  weekday,
  canRecord,
}: {
  date: string;
  weekday: string;
  canRecord: boolean;
}) {
  const dash = await getSavingsDashboard(date);

  if (!dash) {
    return (
      <ErrorState
        title="Unable to load collections"
        description="Please check your connection and try again."
      />
    );
  }

  const groups = dash.groups_today ?? [];
  const rate = percent(dash.today_collected, dash.today_expected);

  return (
    <div className="space-y-6">
      {/* --------------------------------------------------------- totals */}
      <section className="gap-gutter grid grid-cols-2 lg:grid-cols-4">
        <Tile label="Expected today" money={dash.today_expected} icon="savings" />
        <Tile
          label="Collected"
          money={dash.today_collected}
          icon="check_circle"
          tone="text-tertiary"
        />
        <Tile
          label="Outstanding"
          money={dash.today_outstanding}
          icon="pending"
          tone={toNumber(dash.today_outstanding) > 0 ? 'text-error' : undefined}
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

      <section className="bg-surface shadow-card grid grid-cols-2 gap-4 rounded-xl p-4 sm:grid-cols-4">
        <Count label="Members paid" value={dash.members_paid} tone="text-tertiary" />
        <Count label="Partial" value={dash.members_partial} />
        <Count label="Not yet paid" value={dash.members_pending} />
        <Count label="Missed" value={dash.members_missed} tone="text-error" />
      </section>

      {/* --------------------------------------------------------- groups */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-button-text font-button-text text-on-surface">
            Groups saving on {weekday}
          </h2>
          <Link
            href="/staff/groups"
            className="text-label-md font-label-md text-primary hover:underline normal-case"
          >
            All groups →
          </Link>
        </div>

        {groups.length === 0 ? (
          <div className="bg-surface rounded-xl shadow-neu-sm">
            <EmptyState
              icon="event_busy"
              title={`No group saves on ${weekday}`}
              description="Groups collect on the day set in their profile. Check another day, or give a group this saving day."
              action={
                <Link
                  href="/staff/groups"
                  className="bg-surface text-primary h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold shadow-neu-sm"
                >
                  <Icon name="groups" size={20} />
                  Open the group register
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="gap-gutter grid grid-cols-1 lg:grid-cols-2">
            {groups.map((g) => (
              <li key={g.group_id}>
                <GroupCard group={g} date={date} canRecord={canRecord} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {toNumber(dash.total_arrears) > 0 ? (
        <section className="bg-error-container text-on-error-container flex items-start gap-3 rounded-xl p-4">
          <Icon name="warning" size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-button-text font-button-text">
              {formatUGX(dash.total_arrears)} in savings arrears
            </p>
            <p className="text-body-md font-body-md mt-0.5">
              Across every group, from cycles whose due date has already passed. Partial and missed
              schedules stay visible until they are settled or waived.
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
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function GroupCard({
  group,
  date,
  canRecord,
}: {
  group: GroupSavingToday;
  date: string;
  canRecord: boolean;
}) {
  const rate = percent(group.collected_amount, group.expected_amount);
  const opened = !!group.cycle_id;

  return (
    <div className="bg-surface shadow-card flex h-full flex-col rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/staff/groups/${group.group_id}`}
          className="min-h-touch-target-min flex min-w-0 flex-col justify-center"
        >
          <span className="text-body-lg font-body-lg text-primary block truncate font-semibold">
            {group.name}
          </span>
          <span className="text-label-md font-label-md text-on-surface-variant tabular block truncate normal-case">
            {group.group_code} · {group.active_members}{' '}
            {group.active_members === 1 ? 'member' : 'members'}
            {group.location ? ` · ${group.location}` : ''}
          </span>
        </Link>
        <span className="text-label-md font-label-md bg-surface-container text-on-surface-variant shrink-0 rounded-full px-3 py-1 normal-case">
          {SAVING_FREQUENCY_LABELS[group.saving_frequency]}
        </span>
      </div>

      {opened ? (
        <>
          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-label-md font-label-md text-on-surface-variant normal-case">
                {group.cycle_label} · due {formatDate(group.due_on)}
              </span>
              <span className="text-body-lg font-body-lg text-on-surface tabular font-bold">
                {rate.toFixed(0)}%
              </span>
            </div>
            <ProgressBar
              value={rate}
              tone={rate >= 80 ? 'tertiary' : rate >= 40 ? 'secondary' : 'error'}
              label={`${group.name} collection rate`}
            />
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-2">
            <Figure label="Expected" value={group.expected_amount} />
            <Figure label="Collected" value={group.collected_amount} tone="text-tertiary" />
            <Figure
              label="Outstanding"
              value={group.outstanding_amount}
              tone={toNumber(group.outstanding_amount) > 0 ? 'text-error' : undefined}
            />
          </dl>

          <p className="text-label-md font-label-md text-on-surface-variant mt-3 normal-case">
            {group.paid_members} paid · {group.partial_members} partial ·{' '}
            {group.pending_members} pending · {group.missed_members} missed
          </p>
        </>
      ) : (
        <p className="text-body-md font-body-md text-on-surface-variant mt-4 flex-1">
          The sheet for this day has not been opened yet. Opening it puts all{' '}
          {group.active_members} active members on the list with their expected amount.
        </p>
      )}

      <div className="mt-4 flex gap-2 pt-1">
        <Link
          href={`/staff/groups/${group.group_id}/collect${group.cycle_id ? `?cycle=${group.cycle_id}` : ''}`}
          className={clsx(
            'h-touch-target-min text-button-text font-button-text flex flex-1 items-center justify-center gap-2 rounded-lg font-semibold transition-colors',
            canRecord && opened
              ? 'bg-primary text-on-primary hover:bg-primary-container'
              : 'bg-surface text-primary hover:bg-surface-container-high shadow-neu-sm',
          )}
        >
          <Icon name={canRecord && opened ? 'savings' : 'visibility'} size={20} />
          {canRecord && opened ? 'Record collections' : 'Open sheet'}
        </Link>
        <Link
          href={`/staff/groups/${group.group_id}`}
          aria-label={`${group.name} details`}
          className="bg-surface text-on-surface-variant hover:bg-surface-container-high h-touch-target-min flex w-12 items-center justify-center rounded-lg transition-colors shadow-neu-sm"
        >
          <Icon name="chevron_right" size={20} />
        </Link>
      </div>

      {/* Explicit, because "date" drives which cycle the sheet defaults to. */}
      <p className="sr-only">Collection date {date}</p>
    </div>
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
      <p className="text-label-md font-label-md text-on-surface-variant mb-1">
        {label}
      </p>
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
      <p className="text-label-md font-label-md text-on-surface-variant truncate">
        {label}
      </p>
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

function Figure({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
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
