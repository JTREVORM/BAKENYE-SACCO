import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getShareUnitPrice } from '@/lib/queries';
import { getPickedMember } from '@/lib/picked-member';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { Icon, PageTitle } from '@/components/ui/primitives';
import { formatUGX } from '@/lib/money';
import { ErrorState } from '@/components/ui/states';
import { BuySharesForm } from '@/components/forms/BuySharesForm';

export const metadata: Metadata = { title: 'Sell Shares' };

/**
 * Record a share purchase.
 *
 * The price comes from the SACCO's one share price and nowhere else — the same
 * value `buy_shares()` charges — so the total the cashier confirms is the total
 * the ledger records. If that price cannot be read, the form is not shown at
 * all: a purchase priced by a fallback number would be a wrong sale.
 */
export default async function SellSharesPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const user = await requirePermission('shares.sell');
  const sp = await searchParams;

  const [member, unitPrice] = await Promise.all([
    getPickedMember(sp.member),
    getShareUnitPrice(),
  ]);

  if (unitPrice === null) {
    return (
      <div className="mx-auto max-w-xl">
        <PageTitle title="Record Share Purchase" />
        <ErrorState
          title="The share price is not set"
          description="Shares cannot be sold until the SACCO's share price is set under Settings."
          action={
            can(user, 'settings.manage') ? (
              <Link
                href="/staff/settings?section=financial"
                className="bg-primary text-on-primary h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold"
              >
                <Icon name="settings" size={20} />
                Open Settings
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

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

  // Convenience taps, not limits. There is no share category and no ceiling:
  // a member may buy any whole number of shares they choose.
  const quickPicks = [1, 5, 10, 20, 50, 100];

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Record Share Purchase"
        subtitle={`Any whole number of shares, at the SACCO's price of ${formatUGX(unitPrice)} each.`}
      />
      <BuySharesForm
        member={member}
        lockMember={!!member}
        unitPrice={unitPrice}
        currentShares={currentShares}
        quickPicks={quickPicks}
        doneHref={member ? `/staff/members/${member.id}` : '/staff/shares'}
      />
    </div>
  );
}
