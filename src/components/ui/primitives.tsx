import Link from 'next/link';
import { clsx } from '@/lib/clsx';
import { formatUGX, formatCompactUGX } from '@/lib/money';
import { initials } from '@/lib/format';
import { Icon } from './icon';
import { ScrollRow } from './scroll';
import type { IconName } from '@/lib/icons';

/* `Icon` is defined in `./icon` so that this module and `./scroll` can both
 * use it without importing each other. It is re-exported here because it has
 * always been imported from `@/components/ui/primitives` and there is no
 * reason to touch fifty files to say the same thing differently. */
export { Icon };

/* ---------------------------------------------------------------------------
 * Money
 * ------------------------------------------------------------------------- */
export function Money({
  value,
  className,
  compact = false,
  sign = false,
  cents,
}: {
  value: unknown;
  className?: string;
  /** Renders "UGX 125.4M" with a small prefix, as the stat cards do. */
  compact?: boolean;
  sign?: boolean;
  cents?: boolean;
}) {
  if (compact) {
    const { prefix, amount } = formatCompactUGX(value);
    return (
      <span className={clsx('tabular flex items-baseline', className)}>
        <span className="mr-1.5 text-[0.6em] font-semibold opacity-60">{prefix}</span>
        {amount}
      </span>
    );
  }
  return <span className={clsx('tabular', className)}>{formatUGX(value, { sign, cents })}</span>;
}

/**
 * A signed amount that colours itself: green in, red out.
 *
 * The colour is doing real work here, so it is never applied to a figure whose
 * direction we do not actually know — pass an explicit `direction` rather than
 * inferring one from a formatting flag.
 */
export function SignedMoney({
  value,
  direction,
  className,
}: {
  value: unknown;
  direction: 'in' | 'out';
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'tabular font-semibold',
        direction === 'in' ? 'text-tertiary' : 'text-error',
        className,
      )}
    >
      {direction === 'in' ? '+' : '−'} {formatUGX(value)}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Card — the standard surface.
 *
 * Moulded out of the page rather than drawn on it: no border, and the paired
 * light/dark shadow does the separating. A border on top of that shadow draws
 * the same edge twice and flattens the card back into a box.
 * ------------------------------------------------------------------------- */
export function Card({
  children,
  className,
  as: As = 'div',
  padded = true,
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
  padded?: boolean;
  interactive?: boolean;
}) {
  return (
    <As
      className={clsx(
        'rounded-2xl bg-surface shadow-neu',
        padded && 'p-5',
        interactive && 'card-interactive',
        className,
      )}
    >
      {children}
    </As>
  );
}

/**
 * Card with a titled header rule — the default container for a named block
 * ("Recent Transactions", "Savings Overview").
 */
