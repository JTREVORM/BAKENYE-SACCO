'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Badge, Icon, Money, ProgressBar } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { Button, SearchInput } from '@/components/ui/form';
import {
  GROUP_STATUS_LABELS,
  GROUP_STATUS_TONES,
  SAVING_DAYS,
  SAVING_FREQUENCY_LABELS,
  savingDayLabel,
  todayIsoWeekday,
} from '@/lib/groups';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { GroupOverviewRow } from '@/types/db';

/**
 * The group register.
 *
 * Search, status and saving-day filters are query-string state resolved by
 * `search_groups()` on the server, so the phone holds one page at a time no
 * matter how many groups the SACCO runs.
 */

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'dissolved', label: 'Dissolved' },
];

export function GroupsBrowser({
  rows,
  total,
  page,
  pageSize,
  canManage,
}: {
  rows: GroupOverviewRow[];
  total: number;
  page: number;
  pageSize: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = todayIsoWeekday();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const status = params.get('status') ?? '';
  const day = params.get('day') ?? '';
  const q = params.get('q') ?? '';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = !!(status || day || q);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <SearchInput
          defaultValue={q}
          onSearch={(v) => setParam('q', v)}
          placeholder="Search by group name, code or location…"
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="no-scrollbar flex flex-1 gap-2 overflow-x-auto">
            {STATUSES.map((s) => (
              <button
                key={s.value || 'all'}
                type="button"
                onClick={() => setParam('status', s.value)}
                aria-pressed={status === s.value}
                className={clsx(
                  'text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors',
                  status === s.value
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <label className="flex shrink-0 items-center gap-2">
            <span className="text-label-md font-label-md text-on-surface-variant">Saving day</span>
            <select
              value={day}
              onChange={(e) => setParam('day', e.target.value)}
              className="bg-surface-container text-label-md font-label-md text-on-surface shadow-neu-inset focus:ring-2 focus:ring-primary/40 h-touch-target-min rounded-full border-0 py-0 pl-4 pr-8 normal-case outline-none"
            >
              <option value="">Any day</option>
              {SAVING_DAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                  {d.value === today ? ' (today)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
        {total.toLocaleString()} {total === 1 ? 'group' : 'groups'}
        {day ? ` saving on ${savingDayLabel(Number(day))}` : ''}
      </p>

      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="groups"
            title={filtered ? 'No matching groups' : 'No groups yet'}
            description={
              filtered
                ? 'Try a different search term, status or saving day.'
                : 'Groups are how the SACCO collects savings. Create the first one and give it a saving day.'
            }
            action={
              filtered ? (
                <Button variant="outline" icon="refresh" onClick={() => router.push(pathname)}>
                  Clear filters
                </Button>
              ) : canManage ? (
                <Link
                  href="/staff/groups/new"
                  className="bg-primary text-on-primary h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-5 font-semibold"
                >
                  <Icon name="add" size={20} />
                  Create a group
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {rows.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/staff/groups/${g.id}`}
                  className="bg-surface border-surface-container shadow-card hover:bg-surface-container-low block rounded-xl border p-3 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={clsx(
                        'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-center',
                        g.saving_day === today
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container text-on-surface-variant',
                      )}
                    >
                      <span className="text-label-md font-label-md leading-none">
                        {SAVING_DAYS.find((d) => d.value === g.saving_day)?.short}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                        {g.name}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                        {g.group_code} · {g.active_member_count}{' '}
                        {g.active_member_count === 1 ? 'member' : 'members'}
                        {g.location ? ` · ${g.location}` : ''}
                      </p>
                    </div>
                    <Badge tone={GROUP_STATUS_TONES[g.status]}>
                      {GROUP_STATUS_LABELS[g.status]}
                    </Badge>
                  </div>

                  <dl className="border-outline-variant mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                    <Figure label="Savings" value={g.total_savings} />
                    <Figure label="Shares" value={g.total_shares} />
                    <Figure
                      label="Loans"
                      value={g.total_loan_balance}
                      tone={toNumber(g.total_loan_balance) > 0 ? 'text-error' : undefined}
                    />
                  </dl>

                  {g.current_cycle_id ? (
                    <div className="mt-3">
                      <ProgressBar
                        value={percent(g.current_collected, g.current_expected)}
                        tone={
                          percent(g.current_collected, g.current_expected) >= 80
                            ? 'tertiary'
                            : 'secondary'
                        }
                        label={`${g.name} collection rate`}
                      />
                      <p className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
                        {g.current_cycle_label}: {formatUGX(g.current_collected)} of{' '}
                        {formatUGX(g.current_expected)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-label-md font-label-md text-on-surface-variant mt-3 normal-case">
                      Saves on {savingDayLabel(g.saving_day)} · no cycle opened yet
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="bg-surface shadow-card hidden overflow-hidden rounded-xl lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">Group</th>
                    <th className="p-4 font-semibold">Saving day</th>
                    <th className="p-4 text-center font-semibold">Members</th>
                    <th className="p-4 text-right font-semibold">Savings</th>
                    <th className="p-4 text-right font-semibold">Loans</th>
                    <th className="p-4 font-semibold">Current cycle</th>
                    <th className="p-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {rows.map((g) => (
                    <tr key={g.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="p-4">
                        <Link
                          href={`/staff/groups/${g.id}`}
                          className="min-h-touch-target-min flex flex-col justify-center"
                        >
                          <span className="text-primary truncate font-semibold">{g.name}</span>
                          <span className="text-on-surface-variant tabular text-xs">
                            {g.group_code}
                            {g.location ? ` · ${g.location}` : ''}
                          </span>
                        </Link>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span
                          className={clsx(
                            'text-label-md font-label-md inline-block rounded-full px-3 py-1 normal-case',
                            g.saving_day === today
                              ? 'bg-primary text-on-primary font-semibold'
                              : 'bg-surface-container text-on-surface-variant',
                          )}
                        >
                          {savingDayLabel(g.saving_day)}
                        </span>
                        <span className="text-on-surface-variant mt-1 block text-xs">
                          {SAVING_FREQUENCY_LABELS[g.saving_frequency]}
                        </span>
                      </td>
                      <td className="tabular p-4 text-center">{g.active_member_count}</td>
                      <td className="tabular p-4 text-right">
                        <Money value={g.total_savings} />
                      </td>
                      <td
                        className={clsx(
                          'tabular p-4 text-right',
                          toNumber(g.total_loan_balance) > 0 && 'text-error font-semibold',
                        )}
                      >
                        <Money value={g.total_loan_balance} />
                      </td>
                      <td className="p-4">
                        {g.current_cycle_id ? (
                          <>
                            <div className="flex items-center gap-2">
                              <ProgressBar
                                value={percent(g.current_collected, g.current_expected)}
                                tone={
                                  percent(g.current_collected, g.current_expected) >= 80
                                    ? 'tertiary'
                                    : 'secondary'
                                }
                                label={`${g.name} collection rate`}
                                className="w-20"
                              />
                              <span className="tabular text-xs">
                                {Math.round(percent(g.current_collected, g.current_expected))}%
                              </span>
                            </div>
                            <span className="text-on-surface-variant text-xs">
                              {g.current_cycle_label} · due{' '}
                              {formatDate(g.current_cycle_due_on)}
                            </span>
                          </>
                        ) : (
                          <span className="text-on-surface-variant text-xs">Not opened</span>
                        )}
                      </td>
                      <td className="p-4">
                        <Badge tone={GROUP_STATUS_TONES[g.status]}>
                          {GROUP_STATUS_LABELS[g.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3" aria-label="Group pages">
              <Button
                variant="outline"
                icon="chevron_left"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                Previous
              </Button>
              <span className="text-label-md font-label-md text-on-surface-variant normal-case">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                iconEnd="chevron_right"
                disabled={page >= totalPages}
                onClick={() => setParam('page', String(page + 1))}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
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
