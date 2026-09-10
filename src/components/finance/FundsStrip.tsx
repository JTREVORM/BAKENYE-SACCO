import Link from 'next/link';
import { Icon } from '@/components/ui/primitives';
import { getTreasurySummary } from '@/lib/treasury';
import { ACCOUNT_TYPE_META, ACCOUNT_TYPES } from '@/lib/treasury-format';
import { formatUGX } from '@/lib/money';

/**
 * "Where the money is", on the staff dashboard, for the roles that see the
 * books: the three balances and their total, each linking to its page.
 */
export async function FundsStrip() {
  const s = await getTreasurySummary();
  if (!s) return null;

  return (
    <section aria-label="SACCO funds" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Link href="/staff/finance" className="card-interactive col-span-2 flex flex-col rounded-2xl bg-brand-gradient p-4 text-white shadow-brand md:col-span-1">
        <span className="flex items-center gap-2 text-label-md font-semibold text-primary-fixed-dim">
          <Icon name="wallet" size={16} />
          Total SACCO funds
        </span>
        <span className="tabular mt-1 text-[22px] font-bold leading-8">{formatUGX(s.totals.total)}</span>
      </Link>
      {ACCOUNT_TYPES.map((t) => (
        <Link key={t} href={ACCOUNT_TYPE_META[t].href} className="card-interactive flex flex-col rounded-2xl bg-surface p-4 shadow-neu">
          <span className="flex items-center gap-2 text-label-md font-semibold text-on-surface-variant">
            <Icon name={ACCOUNT_TYPE_META[t].icon} size={16} />
            {ACCOUNT_TYPE_META[t].label}
          </span>
          <span className="tabular mt-1 text-button-text font-bold text-on-surface">{formatUGX(s.totals[t])}</span>
        </Link>
      ))}
    </section>
  );
}
