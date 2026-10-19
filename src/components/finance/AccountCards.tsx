import Link from 'next/link';
import { Icon, Money } from '@/components/ui/primitives';
import { ACCOUNT_TYPE_META } from '@/lib/treasury-format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { FinanceAccountType } from '@/types/treasury';

/**
 * The three cards the finance dashboard is built around - where the money is.
 *
 * The balance is the one number on the card set large; the day's figures sit
 * underneath as a short, labelled list. A card whose kind of account has not
 * been set up says so and offers the way to set it up, rather than showing a
 * zero that reads as "the SACCO has no money at the bank".
 */
export function AccountTypeCard({
  type,
  balance,
  lines,
  accounts,
  setupHref,
}: {
  type: FinanceAccountType;
  balance: unknown;
  lines: { label: string; value: unknown; tone?: 'in' | 'out' | 'move' }[];
  /** How many accounts of this kind exist. Zero shows the set-up prompt. */
  accounts: number;
  setupHref?: string;
}) {
  const meta = ACCOUNT_TYPE_META[type];

  return (
    <section
      aria-labelledby={`card-${type}`}
      className="relative flex flex-col overflow-hidden rounded-2xl bg-surface p-5 shadow-neu"
    >
      <span aria-hidden="true" className={clsx('absolute inset-y-0 left-0 w-1.5', meta.stripe)} />

      <div className="flex items-start justify-between gap-3 pl-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary-fixed text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
            <Icon name={meta.icon} size={22} />
          </span>
          <div className="min-w-0">
            <h2 id={`card-${type}`} className="text-title-md text-on-surface">
              {meta.label}
            </h2>
            <p className="text-label-md font-normal text-on-surface-variant">{meta.subtitle}</p>
          </div>
        </div>
        <Link
          href={meta.href}
          aria-label={`Open ${meta.label}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-shadow hover:bg-surface hover:shadow-neu-sm active:shadow-neu-pressed"
        >
          <Icon name="chevron_right" size={20} />
        </Link>
      </div>

      {accounts === 0 ? (
        <div className="mt-5 flex flex-1 flex-col justify-between gap-4 pl-1.5">
          <p className="text-body-md text-on-surface-variant">
            No {meta.noun} has been set up yet, so nothing can be recorded against it.
          </p>
          {setupHref ? (
            <Link
              href={setupHref}
              className="bg-primary-fixed text-primary hover:bg-primary hover:text-on-primary inline-flex h-touch-target-min items-center gap-2 self-start rounded-full px-4 text-button-text font-semibold transition-colors"
            >
              <Icon name="add" size={18} />
              Set up a {meta.noun}
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-5 pl-1.5 text-label-md font-semibold text-on-surface-variant">
            Current balance
          </p>
          <Money
            value={balance}
            className={clsx(
              'block pl-1.5 text-[28px] font-bold leading-9 tracking-tight sm:text-[32px]',
              toNumber(balance) < 0 ? 'text-error' : 'text-on-surface',
            )}
          />

          <dl className="mt-4 divide-y divide-outline-variant/70 border-t border-outline-variant/70 pl-1.5">
            {lines.map((l) => (
              <div key={l.label} className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="text-body-md text-on-surface-variant">{l.label}</dt>
                <dd
                  className={clsx(
                    'tabular shrink-0 text-body-md font-semibold',
                    toNumber(l.value) === 0
                      ? 'text-on-surface-variant'
                      : l.tone === 'in'
                        ? 'text-tertiary'
                        : l.tone === 'out'
                          ? 'text-error'
                          : 'text-on-surface',
                  )}
                >
                  {formatUGX(l.value)}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

/**
 * Total SACCO funds - merchant plus bank plus cash, as the ledger has it.
 * The one high-contrast card on the page.
 */
export function TotalFundsCard({
  totals,
  asOf,
}: {
  totals: { merchant: unknown; bank: unknown; cash: unknown; total: unknown };
  asOf: string;
}) {
  const parts: { type: FinanceAccountType; value: unknown }[] = [
    { type: 'merchant', value: totals.merchant },
    { type: 'bank', value: totals.bank },
    { type: 'cash', value: totals.cash },
  ];

  return (
    <section
      aria-labelledby="total-funds"
      className="relative flex flex-col overflow-hidden rounded-2xl bg-brand-gradient p-5 text-white shadow-brand sm:p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"
      />
      <div className="relative z-10 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/20">
          <Icon name="wallet" size={22} />
        </span>
        <div>
          <h2 id="total-funds" className="text-title-md text-white">
            Total SACCO Funds
          </h2>
          <p className="text-label-md font-normal text-primary-fixed-dim">
            Merchant + Bank + Cash, from the ledger · as at {asOf}
          </p>
        </div>
      </div>

      <Money
        value={totals.total}
        className="relative z-10 mt-5 block text-[32px] font-bold leading-10 tracking-tight sm:text-[40px] sm:leading-[48px]"
      />

      <dl className="relative z-10 mt-5 grid grid-cols-1 gap-2 border-t border-white/15 pt-4 sm:grid-cols-3">
        {parts.map((p) => (
          <div key={p.type} className="flex items-baseline justify-between gap-2 sm:block">
            <dt className="text-label-md font-medium text-primary-fixed-dim">
              {ACCOUNT_TYPE_META[p.type].label}
            </dt>
            <dd className="tabular text-body-md font-semibold text-white">{formatUGX(p.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
