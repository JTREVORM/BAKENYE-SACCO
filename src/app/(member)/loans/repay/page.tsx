import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberLoans, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { PaymentGuide } from '@/components/member/PaymentGuide';
import { EmptyState } from '@/components/ui/states';
import { formatUGX, toNumber } from '@/lib/money';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Repay Loan' };

export default async function RepayPage({
  searchParams,
}: {
  searchParams: Promise<{ loan?: string }>;
}) {
  const user = await requireMember();
  const [loans, unread] = await Promise.all([getMemberLoans(user.memberId), getUnreadCount()]);
  const { loan: loanParam } = await searchParams;

  const live = loans.filter((l) => ['active', 'disbursed', 'defaulted'].includes(l.status));
  const loan = live.find((l) => l.loan_id === loanParam) ?? live[0] ?? null;

  if (!loan) {
    return (
      <MemberShell title="Repay Loan" backHref="/loans" unreadCount={unread}>
        <EmptyState
          icon="payments"
          title="No loan to repay"
          description="You do not have an active loan at the moment."
        />
      </MemberShell>
    );
  }

  const overdue = toNumber(loan.overdue_amount);

  return (
    <MemberShell title="Repay Loan" backHref={`/loans/${loan.loan_id}`} unreadCount={unread}>
      <PaymentGuide
        title="Repay Your Loan"
        subtitle={`Payment towards loan ${loan.loan_no}.`}
        icon="payments"
        memberNo={user.memberNo ?? '—'}
        memberName={user.fullName}
        suggestedAmount={overdue > 0 ? overdue : toNumber(loan.next_due_amount)}
        amountLabel={overdue > 0 ? 'Overdue amount' : 'Next installment'}
        reference={`LN-${loan.loan_no}`}
        details={[
          { label: 'Outstanding balance', value: formatUGX(loan.outstanding) },
          { label: 'Monthly installment', value: formatUGX(loan.installment_amount) },
          ...(loan.next_due_on
            ? [{ label: 'Next payment due', value: formatDate(loan.next_due_on) }]
            : []),
          ...(overdue > 0
            ? [
                {
                  label: 'Overdue',
                  value: `${formatUGX(overdue)}${
                    loan.days_overdue ? ` (${loan.days_overdue} days)` : ''
                  }`,
                },
              ]
            : []),
        ]}
        footnote="Paying more than the installment reduces your balance faster — there is no penalty for early repayment."
        backHref={`/loans/${loan.loan_id}`}
      />
    </MemberShell>
  );
}
