import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getShareCategories, getShareProgress, getShareUnitPrice } from '@/lib/queries';
import { getPickedMember } from '@/lib/picked-member';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { Icon, PageTitle } from '@/components/ui/primitives';
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

  const [member, unitPrice, categories] = await Promise.all([
    getPickedMember(sp.member),
    getShareUnitPrice(),
    getShareCategories(),
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
  let target: { name: string; remaining: number } | null = null;

  if (member) {
    const supabase = await createClient();
    const [{ data }, progress] = await Promise.all([
      supabase.from('member_shares').select('share_count').eq('member_id', member.id).maybeSingle(),
      getShareProgress(member.id),
    ]);
    currentShares = Number(data?.share_count ?? 0);

    if (progress?.share_category_name && (progress.shares_remaining ?? 0) > 0) {
      target = { name: progress.share_category_name, remaining: progress.shares_remaining ?? 0 };
    }
  }

  // Quick picks: one share, plus each category's own target, so buying the
  // whole Gold or Diamond block is a single tap — and read from the categories,
  // so a fourth tier appears here without anybody editing this file.
  const quickPicks = Array.from(
    new Set([1, 5, 10, ...categories.map((c) => c.required_shares)]),
  ).sort((a, b) => a - b);

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Record Share Purchase"
        subtitle="Shares are bought in whole units at the SACCO's share price."
      />
      <BuySharesForm
        member={member}
        lockMember={!!member}
        unitPrice={unitPrice}
        currentShares={currentShares}
        quickPicks={quickPicks}
        target={target}
        doneHref={member ? `/staff/members/${member.id}` : '/staff/shares'}
      />
    </div>
  );
}
