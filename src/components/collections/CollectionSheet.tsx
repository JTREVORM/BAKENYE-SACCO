'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RecordCollectionDialog } from './RecordCollectionDialog';
import { WaiveScheduleDialog } from './WaiveScheduleDialog';
import { Avatar, Icon, Money, ProgressBar } from '@/components/ui/primitives';
import { SavingsStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { Button, SearchInput, Select } from '@/components/ui/form';
import { formatDate, formatPhone, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { savingDayLabel } from '@/lib/groups';
import { clsx } from '@/lib/clsx';
import type { CollectionSheet as Sheet, SavingsScheduleRow, SavingsStatus } from '@/types/db';

const FILTERS: { value: '' | SavingsStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'missed', label: 'Missed' },
  { value: 'waived', label: 'Waived' },
];

/**
 * The collection sheet a staff member works from on a saving day.
 *
 * Filtering and searching happen in the browser because the sheet is already
 * loaded — a group is tens of members, not the whole register — and a cashier
 * standing at a meeting should not wait for a round trip to find the next
 * person in the queue.
 *
 * Below `lg` each member is a card with the figures stacked and one full-width
 * action; the seven-column table only appears where there is room for it.
 */
export function CollectionSheet({
  sheet,
  canRecord,
  canWaive,
}: {
  sheet: Sheet;
  canRecord: boolean;
  canWaive: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'' | SavingsStatus>('');
  const [recording, setRecording] = useState<SavingsScheduleRow | null>(null);
  const [waiving, setWaiving] = useState<SavingsScheduleRow | null>(null);

  const { cycle, rows, group } = sheet;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter && r.status !== filter) return false;
      if (!q) return true;
      return (
        r.member_name.toLowerCase().includes(q) ||
        r.member_no.toLowerCase().includes(q) ||
        r.member_phone.includes(q)
      );
    });
  }, [rows, query, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  if (!cycle) {
    return (
      <div className="bg-surface rounded-xl shadow-neu-sm">
        <EmptyState
          icon="event_available"
          title="No collection sheet yet"
          description={`${group.name} saves on ${savingDayLabel(group.saving_day)}. Open the cycle to put every active member on the sheet.`}
        />
      </div>
    );
  }

  const rate = percent(cycle.collected_amount, cycle.expected_amount);
  const closed = cycle.status === 'closed';

  return (
    <div className="flex flex-col gap-6">
      {/* ------------------------------------------------------- the totals */}
      <section
        aria-label="Collection summary"
        className="bg-surface shadow-card overflow-hidden rounded-xl"
      >
        <div className="border-outline-variant flex flex-wrap items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <h2 className="text-button-text font-button-text text-on-surface">
              {savingDayLabel(cycle.saving_day)} collections
            </h2>
            <p className="text-label-md font-label-md text-on-surface-variant mt-0.5 normal-case">
              {cycle.label} · due {formatDate(cycle.due_on)}
              {closed ? ' · closed' : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-label-md font-label-md text-on-surface-variant">
              Collection rate
            </p>
            <p className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface tabular">
              {rate.toFixed(2)}%
            </p>
          </div>
        </div>

        <div className="p-4">
          <ProgressBar
            value={rate}
            tone={rate >= 80 ? 'tertiary' : rate >= 40 ? 'secondary' : 'error'}
            label="Collection rate"
          />

          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Members expected" value={cycle.members_expected} plain />
            <Stat label="Paid" value={cycle.paid_members} plain tone="text-tertiary" />
            <Stat
              label="Partial"
              value={cycle.partial_members}
              plain
              tone="text-on-secondary-container"
            />
            <Stat label="Pending" value={cycle.pending_members} plain />
            <Stat label="Missed" value={cycle.missed_members} plain tone="text-error" />
            <Stat label="Waived" value={cycle.waived_members} plain />
          </dl>

          <dl className="border-outline-variant mt-4 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-3">
            <Stat label="Expected" value={cycle.expected_amount} />
            <Stat label="Collected" value={cycle.collected_amount} tone="text-tertiary" />
            <Stat
              label="Outstanding"
              value={cycle.outstanding_amount}
              tone={toNumber(cycle.outstanding_amount) > 0 ? 'text-error' : undefined}
            />
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------- the filters */}
      <div className="flex flex-col gap-3">
        <SearchInput
          defaultValue={query}
          onSearch={setQuery}
          delay={150}
          placeholder="Find a member on this sheet…"
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="no-scrollbar flex flex-1 gap-2 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.value || 'all'}
                type="button"
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
                className={clsx(
                  'text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors',
                  filter === f.value
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
                )}
              >
                {f.label}
                {f.value && counts[f.value] ? ` (${counts[f.value]})` : ''}
              </button>
            ))}
          </div>

          {sheet.cycles.length > 1 ? (
            <label className="flex shrink-0 items-center gap-2">
              <span className="text-label-md font-label-md text-on-surface-variant">Cycle</span>
              <Select
                value={cycle.cycle_id}
                onChange={(e) =>
                  router.push(`/staff/groups/${group.id}/collect?cycle=${e.target.value}`)
                }
                className="h-touch-target-min w-auto"
              >
                {sheet.cycles.map((c) => (
                  <option key={c.cycle_id} value={c.cycle_id}>
                    {c.label} · {formatDate(c.due_on)}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
        </div>

        <p className="text-label-md font-label-md text-on-surface-variant normal-case">
          Showing {visible.length} of {rows.length}{' '}
          {rows.length === 1 ? 'member' : 'members'}
        </p>
      </div>

      {closed ? (
        <div className="bg-secondary-fixed text-on-secondary-fixed flex items-start gap-3 rounded-lg p-3">
          <Icon name="lock" size={20} className="mt-px shrink-0" />
          <p className="text-body-md font-body-md">
            This cycle is closed. Payments can no longer be recorded against it — reopen it or
            record against the current cycle instead.
          </p>
        </div>
      ) : null}

      {/* --------------------------------------------------------- the rows */}
      {visible.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="group"
            title="No members match"
            description="Try a different name, member number or filter."
            action={
              <Button
                variant="outline"
                icon="refresh"
                onClick={() => {
                  setQuery('');
                  setFilter('');
                }}
              >
                Clear filters
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {visible.map((r) => (
              <li
                key={r.schedule_id}
                className="bg-surface border-surface-container shadow-card rounded-xl border p-3"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={r.member_name} src={r.member_photo} size={44} />
                  {/* Name and number are one 44px target, rather than a 24px
                      line of text a thumb has to hit exactly. */}
                  <Link
                    href={`/staff/members/${r.member_id}`}
                    className="min-h-touch-target-min flex min-w-0 flex-1 flex-col justify-center"
                  >
                    <span className="text-body-lg font-body-lg text-primary block truncate font-semibold">
                      {r.member_name}
                    </span>
                    <span className="text-label-md font-label-md text-on-surface-variant tabular block truncate normal-case">
                      {r.member_no} · {formatPhone(r.member_phone)}
                    </span>
                  </Link>
                  <SavingsStatusBadge status={r.status} />
                </div>

                <dl className="border-outline-variant mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                  <Cell label="Expected" value={r.expected_amount} />
                  <Cell label="Paid" value={r.paid_amount} tone="text-tertiary" />
                  <Cell
                    label="Outstanding"
                    value={r.outstanding}
                    tone={toNumber(r.outstanding) > 0 ? 'text-error' : undefined}
                  />
                </dl>

                {r.last_reference || r.last_method ? (
                  <p className="text-label-md font-label-md text-on-surface-variant mt-2 truncate normal-case">
                    {r.last_method ? PAYMENT_METHOD_LABELS[r.last_method] : '—'}
                    {r.last_reference ? ` · ${r.last_reference}` : ''}
                    {r.last_paid_on ? ` · ${formatDate(r.last_paid_on)}` : ''}
                  </p>
                ) : null}

                {canRecord && !closed && r.status !== 'waived' ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="lg"
                      block
                      icon="add"
                      onClick={() => setRecording(r)}
                    >
                      {toNumber(r.paid_amount) > 0 ? 'Record more' : 'Record payment'}
                    </Button>
                    {canWaive && toNumber(r.paid_amount) === 0 ? (
                      <Button
                        variant="outline"
                        size="lg"
                        aria-label={`Waive ${r.member_name}`}
                        onClick={() => setWaiving(r)}
                      >
                        <Icon name="block" size={20} />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {/* Desktop: the full sheet */}
          <div className="bg-surface shadow-card hidden overflow-hidden rounded-xl lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">Member</th>
                    <th className="p-4 text-right font-semibold">Expected</th>
                    <th className="p-4 text-right font-semibold">Paid</th>
                    <th className="p-4 text-right font-semibold">Outstanding</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Method</th>
                    <th className="p-4 font-semibold">Reference</th>
                    {canRecord ? <th className="p-4 text-right font-semibold">Action</th> : null}
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {visible.map((r) => (
                    <tr
                      key={r.schedule_id}
                      className="hover:bg-surface-container-low transition-colors"
                    >
                      <td className="p-4">
                        <Link
                          href={`/staff/members/${r.member_id}`}
                          className="min-h-touch-target-min flex items-center gap-3"
                        >
                          <Avatar name={r.member_name} src={r.member_photo} size={32} />
                          <span className="min-w-0">
                            <span className="text-primary block truncate font-semibold">
                              {r.member_name}
                            </span>
                            <span className="text-on-surface-variant tabular block text-xs">
                              {r.member_no}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="tabular p-4 text-right">{formatUGX(r.expected_amount)}</td>
                      <td className="tabular text-tertiary p-4 text-right font-semibold">
                        {formatUGX(r.paid_amount)}
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
                        <SavingsStatusBadge status={r.status} />
                      </td>
                      <td className="text-on-surface-variant p-4 whitespace-nowrap">
                        {r.last_method ? PAYMENT_METHOD_LABELS[r.last_method] : '—'}
                      </td>
                      <td className="text-on-surface-variant tabular p-4">
                        {r.last_reference ?? '—'}
                      </td>
                      {/* Full 44px controls even on the desktop table — staff
                          work this sheet on a tablet as often as a laptop, and
                          a 36px button is a miss. */}
                      {canRecord ? (
                        <td className="p-4 text-right">
                          {closed || r.status === 'waived' ? (
                            <span className="text-on-surface-variant text-xs">—</span>
                          ) : (
                            <span className="flex items-center justify-end gap-2">
                              <Button icon="add" onClick={() => setRecording(r)}>
                                Record
                              </Button>
                              {canWaive && toNumber(r.paid_amount) === 0 ? (
                                <Button
                                  variant="ghost"
                                  aria-label={`Waive ${r.member_name}`}
                                  onClick={() => setWaiving(r)}
                                >
                                  <Icon name="block" size={20} />
                                </Button>
                              ) : null}
                            </span>
                          )}
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

      <RecordCollectionDialog
        row={recording}
        groupId={group.id}
        open={!!recording}
        onClose={() => setRecording(null)}
      />
      <WaiveScheduleDialog
        row={waiving}
        groupId={group.id}
        open={!!waiving}
        onClose={() => setWaiving(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  plain = false,
}: {
  label: string;
  value: unknown;
  tone?: string;
  plain?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">
        {label}
      </dt>
      <dd
        className={clsx(
          'tabular mt-0.5 truncate font-bold',
          plain ? 'text-headline-lg-mobile font-headline-lg-mobile' : 'text-body-lg font-body-lg',
          tone ?? 'text-on-surface',
        )}
      >
        {plain ? String(value) : <Money value={value} />}
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
