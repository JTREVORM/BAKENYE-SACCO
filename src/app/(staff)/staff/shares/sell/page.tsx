import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getShareUnitPrice } from '@/lib/queries';
import { getPickedMember } from '@/lib/picked-member';
import { createClient } from '@/lib/supabase/server';
import { PageTitle } from '@/components/ui/primitives';
import { BuySharesForm } from '@/components/forms/BuySharesForm';

export const metadata: Metadata = { title: 'Sell Shares' };

export default async function SellSharesPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  await requirePermission('shares.sell');
  const sp = await searchParams;

  const [member, unitPrice] = await Promise.all([
    getPickedMember(sp.member),
    getShareUnitPrice(),
  ]);

  let currentShares: number | undefined;
  if (member) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('member_shares')
      .select('share_count')
      .eq('member_id', member.id)
      .maybeSingle();
    currentShares = Number(data?.share_count ?? 0);
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Record Share Purchase"
        subtitle="Shares are bought in whole units at the current share price."
      />
      <BuySharesForm
        member={member}
        lockMember={!!member}
        unitPrice={unitPrice}
        currentShares={currentShares}
        doneHref={member ? `/staff/members/${member.id}` : '/staff/shares'}
      />
    </div>
  );
}
