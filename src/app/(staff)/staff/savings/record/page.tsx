import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPickedMember } from '@/lib/picked-member';
import { PageTitle } from '@/components/ui/primitives';
import { RecordSavingsForm } from '@/components/forms/RecordSavingsForm';

export const metadata: Metadata = { title: 'Record Savings' };

/**
 * Record a contribution for one member, without picking a schedule first.
 *
 * The centralised collection screen is the usual door; this is the shorter one
 * for a cashier who already has the member open. Both settle through the same
 * database function, so they cannot drift apart.
 */
export default async function RecordSavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; kind?: string }>;
}) {
  await requirePermission('savings.record');
  const sp = await searchParams;
  const member = await getPickedMember(sp.member);

  // Prefill the amount with what is actually expected of this member, so the
  // common case is one tap rather than typing a figure the cashier has to look
  // up. A personal savings plan wins where one has been set for them;
  // otherwise it is their savings category's own amount. With neither, the
  // field stays empty rather than being seeded with a number nobody agreed.
  let weeklyTarget: number | null = null;
  let monthlyTarget: number | null = null;
  let defaultKind: 'weekly' | 'monthly' = sp.kind === 'monthly' ? 'monthly' : 'weekly';

  if (member) {
    const supabase = await createClient();
    const [{ data: plans }, { data: category }] = await Promise.all([
      supabase
        .from('savings_plans')
        .select('kind, target_amount')
        .eq('member_id', member.id)
        .is('active_to', null),
      supabase
        .from('members')
        .select('savings_categories ( amount, frequency, status )')
        .eq('id', member.id)
        .maybeSingle(),
    ]);

    const tier = (
      category as { savings_categories?: { amount: number; frequency: 'weekly' | 'monthly'; status: string } | null } | null
    )?.savings_categories;

    if (tier && tier.status === 'active') {
      if (tier.frequency === 'weekly') weeklyTarget = Number(tier.amount);
      else monthlyTarget = Number(tier.amount);
      // Open on the cadence this member actually saves on, unless the caller
      // asked for a specific one.
      if (!sp.kind) defaultKind = tier.frequency;
    }

    const weeklyPlan = plans?.find((p) => p.kind === 'weekly')?.target_amount;
    const monthlyPlan = plans?.find((p) => p.kind === 'monthly')?.target_amount;
    if (weeklyPlan != null) weeklyTarget = Number(weeklyPlan);
    if (monthlyPlan != null) monthlyTarget = Number(monthlyPlan);
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Record Savings"
        subtitle="Book a contribution against a member's own savings schedule."
      />
      <RecordSavingsForm
        member={member}
        lockMember={!!member}
        defaultKind={defaultKind}
        weeklyTarget={weeklyTarget}
        monthlyTarget={monthlyTarget}
        doneHref={member ? `/staff/members/${member.id}` : '/staff/savings/collect'}
      />
    </div>
  );
}
