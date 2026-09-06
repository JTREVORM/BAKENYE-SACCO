import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPickedMember } from '@/lib/picked-member';
import { PageTitle } from '@/components/ui/primitives';
import { RecordSavingsForm } from '@/components/forms/RecordSavingsForm';

export const metadata: Metadata = { title: 'Record Savings' };

export default async function RecordSavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; kind?: string }>;
}) {
  await requirePermission('savings.record');
  const sp = await searchParams;
  const member = await getPickedMember(sp.member);

  // Prefill the amount with the member's own target, so the common case is one
  // tap rather than typing a figure the cashier has to look up.
  let weeklyTarget: number | null = null;
  let monthlyTarget: number | null = null;

  if (member) {
    const supabase = await createClient();
    const { data: plans } = await supabase
      .from('savings_plans')
      .select('kind, target_amount')
      .eq('member_id', member.id)
      .is('active_to', null);

    weeklyTarget = plans?.find((p) => p.kind === 'weekly')?.target_amount ?? null;
    monthlyTarget = plans?.find((p) => p.kind === 'monthly')?.target_amount ?? null;
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Record Savings"
        subtitle="Book a weekly or monthly contribution against a member's account."
      />
      <RecordSavingsForm
        member={member}
        lockMember={!!member}
        defaultKind={sp.kind === 'monthly' ? 'monthly' : 'weekly'}
        weeklyTarget={weeklyTarget ? Number(weeklyTarget) : null}
        monthlyTarget={monthlyTarget ? Number(monthlyTarget) : null}
        doneHref={member ? `/staff/members/${member.id}` : '/staff/savings'}
      />
    </div>
  );
}
