import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getGroupOverview } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { Avatar, Badge, Icon, Money, PageTitle, ProgressBar } from '@/components/ui/primitives';
import { EmptyState, ListSkeleton } from '@/components/ui/states';
import { MemberStatusBadge } from '@/components/ui/status';
import { TransactionRow } from '@/components/member/TransactionRow';
import { OpenCycleButton } from '@/components/groups/OpenCycleButton';
import { GroupStatusControl } from '@/components/groups/GroupStatusControl';
import {
  GROUP_STATUS_LABELS,
  GROUP_STATUS_TONES,
  SAVING_FREQUENCY_LABELS,
  savingDayLabel,
  savingsKindFor,
} from '@/lib/groups';
import { formatDate, formatPhone } from '@/lib/format';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { MemberFinancialsRow, TransactionFeedRow } from '@/types/db';

export const metadata: Metadata = { title: 'Group' };

/**
 * The group dashboard.
 *
 * Everything here is derived: `group_overview` sums the member-level views, so
 * the totals on this page and the balances on the phones of the members are the
 * same numbers read two ways. There is no group balance stored anywhere.
 */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('groups.view');
  const { id } = await params;

  const group = await getGroupOverview(id);
  if (!group) notFound();

  const canManage = can(user.role, 'groups.manage');
  const canRecord = can(user.role, 'savings.record');
  const kind = savingsKindFor(group.saving_frequency);
  const target = kind === 'weekly' ? group.weekly_target : group.monthly_target;
  const rate = percent(group.current_collected, group.current_expected);

  return (
    <div className="space-y-6">
      <Link
        href="/staff/groups"
        className="text-label-md font-label-md text-on-surface-variant hover:text-primary inline-flex items-center gap-1 normal-case"
      >
        <Icon name="arrow_back" size={18} />
        Groups
      </Link>

      <PageTitle
        title={group.name}
        subtitle={`${group.group_code} · saves on ${savingDayLabel(group.saving_day)} · ${SAVING_FREQUENCY_LABELS[group.saving_frequency].toLowerCase()}`}
        action={
          <div className="flex flex-wrap gap-2">
            {canRecord ? (
              <>
                <OpenCycleButton
                  groupId={group.id}
                  savingDay={group.saving_day}
                  frequency={group.saving_frequency}
                  variant="outline"
                />
                <Link
                  href={`/staff/groups/${group.id}/collect`}
                  className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold transition-colors"
                >
                  <Icon name="savings" size={20} />
                  Collections
                </Link>
              </>
            ) : (
              <Link
                href={`/staff/groups/${group.id}/collect`}
                className="border-outline-variant bg-surface text-primary h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg border px-4 font-semibold"
              >
                <Icon name="savings" size={20} />
                Collection sheet
              </Link>
            )}
            {canManage ? (
              <>
                <Link
                  href={`/staff/groups/${group.id}/edit`}
                  className="border-outline-variant bg-surface text-primary hover:bg-surface-container-high h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg border px-4 font-semibold transition-colors"
                >
                  <Icon name="edit" size={20} />
                  Edit
                </Link>
                <GroupStatusControl
                  groupId={group.id}
                  status={group.status}
                  name={group.name}
                />
              </>
            ) : null}
          </div>
        }
      />

      {/* ------------------------------------------------------- identity */}
      <section className="bg-surface border-outline-variant/50 elev-1 rounded-xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
                {group.name}
              </h2>
              <Badge tone={GROUP_STATUS_TONES[group.status]}>
                {GROUP_STATUS_LABELS[group.status]}
              </Badge>
            </div>
            {group.notes ? (
              <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-prose">
                {group.notes}
              </p>
            ) : null}
          </div>
          <div className="bg-primary text-on-primary rounded-xl px-5 py-3 text-center">
            <p className="text-label-md font-label-md text-primary-fixed-dim uppercase tracking-wider">
              Saving day
            </p>
            <p className="text-headline-lg-mobile font-headline-lg-mobile">
              {savingDayLabel(group.saving_day)}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail icon="badge" label="Group code" value={group.group_code} mono />
          <Detail icon="location_on" label="Location" value={group.location ?? '—'} />
          <Detail
            icon="savings"
            label={`${kind === 'weekly' ? 'Weekly' : 'Monthly'} target per member`}
            value={formatUGX(target)}
          />
          <Detail
            icon="person"
            label="Group leader"
            value={
              group.leader_name
                ? `${group.leader_name}${group.leader_phone ? ` · ${formatPhone(group.leader_phone)}` : ''}`
                : 'Not assigned'
            }
          />
          <Detail
            icon="description"
            label="Secretary"
            value={
              group.secretary_name
                ? `${group.secretary_name}${group.secretary_phone ? ` · ${formatPhone(group.secretary_phone)}` : ''}`
                : 'Not assigned'
            }
          />
          <Detail
            icon="manage_accounts"
            label="Loan officer"
            value={group.loan_officer_name ?? 'Not assigned'}
          />
          <Detail icon="group" label="Members" value={`${group.active_member_count} active of ${group.member_count}`} />
          <Detail icon="calendar_today" label="Created" value={formatDate(group.created_at)} />
        </dl>
      </section>

      {/* --------------------------------------------------- current cycle */}
      <section className="bg-surface border-outline-variant/30 elev-1 overflow-hidden rounded-xl border">
        <div className="border-outline-variant/40 flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="text-button-text font-button-text text-on-surface">
              Current savings cycle
            </h2>
            <p className="text-label-md font-label-md text-on-surface-variant mt-0.5 normal-case">
              {group.current_cycle_id
                ? `${group.current_cycle_label} · due ${formatDate(group.current_cycle_due_on)}`
                : 'No cycle has been opened yet'}
            </p>
          </div>
          {group.current_cycle_id ? (
            <Link
              href={`/staff/groups/${group.id}/collect`}
              className="text-label-md font-label-md text-primary hover:underline normal-case"
            >
              Open the sheet →
            </Link>
          ) : null}
        </div>

        {group.current_cycle_id ? (
          <div className="p-4">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider">
                  Collection rate
                </p>
                <p className="text-display-currency font-display-currency text-on-surface tabular">
                  {rate.toFixed(2)}%
                </p>
              </div>
              <ProgressBar
                value={rate}
                tone={rate >= 80 ? 'tertiary' : rate >= 40 ? 'secondary' : 'error'}
                label="Collection rate"
                className="mb-2 flex-1"
              />
            </div>

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Figure label="Expected" value={group.current_expected} />
              <Figure label="Collected" value={group.current_collected} tone="text-tertiary" />
              <Figure
                label="Outstanding"
                value={group.current_outstanding}
                tone={toNumber(group.current_outstanding) > 0 ? 'text-error' : undefined}
              />
            </dl>
          </div>
        ) : (
          <EmptyState
            icon="event_available"
            title="No cycle opened"
            description={`Open the ${savingDayLabel(group.saving_day)} cycle to put every active member on the collection sheet with their expected amount.`}
          />
        )}
      </section>

      {/* ---------------------------------------------------- group totals */}
      <section className="gap-gutter grid grid-cols-2 lg:grid-cols-4">
        <Tile
          icon="group"
          label="Active members"
          value={group.active_member_count.toLocaleString()}
        />
        <Tile icon="savings" label="Total savings" money={group.total_savings} />
        <Tile icon="pie_chart" label="Share capital" money={group.total_shares} />
        <Tile
          icon="payments"
          label="Loan balance"
          money={group.total_loan_balance}
          tone={toNumber(group.total_loan_balance) > 0 ? 'text-error' : undefined}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ListSkeleton rows={5} />}>
            <Members groupId={group.id} groupName={group.name} />
          </Suspense>
        </div>
        <div>
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <RecentActivity groupId={group.id} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function Members({ groupId, groupName }: { groupId: string; groupName: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('search_members', {
    p_group_id: groupId,
    p_sort: 'name',
    p_limit: 100,
    p_offset: 0,
  });

  const result = (data ?? { rows: [], total: 0 }) as {
    rows: MemberFinancialsRow[];
    total: number;
  };

  return (
    <section className="bg-surface border-outline-variant/30 elev-1 overflow-hidden rounded-xl border">
      <div className="border-outline-variant/40 flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-button-text font-button-text text-on-surface">
          Members ({result.total})
        </h2>
        <Link
          href={`/staff/members?group=${groupId}`}
          className="text-label-md font-label-md text-primary hover:underline normal-case"
        >
          In the register →
        </Link>
      </div>

      {result.rows.length === 0 ? (
        <EmptyState
          icon="group"
          title="No members yet"
          description={`Open a member in the register and assign them to ${groupName}.`}
          action={
            <Link
              href="/staff/members"
              className="border-outline-variant bg-surface text-primary h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg border px-4 font-semibold"
            >
              <Icon name="group" size={20} />
              Go to members
            </Link>
          }
        />
      ) : (
        <ul className="divide-outline-variant/30 divide-y">
          {result.rows.map((m) => (
            <li key={m.id}>
              <Link
                href={`/staff/members/${m.id}`}
                className="hover:bg-surface-container-lowest min-h-touch-target-min flex items-center gap-3 p-3 transition-colors"
              >
                <Avatar name={m.full_name} src={m.photo_url} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="text-body-md font-body-md text-on-surface block truncate font-semibold">
                    {m.full_name}
                  </span>
                  <span className="text-label-md font-label-md text-on-surface-variant tabular block truncate normal-case">
                    {m.member_no} · {formatPhone(m.phone)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-body-md font-body-md text-on-surface tabular block font-semibold">
                    <Money value={m.savings_balance} />
                  </span>
                  {toNumber(m.savings_outstanding) > 0 ? (
                    <span className="text-label-md font-label-md text-error block normal-case">
                      {formatUGX(m.savings_outstanding)} behind
                    </span>
                  ) : (
                    <span className="text-label-md font-label-md text-on-surface-variant block normal-case">
                      up to date
                    </span>
                  )}
                </span>
                <MemberStatusBadge status={m.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function RecentActivity({ groupId }: { groupId: string }) {
  const supabase = await createClient();

  const { data: memberRows } = await supabase
    .from('members')
    .select('id')
    .eq('group_id', groupId);

  const ids = (memberRows ?? []).map((m) => m.id);
  if (ids.length === 0) {
    return (
      <section className="bg-surface border-outline-variant/30 elev-1 overflow-hidden rounded-xl border">
        <div className="border-outline-variant/40 border-b p-4">
          <h2 className="text-button-text font-button-text text-on-surface">Recent transactions</h2>
        </div>
        <EmptyState
          icon="receipt_long"
          title="Nothing yet"
          description="Transactions appear here once members start saving."
        />
      </section>
    );
  }

  const { data } = await supabase
    .from('transaction_feed')
    .select('*')
    .in('member_id', ids)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);

  const rows = (data ?? []) as TransactionFeedRow[];

  return (
    <section className="bg-surface border-outline-variant/30 elev-1 overflow-hidden rounded-xl border">
      <div className="border-outline-variant/40 flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-button-text font-button-text text-on-surface">Recent transactions</h2>
        <Link
          href="/staff/transactions"
          className="text-label-md font-label-md text-primary hover:underline normal-case"
        >
          All →
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="receipt_long"
          title="Nothing yet"
          description="Transactions appear here once members start saving."
        />
      ) : (
        <ul className="divide-outline-variant/30 divide-y">
          {rows.map((t) => (
            <li key={t.id} className="p-2">
              <TransactionRow txn={t} href={`/staff/transactions/${t.id}`} showMember />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */

function Detail({
  icon,
  label,
  value,
  mono,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon name={icon} size={18} className="text-on-surface-variant mt-0.5 shrink-0" />
      <div className="min-w-0">
        <dt className="text-label-md font-label-md text-on-surface-variant">{label}</dt>
        <dd
          className={clsx(
            'text-body-md font-body-md text-on-surface truncate font-semibold',
            mono && 'tabular',
          )}
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider">
        {label}
      </dt>
      <dd className={clsx('text-body-lg font-body-lg mt-0.5 font-bold', tone ?? 'text-on-surface')}>
        <Money value={value} />
      </dd>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  money,
  tone,
}: {
  icon: string;
  label: string;
  value?: string;
  money?: unknown;
  tone?: string;
}) {
  return (
    <div className="bg-surface border-outline-variant/30 elev-1 rounded-xl border p-5">
      <div className="bg-primary-fixed text-primary mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg">
        <Icon name={icon} size={20} />
      </div>
      <p className="text-label-md font-label-md text-on-surface-variant mb-1 uppercase tracking-wider">
        {label}
      </p>
      {money !== undefined ? (
        <Money
          value={money}
          compact
          className={clsx('text-display-currency font-display-currency', tone ?? 'text-on-surface')}
        />
      ) : (
        <p className="text-display-currency font-display-currency text-on-surface tabular">
          {value}
        </p>
      )}
    </div>
  );
}
