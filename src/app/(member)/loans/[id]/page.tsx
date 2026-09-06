import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getUnreadCount } from '@/lib/queries';
import { getLoanDetail } from '@/lib/loan-query';
import { MemberShell } from '@/components/layout/MemberShell';
import { LoanDetail } from '@/components/LoanDetail';

export const metadata: Metadata = { title: 'Loan' };

export default async function MemberLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireMember();
  const { id } = await params;
  const [data, unread] = await Promise.all([getLoanDetail(id), getUnreadCount()]);

  // RLS lets a member read a loan they guarantee as well as their own. Both are
  // legitimately theirs to see; anything else returns nothing and lands here.
  if (!data) notFound();

  const isOwn = data.loan.member_id === user.memberId;
  const canRepay = isOwn && ['active', 'disbursed', 'defaulted'].includes(data.loan.status);

  return (
    <MemberShell title={data.loan.loan_no} backHref="/loans" unreadCount={unread}>
      <LoanDetail
        data={data}
        transactionBasePath="/transactions"
        actions={
          canRepay ? (
            <Link
              href={`/loans/repay?loan=${data.loan.id}`}
              className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center gap-2 rounded-lg font-semibold"
            >
              Make a repayment
            </Link>
          ) : !isOwn ? (
            <div className="bg-primary-fixed text-on-primary-fixed rounded-xl p-4">
              <p className="text-button-text font-button-text">You are a guarantor on this loan</p>
              <p className="text-body-md font-body-md mt-1">
                You can see it because you are backing it. Manage your guarantees under More →
                Guarantees.
              </p>
            </div>
          ) : null
        }
      />
    </MemberShell>
  );
}
