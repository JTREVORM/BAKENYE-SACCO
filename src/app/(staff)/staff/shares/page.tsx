import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getShareUnitPrice } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { PageTitle, Icon, Money, Avatar } from '@/components/ui/primitives';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { formatUGX, toNumber } from '@/lib/money';
import { formatDate } from '@/lib/format';
import type { ShareLotRow } from '@/types/db';

export const metadata: Metadata = { title: 'Shares' };

/**
 * Share capital register.
 *
 * Two things a manager needs: the total capital the SACCO holds, and who holds
 * it. Share value is derived from the lots — quantity times the price paid at
 * the time — so a later change to the share price does not silently restate
 * historic purchases.
 */
export default async function StaffSharesPage() {
  const user = await requirePermission('shares.view');

  return (
    <div>
      <PageTitle
        title="Share Capital"
        subtitle="Member ownership stakes, held separately from savings."
        action={
          can(user.role, 'shares.sell') ? (
            <Link
              href="/staff/shares/sell"
              className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold transition-colors"
            >
              <Icon name="add" size={20} />
              <span className="hidden sm:inline">Record purchase</span>
              <span className="sm:hidden">Record</span>
            </Link>
          ) : undefined
        }
      />

      <Suspense fallback={<TableSkeleton rows={8} cols={5} />}>
        <Register canSell={can(user.role, 'shares.sell')} />
      </Suspense>
    </div>
  );
}

async function Register({ canSell }: { canSell: boolean }) {
  const supabase = await createClient();

  const [holdersRes, lotsRes, unitPrice] = await Promise.all([
    supabase
      .from('member_financials')
      .select('id, member_no, full_name, photo_url, share_count, share_value, status')
      .gt('share_count', 0)
      .order('share_value', { ascending: false })
      .limit(100),
    supabase
      .from('share_lots')
      .select('*, members!share_lots_member_id_fkey(full_name, member_no, photo_url)')
      .order('purchased_on', { ascending: false })
      .limit(15),
    getShareUnitPrice(),
  ]);

  if (holdersRes.error) {
    return (
      <ErrorState
        title="Unable to load the share register"
        description="Please check your connection and try again."
      />
    );
  }

  const holders = holdersRes.data ?? [];
  const lots = (lotsRes.data ?? []) as unknown as (ShareLotRow & {
    members: { full_name: string; member_no: string; photo_url: string | null } | null;
  })[];

  const totalShares = holders.reduce((s, h) => s + Number(h.share_count), 0);
  const totalValue = holders.reduce((s, h) => s + toNumber(h.share_value), 0);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <section className="gap-gutter grid grid-cols-1 sm:grid-cols-3">
        <div className="bg-primary text-on-primary shadow-pop relative overflow-hidden rounded-xl p-5">
          <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-xl" />
          <p className="text-label-md font-label-md text-primary-fixed-dim relative z-10">
            Total share capital
          </p>
          <Money
            value={totalValue}
            compact
            className="text-display-currency font-display-currency relative z-10 mt-1"
          />
        </div>

        <Stat label="Shares issued" value={totalShares.toLocaleString()} />
        <Stat label="Price per share" value={formatUGX(unitPrice)} />
      </section>

      {/* Recent purchases */}
      <section className="bg-surface shadow-card overflow-hidden rounded-xl">
        <div className="border-outline-variant bg-surface border-b p-4">
          <h2 className="text-button-text font-button-text text-on-surface font-bold">
            Recent purchases
          </h2>
        </div>
        {lots.length === 0 ? (
          <EmptyState
            icon="pie_chart"
            title="No share purchases yet"
            description="Recorded purchases will appear here with their receipts."
          />
        ) : (
          <ul className="divide-outline-variant/70 divide-y">
            {lots.map((lot) => (
              <li key={lot.id}>
                <Link
                  href={lot.transaction_id ? `/staff/transactions/${lot.transaction_id}` : '#'}
                  className="hover:bg-surface-container-low flex items-center gap-3 p-4 transition-colors"
                >
                  <Avatar name={lot.members?.full_name} src={lot.members?.photo_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-md font-body-md text-primary truncate font-semibold">
                      {lot.members?.full_name ?? 'Unknown member'}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                      {lot.members?.member_no} · {formatDate(lot.purchased_on)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money
                      value={lot.total_value}
                      className="text-body-md font-body-md text-on-surface font-semibold"
                    />
                    <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                      {lot.quantity} × {formatUGX(lot.unit_price)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Holders */}
      <section className="bg-surface shadow-card overflow-hidden rounded-xl">
        <div className="border-outline-variant bg-surface border-b p-4">
          <h2 className="text-button-text font-button-text text-on-surface font-bold">
            Shareholders ({holders.length})
          </h2>
        </div>

        {holders.length === 0 ? (
          <EmptyState
            icon="group"
            title="No shareholders yet"
            description="Members who buy shares will be listed here."
          />
        ) : (
          <>
            {/* Mobile: cards */}
            <ul className="divide-outline-variant/70 divide-y md:hidden">
              {holders.map((h) => (
                <li key={h.id} className="flex items-center gap-3 p-4">
                  <Avatar name={h.full_name} src={h.photo_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/staff/members/${h.id}`}
                      className="text-body-md font-body-md text-primary block truncate font-semibold"
                    >
                      {h.full_name}
                    </Link>
                    <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                      {h.member_no} · {h.share_count} {h.share_count === 1 ? 'share' : 'shares'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money
                      value={h.share_value}
                      className="text-body-md font-body-md text-on-surface font-semibold"
                    />
                    {canSell ? (
                      <Link
                        href={`/staff/shares/sell?member=${h.id}`}
                        className="text-label-md font-label-md text-primary mt-1 block normal-case"
                      >
                        Sell more
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">Member</th>
                    <th className="p-4 text-right font-semibold">Shares</th>
                    <th className="p-4 text-right font-semibold">Value</th>
                    <th className="p-4 text-right font-semibold">% of capital</th>
                    {canSell ? <th className="p-4 text-center font-semibold">Action</th> : null}
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {holders.map((h) => (
                    <tr key={h.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="p-4">
                        <Link href={`/staff/members/${h.id}`} className="min-h-touch-target-min flex items-center gap-3">
                          <Avatar name={h.full_name} src={h.photo_url} size={32} />
                          <div className="min-w-0">
                            <div className="text-primary truncate font-semibold">{h.full_name}</div>
                            <div className="text-on-surface-variant tabular text-xs">
                              {h.member_no}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="tabular p-4 text-right">{h.share_count}</td>
                      <td className="tabular p-4 text-right font-semibold">
                        <Money value={h.share_value} />
                      </td>
                      <td className="tabular text-on-surface-variant p-4 text-right">
                        {totalValue > 0
                          ? `${((toNumber(h.share_value) / totalValue) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      {canSell ? (
                        <td className="p-4 text-center">
                          <Link
                            href={`/staff/shares/sell?member=${h.id}`}
                            className="bg-surface-container-high hover:bg-surface-container text-label-md font-label-md text-primary inline-flex h-touch-target-min items-center rounded-lg px-3 font-semibold transition-colors shadow-neu-sm"
                          >
                            Sell
                          </Link>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface shadow-card rounded-xl p-5">
      <p className="text-label-md font-label-md text-on-surface-variant mb-1">
        {label}
      </p>
      <p className="text-display-currency font-display-currency text-on-surface tabular">{value}</p>
    </div>
  );
}
