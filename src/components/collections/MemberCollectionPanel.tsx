'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RecordCollectionDialog } from './RecordCollectionDialog';
import { WaiveScheduleDialog } from './WaiveScheduleDialog';
import { Avatar, Badge, Icon, Money, ProgressBar } from '@/components/ui/primitives';
import { SavingsStatusBadge, MemberStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { Button } from '@/components/ui/form';
import { formatDate, formatPhone, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX, percent, toNumber } from '@/lib/money';
import {
  SAVINGS_FREQUENCY_ADVERB,
  SCHEDULE_HINTS,
  categoryTier,
} from '@/lib/categories';
import { clsx } from '@/lib/clsx';
import type { MemberCollectionView, SavingsScheduleRow } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

/**
 * One member, ready to be collected from — section 8 of the brief.
 *
 * There is no group sheet to work down any more, so the unit of work is the
 * person at the counter. Everything the cashier has to know before taking their
 * money is on this one panel: their categories, what this cycle expects, what
 * they have already paid, what is outstanding, their balance, when they are
 * next due, and what they have paid before.
 *
 * The figures come from `member_collection_view()` in one round trip and are
 * all derived — nothing here adds anything up in the browser, so what the
 * cashier reads is what the ledger says.
 */
export function MemberCollectionPanel({
  view,
  canRecord,
  canWaive,
}: {
  view: MemberCollectionView;
  canRecord: boolean;
  canWaive: boolean;
}) {
  const [recording, setRecording] = useState<SavingsScheduleRow | null>(null);
  const [waiving, setWaiving] = useState<SavingsScheduleRow | null>(null);

  const { member, current, share_progress: shares, history, schedules } = view;
  const tier = categoryTier(member.savings_category_code);
  const active = member.status === 'active';

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------------------------------------- who this is */}
      <section className="bg-surface shadow-card flex flex-wrap items-start gap-4 rounded-xl p-5">
        <Avatar name={member.full_name} src={member.photo_url} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/staff/members/${member.id}`}
              className="text-headline-lg-mobile font-headline-lg-mobile text-primary truncate hover:underline"
            >
              {member.full_name}
            </Link>
            <MemberStatusBadge status={member.status} />
          </div>
          <p className="text-label-md font-label-md text-on-surface-variant tabular mt-1 normal-case">
            {member.member_no} · {formatPhone(member.phone)}
            {member.address ? ` · ${member.address}` : ''}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {member.savings_category_name && member.savings_frequency ? (
              <Badge tone={tier.tone}>
                {member.savings_category_name} · {formatUGX(member.savings_expected_amount)}{' '}
                {SAVINGS_FREQUENCY_ADVERB[member.savings_frequency]}
              </Badge>
            ) : (
              <Badge tone="warning">No savings category</Badge>
            )}
            {member.share_category_name ? (
              <Badge tone="neutral">{member.share_category_name} shares</Badge>
            ) : (
              <Badge tone="neutral">No share category</Badge>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Savings balance" value={member.savings_balance} />
          <Stat
            label="Outstanding"
            value={member.savings_outstanding}
            tone={toNumber(member.savings_outstanding) > 0 ? 'text-error' : undefined}
          />
          <Stat label="Share value" value={member.share_value} />
        </dl>
      </section>

      {/* ------------------------------------------------- the current cycle */}
      {!member.savings_category_id ? (
        <section className="bg-secondary-fixed text-on-secondary-fixed flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
          <div className="flex min-w-0 items-center gap-3">
            <Icon name="info" size={24} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-button-text font-button-text">
                No savings category has been set for this member
              </p>
              <p className="text-body-md font-body-md mt-0.5">
                Nothing is expected of them and no schedule is raised until one is chosen.
              </p>
            </div>
          </div>
          <Link
            href={`/staff/members/${member.id}`}
            className="bg-white/90 text-on-secondary-fixed h-touch-target-min text-button-text font-button-text inline-flex shrink-0 items-center gap-2 rounded-lg px-4 font-semibold"
          >
            <Icon name="workspace_premium" size={20} />
            Set categories
          </Link>
        </section>
      ) : !current ? (
        <section className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="event_busy"
            title="No open cycle for this member"
            description={
              active
                ? 'Their next cycle will be raised automatically when it opens.'
                : `Cycles are not raised for a ${member.status} member.`
            }
          />
        </section>
      ) : (
        <section className="bg-surface shadow-card flex flex-col gap-4 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-label-md font-label-md text-on-surface-variant">
                Current cycle
              </p>
              <p className="text-body-lg font-body-lg text-on-surface font-semibold">
                {current.cycle}
              </p>
              <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                Due {formatDate(current.due_on)} · {SCHEDULE_HINTS[current.status]}
              </p>
            </div>
            <SavingsStatusBadge status={current.status} />
          </div>

          <dl className="border-outline-variant grid grid-cols-3 gap-3 border-y py-4">
            <Stat label="Expected" value={current.expected_amount} />
            <Stat label="Paid" value={current.paid_amount} tone="text-tertiary" />
            <Stat
              label="Outstanding"
              value={current.outstanding}
              tone={toNumber(current.outstanding) > 0 ? 'text-error' : undefined}
            />
          </dl>

          <ProgressBar
            value={percent(current.paid_amount, current.expected_amount)}
            tone={current.status === 'paid' ? 'tertiary' : 'primary'}
            label="Cycle progress"
          />

          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              icon="savings"
              className="flex-1"
              disabled={!canRecord || !active || current.status === 'waived'}
              onClick={() => setRecording(current)}
            >
              Record payment
            </Button>
            {canWaive && toNumber(current.paid_amount) === 0 && current.status !== 'waived' ? (
              <Button
                variant="outline"
                size="lg"
                icon="block"
                onClick={() => setWaiving(current)}
              >
                Waive
              </Button>
            ) : null}
          </div>

          {!active ? (
            <p className="text-label-md font-label-md text-error normal-case">
              Savings cannot be recorded for a {member.status} member.
            </p>
          ) : null}
        </section>
      )}

      {/* --------------------------------------------------- share progress */}
      {shares?.share_category_id && shares.target_shares ? (
        <section className="bg-surface shadow-card flex flex-col gap-3 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-button-text font-button-text text-on-surface">
              {shares.share_category_name} share progress
            </p>
            {shares.qualified ? (
              <Badge tone="success" dot>
                Qualified
              </Badge>
            ) : shares.qualification_lapsed ? (
              <Badge tone="error" dot>
                Deadline passed
              </Badge>
            ) : shares.qualifies_by ? (
              <Badge tone="neutral">By {formatDate(shares.qualifies_by)}</Badge>
            ) : null}
          </div>
          <ProgressBar
            value={toNumber(shares.progress_percent)}
            tone={
              shares.qualified ? 'tertiary' : shares.qualification_lapsed ? 'error' : 'primary'
            }
            label="Share category progress"
          />
          <p className="text-label-md font-label-md text-on-surface-variant normal-case">
            {shares.shares_owned} of {shares.target_shares} shares ·{' '}
            {shares.shares_remaining ?? 0} to go ·{' '}
            {formatUGX(shares.amount_remaining)} remaining
          </p>
        </section>
      ) : null}

      {/* -------------------------------------------------------- schedules */}
      <section className="bg-surface shadow-card overflow-hidden rounded-xl">
        <h2 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
          Savings schedule
        </h2>
        {schedules.length === 0 ? (
          <EmptyState
            icon="calendar_month"
            title="No schedules yet"
            description="Nothing has been raised for this member."
          />
        ) : (
          <ScrollRow arrows="overlay" label="Schedule, scrolls sideways">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                  <th className="p-4 font-semibold">Cycle</th>
                  <th className="p-4 font-semibold">Due</th>
                  <th className="p-4 text-right font-semibold">Expected</th>
                  <th className="p-4 text-right font-semibold">Paid</th>
                  <th className="p-4 text-right font-semibold">Outstanding</th>
                  <th className="p-4 font-semibold">Status</th>
                  {canRecord ? <th className="p-4 text-center font-semibold">Action</th> : null}
                </tr>
              </thead>
              <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                {schedules.map((s) => (
                  <tr
                    key={s.schedule_id}
                    className={clsx(
                      'transition-colors',
                      s.schedule_id === current?.schedule_id
                        ? 'bg-primary-fixed/40'
                        : 'hover:bg-surface-container-low',
                    )}
                  >
                    <td className="p-4 font-semibold">{s.cycle}</td>
                    <td className="text-on-surface-variant p-4 whitespace-nowrap">
                      {formatDate(s.due_on)}
                    </td>
                    <td className="tabular p-4 text-right">{formatUGX(s.expected_amount)}</td>
                    <td className="tabular text-tertiary p-4 text-right font-semibold">
                      {formatUGX(s.paid_amount)}
                    </td>
                    <td
                      className={clsx(
                        'tabular p-4 text-right',
                        toNumber(s.outstanding) > 0 && 'text-error font-semibold',
                      )}
                    >
                      {formatUGX(s.outstanding)}
                    </td>
                    <td className="p-4">
                      <SavingsStatusBadge status={s.status} />
                    </td>
                    {canRecord ? (
                      <td className="p-4 text-center">
                        <button
                          type="button"
                          disabled={!active || s.status === 'waived'}
                          onClick={() => setRecording(s)}
                          className="bg-surface-container-high hover:bg-surface-container text-label-md font-label-md text-primary h-touch-target-min inline-flex items-center rounded-lg px-3 font-semibold shadow-neu-sm transition-colors disabled:opacity-40"
                        >
                          Record
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRow>
        )}
      </section>

      {/* ---------------------------------------------------------- history */}
      <section className="bg-surface shadow-card overflow-hidden rounded-xl">
        <h2 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
          Savings history
        </h2>
        {history.length === 0 ? (
          <EmptyState
            icon="receipt_long"
            title="Nothing recorded yet"
            description="Payments appear here as they are taken."
          />
        ) : (
          <ul className="divide-outline-variant/70 divide-y">
            {history.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.transaction_id ? `/staff/transactions/${t.transaction_id}` : '#'}
                  className="hover:bg-surface-container-low flex items-center justify-between gap-3 p-4 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-body-md font-body-md text-on-surface truncate font-semibold">
                      {t.cycle ?? t.savings_category_name ?? 'Savings'}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant truncate normal-case">
                      {formatDate(t.transaction_date)} ·{' '}
                      {PAYMENT_METHOD_LABELS[t.payment_method]}
                      {t.external_ref ? ` · ${t.external_ref}` : ''}
                      {t.recorded_by_name ? ` · by ${t.recorded_by_name}` : ''}
                    </p>
                  </div>
                  <Money
                    value={t.amount}
                    className="text-button-text font-button-text text-tertiary shrink-0 font-semibold"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecordCollectionDialog
        row={recording}
        memberId={member.id}
        open={!!recording}
        onClose={() => setRecording(null)}
      />
      <WaiveScheduleDialog
        row={waiving}
        memberId={member.id}
        open={!!waiving}
        onClose={() => setWaiving(null)}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd
        className={clsx(
          'text-body-lg font-body-lg tabular truncate font-bold',
          tone ?? 'text-on-surface',
        )}
      >
        <Money value={value} />
      </dd>
    </div>
  );
}
