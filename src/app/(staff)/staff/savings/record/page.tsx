import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getCollectionAccounts } from '@/lib/access-queries';
import { getPickedMember } from '@/lib/picked-member';
import { PageTitle } from '@/components/ui/primitives';
import { RecordSavingsForm } from '@/components/forms/RecordSavingsForm';

export const metadata: Metadata = { title: 'Record Savings' };

/**
 * Record savings for one member.
 *
 * The centralised collection screen is the usual door; this is the shorter one
 * for a cashier who already has the member open. Both settle through the same
 * database function, so they cannot drift apart.
 *
 * Nothing is prefilled. Savings are open: the amount is whatever the member has
 * brought, and seeding the field with a figure would be the SACCO suggesting
 * one.
 */
export default async function RecordSavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  await requirePermission('savings.record');
  const sp = await searchParams;
  // The accounts money may be received into come from Finance, never from a
  // list in this file.
  const [member, accounts] = await Promise.all([
    getPickedMember(sp.member),
    getCollectionAccounts(),
  ]);

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Record Savings"
        subtitle="Any amount the member chooses. There is no monthly target and nothing is owed."
      />
      <RecordSavingsForm
        member={member}
        lockMember={!!member}
        accounts={accounts}
        doneHref={member ? `/staff/members/${member.id}` : '/staff/savings/collect'}
      />
    </div>
  );
}
