import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getSavingsPeriods, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { PaymentGuide } from '@/components/member/PaymentGuide';
import { formatUGX, toNumber } from '@/lib/money';

export const metadata: Metadata = { title: 'Save Money' };

export default async function DepositPage() {
  const user = await requireMember();
  const [m, unread, weekly, monthly] = await Promise.all([
    getMemberFinancials(user.memberId),
    getUnreadCount(),
    getSavingsPeriods(user.memberId, 'weekly', 1),
    getSavingsPeriods(user.memberId, 'monthly', 1),
  ]);

  const week = weekly[0];
  const month = monthly[0];

  // Suggest whatever is still outstanding this week, falling back to the month.
  const weekDue = week ? Math.max(toNumber(week.expected_amount) - toNumber(week.paid_amount), 0) : 0;
  const monthDue = month
    ? Math.max(toNumber(month.expected_amount) - toNumber(month.paid_amount), 0)
    : 0;

  return (
    <MemberShell title="Save Money" backHref="/savings" unreadCount={unread}>
      <PaymentGuide
        title="Save Money"
        subtitle="Add to your savings at the SACCO office, by mobile money, or by bank transfer."
        icon="savings"
        memberNo={user.memberNo ?? '—'}
        memberName={user.fullName}
        suggestedAmount={weekDue > 0 ? weekDue : monthDue > 0 ? monthDue : null}
        amountLabel={weekDue > 0 ? 'Outstanding this week' : 'Outstanding this month'}
        reference={`SAV-${user.memberNo ?? ''}`}
        details={[
          { label: 'Current savings balance', value: formatUGX(m?.savings_balance) },
          // A cycle the member's category does not collect on carries an
          // expectation of zero. Showing it as a "target" read "UGX 20,000 of
          // UGX 0", which is not a target at all - so only a cycle that
          // actually expects something is listed. Money paid into any cycle is
          // still in the balance above and in the transaction history.
          ...(week && toNumber(week.expected_amount) > 0
            ? [
                {
                  label: `Weekly target (${week.period_label})`,
                  value: `${formatUGX(week.paid_amount)} of ${formatUGX(week.expected_amount)}`,
                },
              ]
            : []),
          ...(month && toNumber(month.expected_amount) > 0
            ? [
                {
                  label: `Monthly target (${month.period_label})`,
                  value: `${formatUGX(month.paid_amount)} of ${formatUGX(month.expected_amount)}`,
                },
              ]
            : []),
        ]}
        backHref="/savings"
      />
    </MemberShell>
  );
}
