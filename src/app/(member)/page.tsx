import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getRecentTransactions, getUnreadCount } from '@/lib/queries';
import { getMemberFees } from '@/lib/access-queries';
import { can } from '@/lib/rbac';
import { formatUGX } from '@/lib/money';
import { ListSkeleton } from '@/components/ui/states';
import {
  MemberDashboardFrame, MemberBalances, MemberBalancesFallback,
  MemberQuickActions, MemberTransactionSection, MemberTransactions, PendingMembershipNotice,
} from '@/components/member/MemberDashboard';

export const metadata: Metadata = { title: 'Home' };

/** Every figure and receipt is scoped to the signed-in member, as before.
 * Only the presentation is shared with the development QA harness. */
export default async function MemberDashboard() {
  const user = await requireMember();
  const unread = await getUnreadCount();
  return <MemberDashboardFrame fullName={user.fullName} memberNo={user.memberNo} status={user.memberStatus} unreadCount={unread}>
    {user.memberStatus === 'pending' ? <Suspense fallback={null}><PendingNotice memberId={user.memberId} /></Suspense> : null}
    <Suspense fallback={<MemberBalancesFallback />}><Balances memberId={user.memberId} /></Suspense>
    <MemberQuickActions canApply={can(user, 'portal.loan_apply')} />
    <MemberTransactionSection>
      <Suspense fallback={<ListSkeleton rows={3} />}><RecentTransactions memberId={user.memberId} /></Suspense>
    </MemberTransactionSection>
  </MemberDashboardFrame>;
}

async function Balances({ memberId }: { memberId: string }) {
  const m = await getMemberFinancials(memberId);
  if (!m) return <MemberBalancesFallback />;
  return <MemberBalances member={m} />;
}

async function RecentTransactions({ memberId }: { memberId: string }) {
  const rows = await getRecentTransactions(memberId, 5);
  return <MemberTransactions rows={rows} />;
}

/** Why a newly registered member is pending, from their own fee charges. */
async function PendingNotice({ memberId }: { memberId: string }) {
  const fees = await getMemberFees(memberId);
  const owed = fees.filter((f) => f.status === 'unpaid' && f.is_mandatory && f.charged_at_registration);
  const total = owed.reduce((sum, f) => sum + Number(f.amount), 0);

  return (
    <PendingMembershipNotice>
      {total > 0
        ? `Registration fees of ${formatUGX(total)} (${owed.map((f) => f.fee_name).join(', ')}) are still to be paid. Your membership becomes active once the SACCO records the payment.`
        : 'The SACCO office will activate your membership shortly.'}
    </PendingMembershipNotice>
  );
}
