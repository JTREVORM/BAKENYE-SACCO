import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getMemberSchedules, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { PaymentGuide } from '@/components/member/PaymentGuide';
import { depositCount } from '@/lib/savings';
import { formatUGX, toNumber } from '@/lib/money';

export const metadata: Metadata = { title: 'Save Money' };

/**
 * How to save.
 *
 * Savings are open, so there is deliberately no suggested amount: the member
 * decides what to save, and a figure printed here would read as one the SACCO
 * had set. What the page shows instead is where they stand — their balance and
 * what they have already saved this month.
 */
export default async function DepositPage() {
  const user = await requireMember();
  const [m, unread, months] = await Promise.all([
    getMemberFinancials(user.memberId),
    getUnreadCount(),
    getMemberSchedules(user.memberId, 1),
  ]);

  const month = months[0];

  return (
    <MemberShell title="Save Money" backHref="/savings" unreadCount={unread}>
      <PaymentGuide
        title="Save Money"
        subtitle="Add to your savings at the SACCO office, by mobile money, or by bank transfer. Any amount, as often as you like."
        icon="savings"
        memberNo={user.memberNo ?? '—'}
        memberName={user.fullName}
        suggestedAmount={null}
        amountLabel="Amount you choose"
        reference={`SAV-${user.memberNo ?? ''}`}
        details={[
          { label: 'Current savings balance', value: formatUGX(m?.savings_balance) },
          { label: 'Saved this month', value: formatUGX(m?.savings_this_month) },
          ...(month
            ? [
                {
                  label: `Deposits in ${month.period_label}`,
                  value: depositCount(toNumber(month.deposits)),
                },
              ]
            : []),
        ]}
        footnote="There is no monthly target. Save what suits you — a month you do not save is not owed, and nothing is charged for it."
        backHref="/savings"
      />
    </MemberShell>
  );
}
