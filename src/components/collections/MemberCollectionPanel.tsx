'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RecordCollectionDialog } from './RecordCollectionDialog';
import { WaiveScheduleDialog } from './WaiveScheduleDialog';
import { Avatar, Badge, Money } from '@/components/ui/primitives';
import { SavingsStatusBadge, MemberStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { Button } from '@/components/ui/form';
import { formatDate, formatPhone, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { SAVINGS_STATUS_HINTS, depositCount, shareCount } from '@/lib/savings';
import { clsx } from '@/lib/clsx';
import type { MemberCollectionView, SavingsScheduleRow } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

/**
 * One member, ready to be collected from.
 *
 * Savings are open: the member says what they want to save and the cashier
 * records it. So this panel no longer asks what is expected, what is
 * outstanding or when they are next due — none of those exist. It shows what
 * they hold, what they have saved this month, what they hold in shares, and
 * what they have saved before.
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

  const { member, current, share_progress: shares, share_price: sharePrice, history, schedules } = view;
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
            <Badge tone="info">Savings open · any amount</Badge>
            <Badge tone="neutral">
              {shareCount(toNumber(member.shares_owned))}
              {sharePrice ? ` at ${formatUGX(sharePrice)} each` : ''}
            </Badge>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Total savings" value={member.savings_balance} />
          <Stat
            label="Saved this month"
            value={member.savings_this_month}
            tone="text-tertiary"
          />
          <Stat label="Share value" value={member.share_value} />
        </dl>
      </section>

      {/* --------------------------------------------------- this month */}
      {!current ? (
        <section className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="savings"
            title="Nothing saved this month yet"
            description={
              active
                ? 'Record any amount the member wants to save. There is no target and nothing is owed.'
                : `Savings cannot be recorded for a ${member.status} member.`
            }
          />
        </section>
      ) : (
        <section className="bg-surface shadow-card flex flex-col gap-4 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-label-md font-label-md text-on-surface-variant">This month</p>
              <p className="text-body-lg font-body-lg text-on-surface font-semibold">
                {current.cycle}
              </p>
              <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                {SAVINGS_STATUS_HINTS[current.status]}
              </p>
            </div>
            <SavingsStatusBadge status={current.status} />
          </div>

          <dl className="border-outline-variant grid grid-cols-2 gap-3 border-y py-4 sm:grid-cols-3">
            <Stat label="Saved this month" value={current.saved_amount} tone="text-tertiary" />
            <Stat label="Total savings" value={member.savings_balance} />
            <div className="min-w-0">
              <dt className="text-label-md font-label-md text-on-surface-variant truncate">
                Deposits
              </dt>
              <dd className="text-body-lg font-body-lg tabular text-on-surface truncate font-bold">
                {depositCount(toNumber(current.deposits))}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              icon="savings"
              className="flex-1"
              disabled={!canRecord || !active || current.status === 'waived'}
              onClick={() => setRecording(current)}
            >
              Record savings
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

      {/* -------------------------------------------------------- shares */}
      {shares ? (
        <section className="bg-surface shadow-card flex flex-col gap-3 rounded-xl p-5">
          <p className="text-button-text font-button-text text-on-surface">Shares</p>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-label-md font-label-md text-on-surface-variant truncate">
                Shares owned
              </dt>
              <dd className="text-body-lg font-body-lg tabular text-on-surface truncate font-bold">
                {toNumber(shares.shares_owned)}
              </dd>
            </div>
            <Stat label="Price per share" value={shares.share_price} />
            <Stat label="Total share value" value={shares.share_value} tone="text-tertiary" />
          </dl>
          <p className="text-label-md font-label-md text-on-surface-variant normal-case">
            {shares.last_purchase_on
              ? `Last bought ${formatDate(shares.last_purchase_on)}.`
              : 'No shares bought yet.'}{' '}
            A member may buy any number of shares.
          </p>
        </section>
      ) : null}

      {/* ------------------------------------------------- month by month */}
      <section className="bg-surface shadow-card overflow-hidden rounded-xl">
        <h2 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
          Savings by month
        </h2>
        {schedules.length === 0 ? (
          <EmptyState
            icon="calendar_month"
            title="No savings yet"
            description="Months appear here as savings are recorded."
          />
        ) : (
          <ScrollRow arrows="overlay" label="Savings by month, scrolls sideways">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                  <th className="p-4 font-semibold">Month</th>
                  <th className="p-4 text-right font-semibold">Deposits</th>
                  <th className="p-4 text-right font-semibold">Saved</th>
                  <th className="p-4 font-semibold">Last deposit</th>
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
                    <td className="tabular text-on-surface-variant p-4 text-right">
                      {toNumber(s.deposits)}
                    </td>
                    <td className="tabular text-tertiary p-4 text-right font-semibold">
                      {formatUGX(s.saved_amount)}
                    </td>
                    <td className="text-on-surface-variant p-4 whitespace-nowrap">
                      {s.last_paid_on ? formatDate(s.last_paid_on) : '—'}
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
                      {t.cycle ?? 'Savings'}
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
