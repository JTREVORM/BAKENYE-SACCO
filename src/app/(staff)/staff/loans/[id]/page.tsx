import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getLoanDetail } from '@/lib/loan-query';
import { getCollectionAccounts } from '@/lib/access-queries';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { LoanDetail } from '@/components/LoanDetail';
import { LoanActions } from './LoanActions';
import { toNumber } from '@/lib/money';

export const metadata: Metadata = { title: 'Loan' };

export default async function StaffLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('loans.view');
  const { id } = await params;
  const [data, accounts] = await Promise.all([getLoanDetail(id), getCollectionAccounts()]);

  if (!data) notFound();

  const pendingGuarantors = data.guarantors.filter((g) => g.status === 'pending').length;
  const netDisbursed = toNumber(data.loan.principal) - toNumber(data.loan.processing_fee);

  return (
    <div>
      <PageTitle
        title={data.loan.loan_no}
        subtitle={`${data.productName} for ${data.memberName} (${data.memberNo})`}
      />

      <LoanDetail
        data={data}
        transactionBasePath="/staff/transactions"
        actions={
          <LoanActions
            loanId={data.loan.id}
            loanNo={data.loan.loan_no}
            memberId={data.loan.member_id}
            status={data.loan.status}
            principal={toNumber(data.loan.principal)}
            processingFee={toNumber(data.loan.processing_fee)}
            netDisbursed={netDisbursed}
            memberName={data.memberName}
            accounts={accounts}
            guarantorsPending={pendingGuarantors}
            canAssess={can(user, 'loans.assess')}
            canApprove={can(user, 'loans.approve')}
            canDisburse={can(user, 'loans.disburse')}
            canRepay={can(user, 'loans.repay')}
          />
        }
      />
    </div>
  );
}
