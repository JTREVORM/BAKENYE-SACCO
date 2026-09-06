import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getShareUnitPrice, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { PaymentGuide } from '@/components/member/PaymentGuide';
import { formatUGX } from '@/lib/money';

export const metadata: Metadata = { title: 'Buy Shares' };

export default async function BuySharesPage() {
  const user = await requireMember();
  const [m, unitPrice, unread] = await Promise.all([
    getMemberFinancials(user.memberId),
    getShareUnitPrice(),
    getUnreadCount(),
  ]);

  return (
    <MemberShell title="Buy Shares" backHref="/shares" unreadCount={unread}>
      <PaymentGuide
        title="Buy Shares"
        subtitle="Shares are your stake in the SACCO. They are separate from your savings and are not withdrawable."
        icon="pie_chart"
        memberNo={user.memberNo ?? '—'}
        memberName={user.fullName}
        suggestedAmount={unitPrice}
        amountLabel="Price of one share"
        reference={`SHR-${user.memberNo ?? ''}`}
        details={[
          { label: 'Price per share', value: formatUGX(unitPrice) },
          { label: 'Shares you hold', value: `${m?.share_count ?? 0}` },
          { label: 'Value of your shares', value: formatUGX(m?.share_value) },
        ]}
        footnote="Tell the cashier how many shares you want to buy — the total is worked out from the current share price."
        backHref="/shares"
      />
    </MemberShell>
  );
}
