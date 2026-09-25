import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getShareUnitPrice, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { PaymentGuide } from '@/components/member/PaymentGuide';
import { Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';

export const metadata: Metadata = { title: 'Buy Shares' };

export default async function BuySharesPage() {
  const user = await requireMember();
  const [m, unitPrice, unread] = await Promise.all([
    getMemberFinancials(user.memberId),
    getShareUnitPrice(),
    getUnreadCount(),
  ]);

  // Without the SACCO's share price there is nothing true to tell the member to
  // pay, so the guide is withheld rather than filled with a guessed amount.
  if (unitPrice === null) {
    return (
      <MemberShell title="Buy Shares" backHref="/shares" unreadCount={unread}>
        <div className="flex flex-col gap-4 py-4">
          <Alert tone="warning" title="The share price is not available right now">
            Please ask at the SACCO office for the current price of a share before paying.
          </Alert>
          <Link
            href="/shares"
            className="text-primary text-button-text font-button-text h-touch-target-min inline-flex items-center"
          >
            Back to my shares
          </Link>
        </div>
      </MemberShell>
    );
  }

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
          { label: '5 shares', value: formatUGX(unitPrice * 5) },
          { label: '20 shares', value: formatUGX(unitPrice * 20) },
          { label: '100 shares', value: formatUGX(unitPrice * 100) },
        ]}
        footnote="Buy as many shares as you like — there is no limit and no share category. The total is the number of shares times the price above."
        backHref="/shares"
      />
    </MemberShell>
  );
}
