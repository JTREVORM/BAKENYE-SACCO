import Link from 'next/link';
import { Icon, Money } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { MEMBERSHIP_FEE_STATUS_HINTS, MEMBERSHIP_FEE_STATUS_LABELS, MEMBERSHIP_FEE_STATUS_TONES } from '@/lib/fees';
import { clsx } from '@/lib/clsx';
import type { MemberMembershipFee } from '@/types/db';

/**
 * Where this member stands on the membership fee, on their own record.
 *
 * Required is the sum of what they were charged — which for a member who
 * joined before a fee change is their original charge plus whatever
 * adjustment was raised, each listed separately, so the record says what was
 * asked and when. Paid is the sum of the payments that are still posted: a
 * reversed payment is listed but counts for nothing.
 */
export function MembershipFeeCard({ fee }: { fee: MemberMembershipFee }) {
  const outstanding = toNumber(fee.outstanding_amount);

  return (
    <section className="bg-surface shadow-card overflow-hidden rounded-xl">
      <header className="border-outline-variant flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-title-md font-title-md text-on-surface flex items-center gap-2">
          <Icon name="badge" size={20} className="text-primary" />
          Membership fee
        </h2>
        <span
          className={clsx(
            'text-label-md font-label-md inline-flex shrink-0 items-center rounded-full px-3 py-1 normal-case',
            MEMBERSHIP_FEE_STATUS_TONES[fee.status],
          )}
        >
          {MEMBERSHIP_FEE_STATUS_LABELS[fee.status]}
        </span>
      </header>

      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-3 gap-3">
          <Figure label="Required" value={fee.required_amount} />
          <Figure label="Total paid" value={fee.paid_amount} tone="text-tertiary" />
          <Figure
            label="Outstanding"
            value={fee.outstanding_amount}
            tone={outstanding > 0 ? 'text-primary' : 'text-on-surface-variant'}
          />
        </dl>

        <p className="text-label-md font-label-md text-on-surface-variant normal-case">
          {MEMBERSHIP_FEE_STATUS_HINTS[fee.status]}
          {fee.last_payment_on ? ` Last payment ${formatDate(fee.last_payment_on)}.` : ''}
        </p>

        {/* What they were charged, and why, when it is more than one thing. */}
        {fee.charges.length > 1 ? (
          <div>
            <h3 className="text-label-md font-label-md text-on-surface-variant mb-2">
              What was charged
            </h3>
            <ul className="flex flex-col gap-2">
              {fee.charges.map((c) => (
                <li
                  key={c.charge_id}
                  className="bg-surface-container flex flex-wrap items-baseline justify-between gap-2 rounded-lg p-3"
                >
                  <span className="min-w-0">
                    <span className="text-body-md text-on-surface block font-semibold">
                      {c.fee_name}
                    </span>
                    <span className="text-label-md font-label-md text-on-surface-variant block normal-case">
                      {formatDate(c.charged_on)}
                      {c.charge_reason ? ` · ${c.charge_reason}` : ''}
                    </span>
                  </span>
                  <span className="tabular text-body-md shrink-0 font-semibold">
                    {formatUGX(c.charged_amount)}
                    {toNumber(c.outstanding_amount) > 0 ? (
                      <span className="text-primary ml-2 text-xs">
                        {formatUGX(c.outstanding_amount)} left
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* The payment history. */}
        <div>
          <h3 className="text-label-md font-label-md text-on-surface-variant mb-2">
            Payment history
          </h3>
          {fee.payments.length === 0 ? (
            <p className="text-body-md font-body-md text-on-surface-variant normal-case">
              Nothing has been received towards the membership fee yet.
            </p>
          ) : (
            <ul className="divide-outline-variant/70 divide-y">
              {fee.payments.map((p, i) => (
                <li
                  key={`${p.reference ?? 'p'}-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span className="min-w-0">
                    <span className="text-body-md text-on-surface block font-semibold">
                      {formatDate(p.paid_on)}
                      {p.transaction_status === 'reversed' ? (
                        <span className="text-error ml-2 text-xs font-semibold">Reversed</span>
                      ) : null}
                    </span>
                    <span className="text-label-md font-label-md text-on-surface-variant tabular block normal-case">
                      {p.receipt_no ?? p.reference ?? '—'}
                      {p.external_ref ? ` · ${p.external_ref}` : ''}
                    </span>
                  </span>
                  <Money
                    value={p.amount}
                    className={clsx(
                      'tabular text-body-md shrink-0 font-semibold',
                      p.transaction_status === 'reversed'
                        ? 'text-on-surface-variant line-through'
                        : 'text-tertiary',
                    )}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {outstanding > 0 ? (
          <Link
            href="/staff/membership-fees"
            className="text-primary text-button-text font-button-text inline-flex items-center gap-1 self-start"
          >
            Collect in Membership Fees
            <Icon name="chevron_right" size={18} />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd>
        <Money
          value={value}
          compact
          className={clsx('text-body-lg font-body-lg mt-0.5 font-bold', tone ?? 'text-on-surface')}
        />
      </dd>
    </div>
  );
}
