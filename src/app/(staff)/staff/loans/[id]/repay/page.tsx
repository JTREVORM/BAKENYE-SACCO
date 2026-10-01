import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getLoanDetail } from '@/lib/loan-query';
import { getCollectionAccounts } from '@/lib/access-queries';
import { PageTitle } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { RecordRepaymentForm } from '@/components/forms/RecordRepaymentForm';

export const metadata: Metadata = { title: 'Record Repayment' };

export default async function StaffRepayPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('loans.repay');
  const { id } = await params;
  const [data, accounts] = await Promise.all([getLoanDetail(id), getCollectionAccounts()]);

  if (!data) notFound();

  const repayable = ['active', 'disbursed', 'defaulted'].includes(data.loan.status);

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Record Repayment"
        subtitle={`${data.loan.loan_no} · ${data.memberName} (${data.memberNo})`}
      />

      {repayable ? (
        <RecordRepaymentForm
          loan={data.balance}
          memberName={data.memberName}
          accounts={accounts}
          doneHref={`/staff/loans/${id}`}
        />
      ) : (
        <Alert tone="warning" title="This loan cannot take a repayment">
          Loan {data.loan.loan_no} is {data.loan.status.replace('_', ' ')}. Repayments can only be
          recorded against a loan that has been disbursed.
        </Alert>
      )}
    </div>
  );
}
