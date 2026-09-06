import { clsx } from '@/lib/clsx';
import { formatUGX, formatCompactUGX } from '@/lib/money';
import { initials } from '@/lib/format';
import type { IconName } from '@/lib/icons';

/* ---------------------------------------------------------------------------
 * Icon
 *
 * Stitch rendered icons as `<span class="material-symbols-outlined">name</span>`.
 * Same markup, plus `aria-hidden` because every icon in this app is paired with
 * a text label or an accessible name on its control.
 * ------------------------------------------------------------------------- */
export function Icon({
  name,
  className,
  size,
  filled = true,
}: {
  name: IconName | string;
  className?: string;
  /** px. The Stitch screens use the default 24, with 16/18/20 in dense spots. */
  size?: number;
  filled?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx('material-symbols-outlined select-none', className)}
      style={{
        ...(size ? { fontSize: `${size}px`, width: `${size}px`, height: `${size}px` } : null),
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
      }}
    >
      {name}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Money
 *
 * `display-currency` is the Stitch type role for balances: 32px/700 with tight
 * tracking so a long number reads as one visual unit.
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
  /** Renders "UGX 125.4M" with a small prefix, as the desktop stat cards do. */
  compact?: boolean;
  sign?: boolean;
  cents?: boolean;
}) {
  if (compact) {
    const { prefix, amount } = formatCompactUGX(value);
    return (
      <span className={clsx('tabular flex items-baseline', className)}>
        <span className="mr-1 text-sm font-normal opacity-70">{prefix}</span>
        {amount}
      </span>
    );
  }
  return <span className={clsx('tabular', className)}>{formatUGX(value, { sign, cents })}</span>;
}

/* ---------------------------------------------------------------------------
 * Card - the Level-1 surface from DESIGN.md
 * ------------------------------------------------------------------------- */
export function Card({
  children,
  className,
  as: As = 'div',
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
  padded?: boolean;
}) {
  return (
    <As
      className={clsx(
        'bg-surface border-outline-variant/30 elev-1 rounded-xl border',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </As>
  );
}

/* ---------------------------------------------------------------------------
 * Badge - the pill Stitch uses for Success/Pending on transaction rows.
 * ------------------------------------------------------------------------- */
const BADGE_TONES = {
  success: 'bg-tertiary-container/20 text-tertiary',
  neutral: 'bg-surface-variant text-on-surface-variant',
  warning: 'bg-secondary-container/40 text-on-secondary-container',
  error: 'bg-error-container text-on-error-container',
  info: 'bg-primary-fixed text-on-primary-fixed-variant',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Avatar - member photo with an initials fallback.
 *
 * Members without a photo are the common case at go-live, and a broken image
 * icon in a list of 500 people looks like a system fault. Initials on the
 * primary tint read as intentional.
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
        className={clsx(
          'border-outline-variant/50 shrink-0 rounded-full border object-cover',
          className,
        )}
      />
    );
  }

  return (
    <span
      style={{ ...dim, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      className={clsx(
        'bg-primary/10 text-primary flex shrink-0 items-center justify-center rounded-full font-bold',
        className,
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Section header - "Recent Transactions" + "View All", used on most screens.
 * ------------------------------------------------------------------------- */
export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('mb-3 flex items-center justify-between gap-3', className)}>
      <h3 className="text-button-text font-button-text text-on-surface">{title}</h3>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Progress bar - savings targets and loan repayment progress.
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
      className={clsx('bg-surface-container-highest h-2 w-full overflow-hidden rounded-full', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={clsx('h-full rounded-full transition-[width]', fill)} style={{ width: `${pct}%` }} />
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
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-headline-lg-mobile font-headline-lg-mobile md:text-headline-lg md:font-headline-lg text-primary tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Definition row - the "label / value" pattern in profile and review screens.
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
    <div className={clsx('flex items-start justify-between gap-4 py-2', className)}>
      <dt className="text-body-md font-body-md text-on-surface-variant shrink-0">{label}</dt>
      <dd className="text-body-md font-body-md text-on-surface min-w-0 text-right font-semibold">
        {value ?? '—'}
      </dd>
    </div>
  );
}
