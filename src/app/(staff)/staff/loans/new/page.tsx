import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getLoanProducts, getMemberFinancials } from '@/lib/queries';
import { PageTitle } from '@/components/ui/primitives';
import { Alert, EmptyState } from '@/components/ui/states';
import { LoanWizard } from '@/app/(member)/loans/apply/LoanWizard';
import { createClient } from '@/lib/supabase/server';
import { LOAN_STATUS_LABELS } from '@/lib/format';

export const metadata: Metadata = { title: 'New Loan Application' };

/**
 * Loan application captured by a loan officer on a member's behalf.
 *
 * Uses the same wizard the member sees, so the officer is walked through the
 * same questions in the same order and the member is quoted the same figures.
 */
export default async function StaffNewLoanPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  await requirePermission('loans.assess');
  const sp = await searchParams;

  if (!sp.member) {
    return (
      <div>
        <PageTitle title="New Loan Application" />
        <EmptyState
          icon="person"
          title="Choose a member first"
          description="Open the member's profile and start the application from there."
        />
      </div>
    );
  }

  const [member, products] = await Promise.all([
    getMemberFinancials(sp.member),
    getLoanProducts(),
  ]);

  if (!member) notFound();

  const supabase = await createClient();
  const { data: blocking } = await supabase
    .from('loans')
    .select('loan_no, status')
    .eq('member_id', sp.member)
    .in('status', ['applied', 'under_review', 'approved', 'disbursed', 'active'])
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        title="New Loan Application"
        subtitle={`On behalf of ${member.full_name} (${member.member_no})`}
      />

      {blocking ? (
        <Alert tone="warning" title="This member already has a loan in progress">
          Loan {blocking.loan_no} is {LOAN_STATUS_LABELS[blocking.status].toLowerCase()}. Close it
          before starting another application.
        </Alert>
      ) : products.length === 0 ? (
        <EmptyState
          icon="payments"
          title="No loan products available"
          description="Add a loan product before taking applications."
        />
      ) : (
        <LoanWizard
          memberId={member.id}
          memberName={member.full_name}
          products={products}
          savingsBalance={Number(member.savings_balance)}
          shareValue={Number(member.share_value)}
        />
      )}
    </div>
  );
}
