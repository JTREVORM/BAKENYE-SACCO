import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberLoans, getUnreadCount } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Money } from '@/components/ui/primitives';
import { LoanStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { formatDate, LOAN_STATUS_LABELS } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { LoanBalanceRow, LoanRow } from '@/types/db';

export const metadata: Metadata = { title: 'My Loans' };

const LIVE_STATUSES = ['active', 'disbursed', 'defaulted'];

/**
 * Member loans.
 *
 * `loans_mobile/code.html`, wired up: the royal-blue active-loan card with its
 * blurred `primary-container` corner, the gold progress bar, the Next Payment
 * strip, the two action buttons, the "Apply for a New Loan" row and the
 * application history list.
 */
export default async function LoansPage() {
  const user = await requireMember();
  const [loans, unread] = await Promise.all([getMemberLoans(user.memberId), getUnreadCount()]);

  const supabase = await createClient();
  const { data: applications } = await supabase
    .from('loans')
    .select('id, loan_no, principal, status, applied_on, product_id, purpose')
    .eq('member_id', user.memberId)
    .order('applied_on', { ascending: false })
    .limit(6);

  const { data: products } = await supabase.from('loan_products').select('id, name');
  const productName = new Map((products ?? []).map((p) => [p.id, p.name]));

  const active = loans.filter((l) => LIVE_STATUSES.includes(l.status));

  return (
    <MemberShell unreadCount={unread}>
      <div className="space-y-6 py-6">
        <div>
          <h2 className="text-headline-lg font-headline-lg text-on-surface">My Loans</h2>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            Manage your active loans and track repayments.
          </p>
        </div>

        {active.length > 0 ? (
          active.map((loan) => (
            <ActiveLoanCard
              key={loan.loan_id}
              loan={loan}
              productName={productName.get(
                (applications ?? []).find((a) => a.id === loan.loan_id)?.product_id ?? '',
              )}
            />
          ))
        ) : (
          <div className="bg-surface-container-lowest rounded-xl shadow-neu-sm">
            <EmptyState
              icon="payments"
              title="No active loan"
              description="When you take out a loan, its balance and repayment schedule will appear here."
            />
          </div>
        )}

        {/* Apply for a New Loan */}
        <Link
          href="/loans/apply"
          className="bg-surface shadow-neu hover:shadow-card-hover active:shadow-neu-pressed flex items-center justify-between gap-3 rounded-2xl p-4 transition-shadow"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-primary-fixed text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <Icon name="add_circle" />
            </div>
            <div className="min-w-0">
              <h3 className="text-body-lg font-body-lg text-on-surface font-semibold">
                Apply for a New Loan
              </h3>
              <p className="text-body-md font-body-md text-on-surface-variant">
                Explore our loan products
              </p>
            </div>
          </div>
          <Icon name="chevron_right" className="text-on-surface-variant shrink-0" />
        </Link>

        {/* Application history */}
        <div>
          <h3 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mb-3 flex items-center justify-between gap-3">
            <span>Recent Applications</span>
          </h3>

          {!applications || applications.length === 0 ? (
            <div className="bg-surface-container-lowest border-surface-variant rounded-lg border">
              <EmptyState
                icon="assignment"
                title="No applications yet"
                description="Your loan applications and their outcomes will be listed here."
              />
            </div>
          ) : (
            <div className="space-y-3">
              {applications.map((a) => (
                <ApplicationRow
                  key={a.id}
                  application={a as Pick<LoanRow, 'id' | 'loan_no' | 'principal' | 'status' | 'applied_on' | 'product_id' | 'purpose'>}
                  productName={productName.get(a.product_id) ?? 'Loan'}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </MemberShell>
  );
}

/* ------------------------------------------------------------------------ */

function ActiveLoanCard({ loan, productName }: { loan: LoanBalanceRow; productName?: string }) {
  const overdue = toNumber(loan.overdue_amount) > 0;
  const progress = Math.min(100, Math.max(0, toNumber(loan.percent_repaid)));

  return (
    <div className="bg-primary relative overflow-hidden rounded-xl p-5 shadow-[0_4px_12px_rgba(14,52,131,0.15)]">
      <div className="bg-primary-container pointer-events-none absolute right-0 top-0 -mr-10 -mt-10 h-32 w-32 rounded-full opacity-50 blur-2xl" />

      <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-label-md font-label-md text-primary-fixed mb-1 block">
            {productName ?? 'Loan'} · {loan.loan_no}
          </span>
          <Money
            value={loan.outstanding}
            className="text-display-currency font-display-currency text-on-primary block"
          />
          <span className="text-body-md font-body-md text-primary-fixed-dim">
            Outstanding Balance
          </span>
        </div>
        <div
          className={clsx(
            'text-label-md font-label-md flex shrink-0 items-center gap-1 rounded border px-2 py-1 shadow-sm',
            overdue
              ? 'bg-error-container text-on-error-container border-error'
              : 'bg-tertiary-container text-on-tertiary-container border-tertiary',
          )}
        >
          <span
            className={clsx(
              'h-1.5 w-1.5 rounded-full',
              overdue ? 'bg-error' : 'bg-tertiary-fixed',
            )}
          />
          {overdue ? 'Overdue' : LOAN_STATUS_LABELS[loan.status]}
        </div>
      </div>

      {/* Progress */}
      <div className="relative z-10 mb-4">
        <div className="text-label-md font-label-md text-on-primary mb-1 flex justify-between">
          <span>Progress</span>
          <span>{Math.round(progress)}% Paid</span>
        </div>
        <div className="bg-primary-container h-2 w-full overflow-hidden rounded-full">
          <div
            className="bg-secondary-container h-2 rounded-full transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-label-md font-label-md text-primary-fixed-dim mt-1 flex justify-between gap-2 normal-case">
          <span>{formatUGX(loan.amount_paid)} paid</span>
          <span>Total: {formatUGX(loan.total_payable)}</span>
        </div>
      </div>

      {/* Next payment */}
      {loan.next_due_on || overdue ? (
        <div className="bg-primary-container border-primary-fixed-dim/20 relative z-10 mb-5 flex items-center justify-between gap-3 rounded-lg border bg-opacity-50 p-3">
          <div className="min-w-0">
            <span className="text-label-md font-label-md text-primary-fixed block">
              {overdue ? 'Overdue amount' : 'Next Payment'}
            </span>
            <Money
              value={overdue ? loan.overdue_amount : loan.next_due_amount}
              className="text-body-lg font-body-lg text-on-primary font-bold"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-right">
            <Icon name="calendar_today" size={20} className="text-secondary-fixed" />
            <div>
              <span className="text-label-md font-label-md text-primary-fixed block">Due Date</span>
              <span className="text-body-md font-body-md text-on-primary font-semibold">
                {formatDate(loan.next_due_on)}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="relative z-10 flex gap-3">
        <Link
          href={`/loans/repay?loan=${loan.loan_id}`}
          className="bg-secondary-container hover:bg-secondary-fixed-dim text-on-secondary-container text-button-text font-button-text h-touch-target-min flex flex-1 items-center justify-center rounded-lg shadow-sm transition-colors"
        >
          Make Repayment
        </Link>
        <Link
          href={`/loans/${loan.loan_id}`}
          className="border-primary-fixed text-primary-fixed hover:bg-primary-container text-button-text font-button-text h-touch-target-min flex flex-1 items-center justify-center rounded-lg border bg-transparent transition-colors"
        >
          View Schedule
        </Link>
      </div>
    </div>
  );
}

function ApplicationRow({
  application,
  productName,
}: {
  application: Pick<LoanRow, 'id' | 'loan_no' | 'principal' | 'status' | 'applied_on' | 'purpose'>;
  productName: string;
}) {
  const settled = ['completed', 'rejected', 'written_off'].includes(application.status);

  return (
    <Link
      href={`/loans/${application.id}`}
      className={clsx(
        'bg-surface-container-lowest border-surface-variant shadow-card hover:bg-surface-container-low flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
        settled && 'opacity-70',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="bg-surface-container-high text-on-surface-variant flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
          <Icon name={settled ? 'check_circle' : 'assignment'} />
        </div>
        <div className="min-w-0">
          <div className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
            {productName}
          </div>
          <div className="text-body-md font-body-md text-on-surface-variant truncate">
            Applied {formatDate(application.applied_on)}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <Money
          value={application.principal}
          className="text-body-lg font-body-lg text-on-surface font-semibold"
        />
        <div className="mt-1">
          <LoanStatusBadge status={application.status} />
        </div>
      </div>
    </Link>
  );
}
