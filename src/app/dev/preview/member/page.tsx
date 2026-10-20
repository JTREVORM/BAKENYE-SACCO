import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  MemberDashboardFrame, MemberBalances, MemberQuickActions,
  MemberTransactionSection, MemberTransactions, PendingMembershipNotice,
} from '@/components/member/MemberDashboard';
import { FIXTURE_MEMBERS, FIXTURE_TRANSACTIONS } from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Member dashboard review', robots: { index: false } };

/** Development only. No session impersonation, writes or financial actions.
 * Every scenario uses an existing member and only their own transactions. */
export default async function MemberPreview({ searchParams }: {
  searchParams: Promise<{ member?: string; limited?: string; state?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const sp = await searchParams;
  const sample = FIXTURE_MEMBERS.find(m => m.id === sp.member) ?? FIXTURE_MEMBERS[0];
  // Empty/pending are presentation states, not fabricated transaction records.
  const member = sp.state === 'empty' ? { ...sample, savings_balance: 0, share_value: 0, share_count: 0, loan_balance: 0, active_loans: 0, savings_this_month: 0, next_due_on: null, next_due_amount: null, overdue_amount: 0 } : sample;
  const rows = sp.state === 'empty' ? [] : FIXTURE_TRANSACTIONS.filter(t => t.member_id === member.id).slice(0, 5);
  const status = sp.state === 'pending' ? 'pending' : member.status;
  return <MemberDashboardFrame fullName={member.full_name} memberNo={member.member_no} status={status} unreadCount={3}>
    {status === 'pending' ? <PendingMembershipNotice>The SACCO office will activate your membership shortly.</PendingMembershipNotice> : null}
    <MemberBalances member={member} />
    <MemberQuickActions canApply={!sp.limited} />
    <MemberTransactionSection><MemberTransactions rows={rows} /></MemberTransactionSection>
  </MemberDashboardFrame>;
}