export function Panel({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
  bodyClassName,
  padded = true,
  id,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: IconName | string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
  /** Anchor target, for in-page jump navigation such as the settings screen. */
  id?: string;
}) {
  return (
    <section
      id={id}
      className={clsx('flex flex-col overflow-hidden rounded-2xl bg-surface shadow-neu', className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/70 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface text-primary shadow-neu-sm">
              <Icon name={icon} size={18} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="truncate text-title-md text-on-surface">{title}</h3>
            {subtitle ? (
              <p className="truncate text-label-md font-normal text-on-surface-variant">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={clsx(padded && 'p-5', 'min-w-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * KPI card — the executive metric tile.
 *
 * `delta` is rendered only when a real comparison exists. A dashboard that
 * always shows a green "+12%" teaches people to stop reading it.
 * ------------------------------------------------------------------------- */
export function KpiCard({
  icon,
  label,
  value,
  tone = 'neutral',
  delta,
  footnote,
  href,
  className,
}: {
  icon: IconName | string;
  label: string;
  value: React.ReactNode;
  /** Tints the icon chip only — the card itself stays white. */
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'accent';
  delta?: { value: number; label?: string } | null;
  footnote?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  // The chip is its own small raised object on the card, so a tile reads as
  // two moulded pieces rather than as a coloured square printed on a panel.
  const chip = {
    neutral: 'bg-surface-container-low text-on-surface-variant',
    primary: 'bg-primary-fixed text-primary',
    success: 'bg-tertiary-fixed text-tertiary',
    warning: 'bg-warning-container text-warning',
    danger: 'bg-error-container text-error',
    accent: 'bg-secondary-fixed text-on-secondary-fixed-variant',
  }[tone];

  const body = (
    <>
      <div className="mb-3 flex items-start justify-between gap-2 sm:mb-4">
        <span
          className={clsx(
            'flex h-9 w-9 items-center justify-center rounded-2xl shadow-neu-sm sm:h-10 sm:w-10',
            chip,
          )}
        >
          <Icon name={icon} size={19} />
        </span>
        {delta ? <DeltaPill value={delta.value} label={delta.label} /> : null}
      </div>
      <p className="text-label-md font-semibold text-on-surface-variant">{label}</p>
      {/* The figure steps down on a phone so a nine-digit total still fits a
          half-width card without truncating. */}
      <div className="mt-1 text-[24px] font-bold leading-8 tracking-tight text-on-surface sm:text-display-currency sm:font-display-currency">
        {value}
      </div>
      {footnote ? (
        <p className="mt-2 text-label-md font-normal text-on-surface-variant">{footnote}</p>
      ) : null}
      {href ? (
        <span className="mt-3 hidden items-center gap-1 text-label-md font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100 lg:inline-flex">
          View <Icon name="arrow_forward" size={14} />
        </span>
      ) : null}
    </>
  );

  const shell = clsx(
    'group flex flex-col rounded-2xl bg-surface p-4 shadow-neu sm:p-5',
    href && 'card-interactive',
    className,
  );

  return href ? (
    <Link href={href} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** The high-contrast counterpart to KpiCard — one per dashboard, at most. */
export function KpiCardFeature({
  icon,
  label,
  value,
  footnote,
  href,
  className,
}: {
  icon: IconName | string;
  label: string;
  value: React.ReactNode;
  footnote?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl"
      />
      <div className="relative z-10 mb-3 flex items-start justify-between sm:mb-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/15 text-white shadow-[inset_-2px_-2px_6px_rgba(255,255,255,0.18),inset_2px_2px_6px_rgba(4,15,35,0.35)] sm:h-10 sm:w-10">
          <Icon name={icon} size={19} />
        </span>
      </div>
      <p className="relative z-10 text-label-md font-semibold text-primary-fixed-dim">{label}</p>
      <div className="relative z-10 mt-1 text-[24px] font-bold leading-8 tracking-tight text-white sm:text-display-currency sm:font-display-currency">
        {value}
      </div>
      {footnote ? (
        <p className="relative z-10 mt-2 text-label-md font-normal text-primary-fixed-dim">
          {footnote}
        </p>
      ) : null}
    </>
  );

  const shell = clsx(
    'relative flex flex-col overflow-hidden rounded-2xl bg-brand-gradient p-4 shadow-brand sm:p-5',
    href && 'transition-transform duration-150 hover:-translate-y-px',
    className,
  );

  return href ? (
    <Link href={href} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** Month-on-month movement. Neutral grey at exactly zero — not green. */
export function DeltaPill({ value, label }: { value: number; label?: string }) {
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const tone = {
    up: 'bg-tertiary-fixed text-on-tertiary-container',
    down: 'bg-error-container text-on-error-container',
    flat: 'bg-surface-container-high text-on-surface-variant',
  }[dir];
  const icon = dir === 'up' ? 'trending_up' : dir === 'down' ? 'trending_down' : 'trending_flat';

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-label-sm shadow-neu-inset-sm',
        tone,
      )}
    >
      <Icon name={icon} size={13} />
      {value > 0 ? '+' : ''}
      {value}%{label ? <span className="font-normal opacity-80">{label}</span> : null}
    </span>
  );
}

/** The compact figure used in a strip of secondary metrics. */
export function MiniStat({
  label,
  value,
  tone,
  icon,
  href,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  icon?: IconName | string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-label-md font-semibold text-on-surface-variant">
        {icon ? <Icon name={icon} size={15} className="opacity-70" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className={clsx('mt-1 text-button-text font-bold tabular', tone ?? 'text-on-surface')}>
        {value}
      </div>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="min-w-0 rounded-xl px-2 py-1 transition-shadow hover:bg-surface hover:shadow-neu-sm"
    >
      {body}
    </Link>
  ) : (
    <div className="min-w-0">{body}</div>
  );
}

/* ---------------------------------------------------------------------------
 * Badge
 * ------------------------------------------------------------------------- */
const BADGE_TONES = {
  success: 'bg-tertiary-fixed text-on-tertiary-container ring-tertiary/20',
  neutral: 'bg-surface-container-high text-on-surface-variant ring-outline-variant',
  warning: 'bg-warning-container text-on-warning-container ring-warning/20',
  error: 'bg-error-container text-on-error-container ring-error/20',
  info: 'bg-primary-fixed text-on-primary-fixed-variant ring-primary/20',
  accent: 'bg-secondary-fixed text-on-secondary-fixed-variant ring-secondary/25',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  children,
  tone = 'neutral',
  className,
  dot = false,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
  /** Adds a leading status dot — used in tables where colour alone is thin. */
  dot?: boolean;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-label-sm ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" /> : null}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Avatar
 * ------------------------------------------------------------------------- */
export function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const dim = { width: size, height: size };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- sizes are known and
      // fixed; next/image's wrapper adds no value for a 40px avatar and costs
      // an extra optimisation round trip per row on a 500-row list.
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        style={dim}
        className={clsx('shrink-0 rounded-full object-cover shadow-neu-sm', className)}
      />
    );
  }

  return (
    <span
      style={{ ...dim, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-full bg-surface font-bold text-primary shadow-neu-sm',
        className,
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Section header — "Recent Transactions" + "View All".
 * ------------------------------------------------------------------------- */
export function SectionHeader({
  title,
  action,
  className,
  subtitle,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  subtitle?: string;
}) {
  return (
    <div className={clsx('mb-4 flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-title-md text-on-surface">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 text-label-md font-normal text-on-surface-variant">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** The "View all →" affordance, so it looks identical everywhere. */
export function ViewAllLink({ href, children = 'View all' }: { href: string; children?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-1 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
    >
      {children}
      <Icon name="arrow_forward" size={15} />
    </Link>
  );
}

/* ---------------------------------------------------------------------------
 * Progress bar
 * ------------------------------------------------------------------------- */
export function ProgressBar({
  value,
  tone = 'primary',
  label,
  className,
}: {
  /** 0-100. */
  value: number;
  tone?: 'primary' | 'tertiary' | 'error' | 'secondary';
  label?: string;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const fill = {
    primary: 'bg-primary',
    tertiary: 'bg-tertiary-container',
    error: 'bg-error',
    secondary: 'bg-secondary-container',
  }[tone];

  return (
    <div
      className={clsx(
        // A track is a groove in the page, and the fill sits in it.
        'h-2.5 w-full overflow-hidden rounded-full bg-surface-container shadow-neu-inset-sm',
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={clsx('h-full rounded-full transition-[width] duration-500', fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Page heading
 * ------------------------------------------------------------------------- */
export function PageTitle({
  title,
  subtitle,
  action,
  breadcrumb,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  icon?: IconName | string;
}) {
  return (
    <div className="mb-7">
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-label-md font-normal text-on-surface-variant">
            {breadcrumb.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 ? <Icon name="chevron_right" size={14} className="opacity-50" /> : null}
                {c.href ? (
                  <Link href={c.href} className="hover:text-primary hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-on-surface">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? (
            <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-primary shadow-neu sm:flex">
              <Icon name={icon} size={22} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface md:text-headline-lg md:font-headline-lg">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 text-body-md font-body-md text-on-surface-variant">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Definition row — the "label / value" pattern in profile and review screens.
 * ------------------------------------------------------------------------- */
export function DetailRow({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex items-start justify-between gap-4 border-b border-outline-variant/70 py-2.5 last:border-0',
        className,
      )}
    >
      <dt className="shrink-0 text-body-md font-body-md text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 text-right text-body-md font-semibold text-on-surface">
        {value ?? '—'}
      </dd>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Quick action tile
 * ------------------------------------------------------------------------- */
export function QuickAction({
  href,
  icon,
  label,
  tone = 'primary',
}: {
  href: string;
  icon: IconName | string;
  label: string;
  tone?: 'primary' | 'success' | 'accent' | 'danger' | 'neutral';
}) {
  const chip = {
    primary: 'bg-primary-fixed text-primary group-hover:bg-ink group-hover:text-white',
    success: 'bg-tertiary-fixed text-tertiary group-hover:bg-tertiary group-hover:text-on-tertiary',
    accent:
      'bg-secondary-fixed text-on-secondary-fixed-variant group-hover:bg-secondary-container group-hover:text-on-secondary-fixed',
    danger: 'bg-error-container text-error group-hover:bg-error group-hover:text-on-error',
    neutral:
      'bg-surface-container-high text-on-surface-variant group-hover:bg-on-surface-variant group-hover:text-surface',
  }[tone];

  return (
    <Link
      href={href}
      className="card-interactive group flex flex-col items-center gap-2.5 rounded-2xl bg-surface px-3 py-4 text-center shadow-neu"
    >
      <span
        className={clsx(
          'flex h-11 w-11 items-center justify-center rounded-2xl shadow-neu-sm transition-colors duration-150',
          chip,
        )}
      >
        <Icon name={icon} size={21} />
      </span>
      <span className="text-label-md font-semibold leading-tight text-on-surface">{label}</span>
    </Link>
  );
}

/* ---------------------------------------------------------------------------
 * Tabs — a segmented control that is a real list of links.
 * ------------------------------------------------------------------------- */
export function TabBar({
  items,
  className,
}: {
  items: { label: string; href: string; active: boolean; count?: number }[];
  className?: string;
}) {
  return (
    <nav className={clsx('min-w-0', className)} aria-label="Views">
      {/* Chip strips keep the scrollbar hidden: a 12px lane under a 44px row of
          pills takes a quarter of its height for a control the arrows already
          provide, and on a phone the strip is swiped anyway. */}
      <ScrollRow
        label="Views"
        wrapperClassName="-mx-container-margin-mobile md:mx-0"
        className="no-scrollbar flex gap-1 px-container-margin-mobile md:px-0"
      >
        {/* The strip is a groove and the chosen tab is the one pill standing
            out of it — the segmented control from the reference bar. */}
        <span className="inline-flex gap-1 rounded-full bg-surface-container p-1.5 shadow-neu-inset">
          {items.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              className={clsx(
                'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-button-text transition-[box-shadow,background-color,color]',
                t.active
                  ? 'bg-ink text-white shadow-neu-dark-sm'
                  : 'text-on-surface-variant hover:bg-surface hover:text-on-surface hover:shadow-neu-sm',
              )}
            >
              {t.label}
              {typeof t.count === 'number' ? (
                <span
                  className={clsx(
                    'rounded-full px-1.5 py-0.5 text-label-sm',
                    t.active ? 'bg-white/20' : 'bg-surface-container-high',
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </Link>
          ))}
        </span>
      </ScrollRow>
    </nav>
  );
}

/* ---------------------------------------------------------------------------
 * Data table
 *
 * A table is a table — it keeps real <table> semantics for screen readers and
 * for print. Callers render a card list at the same breakpoint where this
 * hides, rather than letting an eight-column grid scroll sideways on a phone.
 * ------------------------------------------------------------------------- */
export function DataTable({
  head,
  children,
  className,
  dense = false,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <div className={clsx('overflow-hidden rounded-2xl bg-surface shadow-neu', className)}>
      {/* Overlaid arrows rather than flanking ones: a register is tall, and a
          pair of full-height button columns either side would cost 70px of the
          width the columns are already fighting over. They stay invisible
          until the pointer is over the table. */}
      <ScrollRow arrows="overlay" label="Table, scrolls sideways">
        <table className="w-full min-w-full border-collapse text-left">
          <thead className="border-b border-outline-variant bg-surface-container-low">
            <tr
              className={clsx(
                '[&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:text-label-md [&>th]:font-semibold [&>th]:text-on-surface-variant',
                dense ? '[&>th]:py-2.5' : '[&>th]:py-3.5',
              )}
            >
              {head}
            </tr>
          </thead>
          <tbody
            className={clsx(
              '[&>tr]:border-b [&>tr]:border-outline-variant/70 [&>tr:last-child]:border-0',
              '[&>tr]:transition-colors hover:[&>tr]:bg-surface-container-low',
              '[&>tr>td]:px-4 [&>tr>td]:text-body-md [&>tr>td]:text-on-surface',
              dense ? '[&>tr>td]:py-2.5' : '[&>tr>td]:py-3.5',
            )}
          >
            {children}
          </tbody>
        </table>
      </ScrollRow>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Toolbar — the search + filters + action row above a table.
 * ------------------------------------------------------------------------- */
export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'mb-4 flex flex-wrap items-center gap-3 rounded-3xl bg-surface p-3 shadow-neu',
        className,
      )}
    >
      {children}
    </div>
  );
}
