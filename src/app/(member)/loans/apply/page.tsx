import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { getLoanProducts, getMemberFinancials, getUnreadCount } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Alert, EmptyState } from '@/components/ui/states';
import { LoanWizard } from './LoanWizard';
import { LOAN_STATUS_LABELS } from '@/lib/format';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Apply for a Loan' };

/**
 * Loan application.
 *
 * A member with a live application or an outstanding loan is stopped here with
 * an explanation rather than being allowed to fill in six steps and then hit
 * the database's one-loan-at-a-time rule at the very end.
 */
export default async function ApplyPage() {
  const user = await requireMember();
  // Applying from the portal is a member permission the SACCO can switch off
  // on Roles & Permissions; apply_for_loan() refuses it in the database too.
  if (!can(user, 'portal.loan_apply')) redirect('/loans');
  const [products, financials, unread] = await Promise.all([
    getLoanProducts(),
    getMemberFinancials(user.memberId),
    getUnreadCount(),
  ]);

  const supabase = await createClient();
  const { data: blocking } = await supabase
    .from('loans')
    .select('id, loan_no, status')
    .eq('member_id', user.memberId)
    .in('status', ['applied', 'under_review', 'approved', 'disbursed', 'active'])
    .maybeSingle();

  return (
    <MemberShell title="Loan Application" backHref="/loans" unreadCount={unread}>
      <div className="py-4">
        {blocking ? (
          <div className="flex flex-col gap-4 py-6">
            <Alert tone="warning" title="You already have a loan in progress">
              Loan {blocking.loan_no} is currently{' '}
              {LOAN_STATUS_LABELS[blocking.status].toLowerCase()}. You can apply again once it is
              closed.
            </Alert>
            <Link
              href={`/loans/${blocking.id}`}
              className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg font-semibold"
            >
              View that loan
            </Link>
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon="payments"
            title="No loan products available"
            description="The SACCO has not opened any loan products yet. Please check with the office."
          />
        ) : (
          <LoanWizard
            memberId={user.memberId}
            memberName={user.fullName}
            products={products}
            savingsBalance={Number(financials?.savings_balance ?? 0)}
            shareValue={Number(financials?.share_value ?? 0)}
          />
        )}
      </div>
    </MemberShell>
  );
}
