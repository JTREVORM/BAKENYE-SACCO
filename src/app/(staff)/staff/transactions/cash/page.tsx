import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getPickedMember } from '@/lib/picked-member';
import { PageTitle } from '@/components/ui/primitives';
import { CashMovementForm } from '@/components/forms/CashMovementForm';

export const metadata: Metadata = { title: 'Deposit or Withdrawal' };

export default async function CashMovementPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; type?: string }>;
}) {
  await requirePermission('cash.movement');
  const sp = await searchParams;
  const type = sp.type === 'withdrawal' ? 'withdrawal' : 'deposit';
  const member = await getPickedMember(sp.member);

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title={type === 'withdrawal' ? 'Record Withdrawal' : 'Record Deposit'}
        subtitle={
          type === 'withdrawal'
            ? "Pay out from a member's savings balance."
            : "Add an ad-hoc deposit to a member's savings."
        }
      />
      <CashMovementForm
        type={type}
        member={member}
        lockMember={!!member}
        availableBalance={member ? Number(member.savings_balance) : undefined}
        doneHref={member ? `/staff/members/${member.id}` : '/staff/transactions'}
      />
    </div>
  );
}
