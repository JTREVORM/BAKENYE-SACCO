import Link from 'next/link';
import { Icon, Money, Avatar } from '@/components/ui/primitives';
import { LoanStatusBadge, GuarantorStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { formatDate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type {
  LoanBalanceRow,
  LoanGuarantorRow,
  LoanRepaymentRow,
  LoanRow,
  LoanScheduleRow,
} from '@/types/db';

export type LoanDetailData = {
  loan: LoanRow;
  balance: LoanBalanceRow;
  productName: string;
  memberName: string;
  memberNo: string;
  schedule: LoanScheduleRow[];
  repayments: (LoanRepaymentRow & { reference?: string | null })[];
  guarantors: (LoanGuarantorRow & { member_name: string; member_no: string; photo_url: string | null })[];
};

/**
 * Full loan record.
 *
 * Shared by the member view and the staff view — the same numbers, the same
 * schedule, the same repayment history, so a member and a loan officer looking
 * at the screen together are looking at the same thing. Only the surrounding
 * actions differ, which the caller supplies.
 */
export function LoanDetail({
  data,
  actions,
  transactionBasePath,
}: {
  data: LoanDetailData;
  actions?: React.ReactNode;
  /** `/transactions` for members, `/staff/transactions` for staff. */
  transactionBasePath: string;
}) {
  const { loan, balance, schedule, repayments, guarantors } = data;
  const overdue = toNumber(balance.overdue_amount) > 0;
  const live = ['active', 'disbursed', 'defaulted'].includes(loan.status);

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* Header card */}
      <div
        className={clsx(
          'relative overflow-hidden rounded-xl p-5',
          live ? 'bg-primary text-on-primary' : 'bg-surface border-outline-variant border',
        )}
      >
        {live ? (
          <div className="bg-primary-container pointer-events-none absolute right-0 top-0 -mr-10 -mt-10 h-32 w-32 rounded-full opacity-50 blur-2xl" />
        ) : null}

        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span
              className={clsx(
                'text-label-md font-label-md mb-1 block',
                live ? 'text-primary-fixed' : 'text-on-surface-variant',
              )}
            >
              {data.productName} · {loan.loan_no}
            </span>
            <Money
              value={live ? balance.outstanding : loan.principal}
              className="text-display-currency font-display-currency block"
            />
            <span
              className={clsx(
                'text-body-md font-body-md',
                live ? 'text-primary-fixed-dim' : 'text-on-surface-variant',
              )}
            >
              {live ? 'Outstanding Balance' : 'Amount applied for'}
            </span>
          </div>
          <div className="shrink-0">
            <LoanStatusBadge status={loan.status} />
          </div>
        </div>

        {live ? (
          <div className="relative z-10 mt-4">
            <div className="text-label-md font-label-md text-on-primary mb-1 flex justify-between">
              <span>Progress</span>
              <span>{Math.round(toNumber(balance.percent_repaid))}% Paid</span>
            </div>
            <div className="bg-primary-container h-2 w-full overflow-hidden rounded-full">
              <div
                className="bg-secondary-container h-2 rounded-full"
                style={{ width: `${Math.min(100, toNumber(balance.percent_repaid))}%` }}
              />
            </div>
            <div className="text-label-md font-label-md text-primary-fixed-dim mt-1 flex justify-between gap-2 normal-case">
              <span>{formatUGX(balance.amount_paid)} paid</span>
              <span>Total: {formatUGX(loan.total_payable)}</span>
            </div>
          </div>
        ) : null}
      </div>

      {overdue ? (
        <div className="bg-error-container text-on-error-container flex items-start gap-3 rounded-xl p-4">
          <Icon name="warning" className="shrink-0" />
          <div>
            <p className="text-button-text font-button-text">This loan is overdue</p>
            <p className="text-body-md font-body-md">
              {formatUGX(balance.overdue_amount)} is past due
              {balance.days_overdue ? ` by ${balance.days_overdue} days` : ''}. Please settle it as
              soon as possible to avoid penalties.
            </p>
          </div>
        </div>
      ) : null}

      {actions}

      {/* Terms */}
      <section className="bg-surface border-outline-variant overflow-hidden rounded-xl border">
        <h3 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
          Loan Terms
        </h3>
        <dl className="divide-outline-variant/70 divide-y px-4">
          <Line label="Member" value={`${data.memberName} (${data.memberNo})`} />
          <Line label="Principal" value={formatUGX(loan.principal)} />
          <Line
            label="Interest"
            value={`${formatUGX(loan.interest_amount)} · ${loan.interest_rate}% p.a. ${loan.interest_method}`}
          />
          {toNumber(loan.processing_fee) > 0 ? (
            <Line label="Processing fee" value={formatUGX(loan.processing_fee)} />
          ) : null}
          <Line label="Total payable" value={formatUGX(loan.total_payable)} emphasis />
          <Line label="Repayment period" value={`${loan.period_months} months`} />
          <Line label="Monthly installment" value={formatUGX(loan.installment_amount)} />
          <Line label="Purpose" value={loan.purpose_category ?? loan.purpose} />
          {loan.purpose_category ? <Line label="Details" value={loan.purpose} /> : null}
          <Line label="Applied on" value={formatDate(loan.applied_on)} />
          {loan.approved_on ? <Line label="Approved on" value={formatDate(loan.approved_on)} /> : null}
          {loan.disbursed_on ? (
            <Line label="Disbursed on" value={formatDate(loan.disbursed_on)} />
          ) : null}
          {loan.completed_on ? (
            <Line label="Completed on" value={formatDate(loan.completed_on)} />
          ) : null}
          {loan.rejected_on ? (
            <>
              <Line label="Declined on" value={formatDate(loan.rejected_on)} />
              <Line label="Reason" value={loan.rejection_reason ?? '—'} />
            </>
          ) : null}
        </dl>
      </section>

      {/* Guarantors */}
      <section className="bg-surface border-outline-variant overflow-hidden rounded-xl border">
        <h3 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
          Guarantors ({guarantors.length})
        </h3>
        {guarantors.length === 0 ? (
          <EmptyState
            icon="handshake"
            title="No guarantors"
            description="This loan has no guarantors recorded."
          />
        ) : (
          <ul className="divide-outline-variant/70 divide-y">
            {guarantors.map((g) => (
              <li key={g.id} className="flex items-center gap-3 p-4">
                <Avatar name={g.member_name} src={g.photo_url} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="text-body-md font-body-md text-on-surface truncate font-semibold">
                    {g.member_name}
                  </p>
                  <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                    {g.member_no}
                    {g.responded_on ? ` · responded ${formatDate(g.responded_on)}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Money
                    value={g.guaranteed_amount}
                    className="text-body-md font-body-md text-on-surface block font-semibold"
                  />
                  <div className="mt-1">
                    <GuarantorStatusBadge status={g.status} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Repayment schedule */}
      {schedule.length > 0 ? (
        <section className="bg-surface border-outline-variant overflow-hidden rounded-xl border">
          <h3 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
            Repayment Schedule
          </h3>

          {/* Mobile: list. Desktop: the full table. Never a squashed table. */}
          <ul className="divide-outline-variant/70 divide-y md:hidden">
            {schedule.map((s) => {
              const paidThrough = cumulativePaid(schedule, s, toNumber(balance.amount_paid));
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-body-md font-body-md text-on-surface font-semibold">
                      Installment {s.installment_no}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                      Due {formatDate(s.due_on)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money
                      value={s.total_due}
                      className="text-body-md font-body-md text-on-surface block font-semibold"
                    />
                    <span
                      className={clsx(
                        'text-label-md font-label-md normal-case',
                        paidThrough ? 'text-tertiary' : 'text-on-surface-variant',
                      )}
                    >
                      {paidThrough ? 'Covered' : 'Outstanding'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="scroll-x hidden md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                  <th className="p-3 font-semibold">#</th>
                  <th className="p-3 font-semibold">Due date</th>
                  <th className="p-3 text-right font-semibold">Principal</th>
                  <th className="p-3 text-right font-semibold">Interest</th>
                  <th className="p-3 text-right font-semibold">Total</th>
                  <th className="p-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                {schedule.map((s) => {
                  const paidThrough = cumulativePaid(schedule, s, toNumber(balance.amount_paid));
                  return (
                    <tr key={s.id}>
                      <td className="p-3 tabular">{s.installment_no}</td>
                      <td className="p-3">{formatDate(s.due_on)}</td>
                      <td className="p-3 tabular text-right">{formatUGX(s.principal_due)}</td>
                      <td className="p-3 tabular text-right">{formatUGX(s.interest_due)}</td>
                      <td className="p-3 tabular text-right font-semibold">
                        {formatUGX(s.total_due)}
                      </td>
                      <td className="p-3">
                        <span
                          className={clsx(
                            'text-label-md font-label-md normal-case',
                            paidThrough ? 'text-tertiary' : 'text-on-surface-variant',
                          )}
                        >
                          {paidThrough ? 'Covered' : 'Outstanding'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Repayment history */}
      <section className="bg-surface border-outline-variant overflow-hidden rounded-xl border">
        <h3 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
          Repayment History ({repayments.length})
        </h3>
        {repayments.length === 0 ? (
          <EmptyState
            icon="credit_score"
            title="No repayments yet"
            description="Payments made against this loan will be listed here."
          />
        ) : (
          <ul className="divide-outline-variant/70 divide-y">
            {repayments.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.transaction_id ? `${transactionBasePath}/${r.transaction_id}` : '#'}
                  className="hover:bg-surface-container-low flex items-center justify-between gap-3 p-4 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-body-md font-body-md text-on-surface font-semibold">
                      {formatDate(r.paid_on)}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                      {PAYMENT_METHOD_LABELS[r.method]} · {formatUGX(r.principal_portion)} principal
                      + {formatUGX(r.interest_portion)} interest
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Money
                      value={r.amount}
                      className="text-body-md font-body-md text-tertiary font-bold"
                    />
                    <Icon name="chevron_right" size={20} className="text-on-surface-variant" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Line({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-body-md font-body-md text-on-surface-variant shrink-0">{label}</dt>
      <dd
        className={clsx(
          'text-body-md font-body-md text-on-surface min-w-0 break-words text-right',
          emphasis ? 'font-bold' : 'font-semibold',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Whether cumulative payments have covered everything due up to and including
 * this installment. Payments are applied in date order, so this is a running
 * total rather than a per-installment allocation.
 */
function cumulativePaid(
  schedule: LoanScheduleRow[],
  upTo: LoanScheduleRow,
  amountPaid: number,
): boolean {
  const dueThrough = schedule
    .filter((s) => s.installment_no <= upTo.installment_no)
    .reduce((sum, s) => sum + toNumber(s.total_due), 0);
  return amountPaid + 0.005 >= dueThrough;
}
