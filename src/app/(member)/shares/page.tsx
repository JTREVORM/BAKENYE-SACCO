import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getShareUnitPrice, getUnreadCount } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Money } from '@/components/ui/primitives';
import { EmptyState, Alert } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { ShareLotRow } from '@/types/db';

export const metadata: Metadata = { title: 'My Shares' };

/**
 * Member share capital.
 *
 * Stitch never exported a shares screen, so this is built from the parts it did
 * define: the `secondary-container` gold ramp it reserved for share purchases
 * in the transaction feed and the dashboard tile, plus the same balance-hero and
 * history-stack composition as the savings screen.
 *
 * The screen goes out of its way to state that shares are not savings, because
 * conflating the two is the single most common member misunderstanding in a
 * SACCO — and the brief is explicit that the balances must never be mixed.
 */
export default async function SharesPage() {
  const user = await requireMember();
  const [m, unitPrice, unread] = await Promise.all([
    getMemberFinancials(user.memberId),
    getShareUnitPrice(),
    getUnreadCount(),
  ]);

  const supabase = await createClient();
  const { data: lots } = await supabase
    .from('share_lots')
    .select('*')
    .eq('member_id', user.memberId)
    .order('purchased_on', { ascending: false })
    .limit(20);

  const count = Number(m?.share_count ?? 0);
  const value = Number(m?.share_value ?? 0);

  return (
    <MemberShell unreadCount={unread}>
      <div className="flex flex-col gap-6 py-4">
        <div>
          <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
            My Shares
          </h1>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            Your ownership stake in the SACCO.
          </p>
        </div>

        {/* Share capital hero — gold, so it never reads as a savings balance. */}
        <section className="bg-secondary-container text-on-secondary-container relative overflow-hidden rounded-xl p-6 shadow-lg">
          <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-white opacity-20 blur-2xl" />
          <p className="font-label-md text-label-md relative z-10 mb-1 opacity-80">
            Share Capital
          </p>
          <Money
            value={value}
            className="font-display-currency text-display-currency relative z-10 block"
          />

          <div className="relative z-10 mt-5 flex flex-wrap items-end justify-between gap-3">
            <div className="bg-white/40 rounded-lg px-4 py-2">
              <p className="font-label-md text-label-md opacity-80">Shares held</p>
              <p className="font-headline-lg-mobile text-headline-lg-mobile tabular font-bold">
                {count}
              </p>
            </div>
            <div className="text-right">
              <p className="font-label-md text-label-md opacity-80">Price per share</p>
              <p className="font-body-lg text-body-lg font-bold">{formatUGX(unitPrice)}</p>
            </div>
          </div>

          <p className="font-body-md text-body-md relative z-10 mt-4 opacity-80">
            {count} × {formatUGX(unitPrice)} = {formatUGX(value)}
          </p>
        </section>

        <Link
          href="/shares/buy"
          className="bg-surface-container-lowest border-outline-variant shadow-card hover:border-primary flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-secondary-container text-on-secondary-container flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <Icon name="add_circle" />
            </div>
            <div className="min-w-0">
              <h3 className="text-body-lg font-body-lg text-on-surface font-semibold">
                Buy more shares
              </h3>
              <p className="text-body-md font-body-md text-on-surface-variant">
                Grow your stake in the SACCO
              </p>
            </div>
          </div>
          <Icon name="chevron_right" className="text-on-surface-variant shrink-0" />
        </Link>

        <Alert tone="info" title="Shares are not savings">
          Share capital is your permanent stake in the SACCO. It earns you a say in how the
          cooperative is run and a share of any surplus, but unlike savings it cannot be withdrawn
          on demand — it is transferred or refunded only when you exit the SACCO.
        </Alert>

        {/* Purchase history */}
        <section>
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-3">
            Purchase History
          </h2>

          {!lots || lots.length === 0 ? (
            <div className="bg-surface-container-lowest border-surface-container-high rounded-xl border">
              <EmptyState
                icon="pie_chart"
                title="No shares yet"
                description="When you buy shares, each purchase will be listed here with its receipt."
                action={
                  <Link
                    href="/shares/buy"
                    className="bg-primary text-on-primary h-touch-target-min text-button-text font-button-text inline-flex items-center rounded-lg px-5 font-semibold"
                  >
                    Buy shares
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {(lots as ShareLotRow[]).map((lot) => (
                <Link
                  key={lot.id}
                  href={lot.transaction_id ? `/transactions/${lot.transaction_id}` : '/transactions'}
                  className="bg-surface-container-lowest border-surface-container-high shadow-card hover:bg-surface-container-low flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="bg-secondary-container text-on-secondary-container flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
                      <Icon name="pie_chart" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-body-lg text-body-lg text-on-surface truncate font-semibold">
                        {lot.quantity} {lot.quantity === 1 ? 'share' : 'shares'}
                      </p>
                      <div className="text-on-surface-variant font-label-md text-label-md mt-1 flex flex-wrap items-center gap-2 normal-case">
                        <span>{formatDate(lot.purchased_on)}</span>
                        <span className="bg-outline-variant h-1 w-1 rounded-full" />
                        <span>at {formatUGX(lot.unit_price)} each</span>
                      </div>
                    </div>
                  </div>
                  <Money
                    value={lot.total_value}
                    className="font-button-text text-button-text text-on-surface shrink-0 font-semibold"
                  />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </MemberShell>
  );
}
