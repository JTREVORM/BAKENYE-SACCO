import { KpiCard, KpiCardFeature, Money } from '@/components/ui/primitives';
import { getTreasurySummary } from '@/lib/treasury';
import { ACCOUNT_TYPE_META, ACCOUNT_TYPES } from '@/lib/treasury-format';
import { formatDate } from '@/lib/format';

/**
 * "Where the money is", on the staff dashboard, for the roles that see the
 * books: the three balances and their total, each linking to its page.
 *
 * The cards are the dashboard's own stat tiles, so this strip and the KPI row
 * above it are visibly one family. The caption under each figure is the date
 * the balance was computed at — `treasury_summary()` says so, and it is the one
 * honest thing to put there. No card carries a movement it has not measured.
 */
export async function FundsStrip({ fullAmounts = false }: { fullAmounts?: boolean } = {}) {
  const s = await getTreasurySummary();
  if (!s) return null;

  const asAt = `As at ${formatDate(s.as_of)}`;

  return (
    <section aria-label="SACCO funds" className="grid grid-cols-2 gap-3 sm:gap-gutter lg:grid-cols-4">
      <KpiCardFeature
        icon="wallet"
        label="Total SACCO funds"
        value={<Money value={s.totals.total} compact={!fullAmounts} />}
        footnote={asAt}
        href="/staff/finance"
      />
      {ACCOUNT_TYPES.map((t) => (
        <KpiCard
          key={t}
          icon={ACCOUNT_TYPE_META[t].icon}
          label={ACCOUNT_TYPE_META[t].label}
          value={<Money value={s.totals[t]} compact={!fullAmounts} />}
          footnote={asAt}
          tone={t === 'merchant' ? 'accent' : t === 'bank' ? 'primary' : 'success'}
          href={ACCOUNT_TYPE_META[t].href}
        />
      ))}
    </section>
  );
}
