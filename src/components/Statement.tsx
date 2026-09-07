import Image from 'next/image';
import { Money } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { StatementActions } from './StatementActions';
import { formatDate, formatDateTime, TXN_LABELS } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import { documentName } from '@/lib/print';
import type { MemberStatement } from '@/types/db';

/**
 * Member statement.
 *
 * Opening balance, every movement in the window with a running balance, and a
 * closing balance — the format a member can take to a bank or a court and have
 * it mean something.
 *
 * On mobile each movement is a card; from `md` up it becomes the full ledger
 * table. Printing always uses the table, because a printed statement in card
 * form is not a statement.
 */
export function Statement({ statement }: { statement: MemberStatement }) {
  const rows = statement.rows ?? [];
  const closing =
    rows.length > 0
      ? toNumber(rows[rows.length - 1].running_balance)
      : toNumber(statement.opening_balance);

  const totalIn = rows
    .filter((r) => ['weekly_savings', 'monthly_savings', 'deposit'].includes(r.type))
    .reduce((s, r) => s + toNumber(r.amount), 0);
  const totalOut = rows
    .filter((r) => r.type === 'withdrawal')
    .reduce((s, r) => s + toNumber(r.amount), 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Letterhead */}
      <div className="bg-surface border-outline-variant print-block rounded-xl border p-4">
        <div className="flex items-center gap-3">
          <Image
            src="/brand/bnd-logo.png"
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <p className="text-button-text font-button-text text-primary leading-tight">
              BAKENYE UNITY AND DEVELOPMENT SACCO
            </p>
            <p className="text-label-md font-label-md text-on-surface-variant normal-case">
              Member savings statement
            </p>
          </div>
        </div>

        <dl className="border-outline-variant mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
          <Meta label="Member" value={statement.member.full_name} />
          <Meta label="Member ID" value={statement.member.member_no} mono />
          <Meta label="Period" value={`${formatDate(statement.from)} – ${formatDate(statement.to)}`} />
          <Meta label="Generated" value={formatDateTime(statement.generated_at)} />
        </dl>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Summary label="Opening balance" value={statement.opening_balance} />
        <Summary label="Money in" value={totalIn} tone="tertiary" />
        <Summary label="Money out" value={totalOut} tone="error" />
        <Summary label="Closing balance" value={closing} tone="primary" emphasis />
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border-outline-variant rounded-xl border">
          <EmptyState
            icon="description"
            title="No activity in this period"
            description="Choose a different date range to see earlier transactions."
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {rows.map((r) => {
              const isIn = ['weekly_savings', 'monthly_savings', 'deposit'].includes(r.type);
              const affectsBalance = isIn || r.type === 'withdrawal';
              return (
                <div
                  key={r.reference}
                  className={clsx(
                    'bg-surface border-outline-variant rounded-xl border p-3',
                    r.status !== 'posted' && 'opacity-60',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-body-md font-body-md text-on-surface font-semibold">
                        {TXN_LABELS[r.type]}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                        {formatDate(r.occurred_on)}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant/70 tabular normal-case">
                        {r.reference}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money
                        value={r.amount}
                        className={clsx(
                          'text-body-md font-body-md font-bold',
                          r.status !== 'posted' && 'line-through',
                          isIn ? 'text-tertiary' : 'text-on-surface',
                        )}
                      />
                      {affectsBalance ? (
                        <p className="text-label-md font-label-md text-on-surface-variant tabular normal-case">
                          Bal. {formatUGX(r.running_balance)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop / print: the ledger table */}
          <div className="bg-surface border-outline-variant print-block hidden overflow-hidden rounded-xl border md:block">
            <div className="scroll-x">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b uppercase tracking-wider">
                    <th className="p-3 font-semibold">Date</th>
                    <th className="p-3 font-semibold">Reference</th>
                    <th className="p-3 font-semibold">Description</th>
                    <th className="p-3 text-right font-semibold">Money in</th>
                    <th className="p-3 text-right font-semibold">Money out</th>
                    <th className="p-3 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  <tr className="bg-surface-container-low/30">
                    <td className="p-3" colSpan={5}>
                      <em>Opening balance</em>
                    </td>
                    <td className="tabular p-3 text-right font-semibold">
                      {formatUGX(statement.opening_balance)}
                    </td>
                  </tr>

                  {rows.map((r) => {
                    const isIn = ['weekly_savings', 'monthly_savings', 'deposit'].includes(r.type);
                    const isOut = r.type === 'withdrawal';
                    return (
                      <tr
                        key={r.reference}
                        className={clsx(r.status !== 'posted' && 'text-on-surface-variant line-through')}
                      >
                        <td className="p-3 whitespace-nowrap">{formatDate(r.occurred_on)}</td>
                        <td className="tabular p-3 font-mono text-xs">{r.reference}</td>
                        <td className="p-3">
                          {TXN_LABELS[r.type]}
                          {r.description ? (
                            <span className="text-on-surface-variant"> — {r.description}</span>
                          ) : null}
                        </td>
                        <td className="tabular text-tertiary p-3 text-right">
                          {isIn ? formatUGX(r.amount) : ''}
                        </td>
                        <td className="tabular p-3 text-right">{isOut ? formatUGX(r.amount) : ''}</td>
                        <td className="tabular p-3 text-right font-semibold">
                          {isIn || isOut ? formatUGX(r.running_balance) : ''}
                        </td>
                      </tr>
                    );
                  })}

                  <tr className="bg-surface-container-low/50 font-bold">
                    <td className="p-3" colSpan={3}>
                      Closing balance
                    </td>
                    <td className="tabular text-tertiary p-3 text-right">{formatUGX(totalIn)}</td>
                    <td className="tabular p-3 text-right">{formatUGX(totalOut)}</td>
                    <td className="tabular p-3 text-right">{formatUGX(closing)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <p className="text-label-md font-label-md text-on-surface-variant text-center normal-case">
        This statement covers savings, deposits and withdrawals. Share capital and loan balances are
        reported separately.
      </p>

      <StatementActions
        documentTitle={documentName(
          'Statement',
          `${statement.member.full_name} ${statement.from} to ${statement.to}`,
        )}
      />
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant">{label}</dt>
      <dd
        className={clsx(
          'text-body-md font-body-md text-on-surface truncate font-semibold',
          mono && 'tabular font-mono',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Summary({
  label,
  value,
  tone = 'neutral',
  emphasis,
}: {
  label: string;
  value: unknown;
  tone?: 'neutral' | 'tertiary' | 'error' | 'primary';
  emphasis?: boolean;
}) {
  const colour = {
    neutral: 'text-on-surface',
    tertiary: 'text-tertiary',
    error: 'text-error',
    primary: 'text-primary',
  }[tone];

  return (
    <div
      className={clsx(
        'rounded-xl border p-3',
        emphasis ? 'bg-primary-fixed border-primary/20' : 'bg-surface border-outline-variant',
      )}
    >
      <p className="text-label-md font-label-md text-on-surface-variant">{label}</p>
      <Money value={value} className={clsx('text-body-lg font-body-lg mt-1 block font-bold', colour)} />
    </div>
  );
}
