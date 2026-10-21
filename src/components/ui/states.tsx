import { clsx } from '@/lib/clsx';
import { Icon } from './primitives';
import type { IconName } from '@/lib/icons';

/* ---------------------------------------------------------------------------
 * Empty state
 *
 * Never a bare blank area — on a slow connection a blank area is
 * indistinguishable from a screen that has not loaded. The disc behind the icon
 * is drawn from the surface tokens rather than fetched as an image, so an empty
 * screen costs no extra request and still reads as part of the surface.
 * ------------------------------------------------------------------------- */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-14',
        className,
      )}
    >
      <div className="relative mb-5 flex items-center justify-center">
        <span
          aria-hidden="true"
          className="bg-surface-container absolute h-20 w-20 rounded-full"
        />
        <span className="bg-surface-container-high text-on-surface-variant relative flex h-14 w-14 items-center justify-center rounded-full">
          <Icon name={icon} size={26} />
        </span>
      </div>
      <h3 className="text-title-md text-on-surface">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-body-md font-body-md text-on-surface-variant">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Error state
 *
 * Shows what failed and what to do, never the database's own words.
 * ------------------------------------------------------------------------- */
export function ErrorState({
  title = 'Unable to load this information',
  description = 'Please check your connection and try again.',
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={clsx(
        'bg-error-container/50 ring-error/15 flex flex-col items-center justify-center rounded-2xl px-6 py-12 text-center ring-1 ring-inset',
        className,
      )}
    >
      <div className="bg-error-container text-on-error-container mb-4 flex h-14 w-14 items-center justify-center rounded-full">
        <Icon name="cloud_off" size={26} />
      </div>
      <h3 className="text-title-md text-on-surface">{title}</h3>
      <p className="mt-1.5 max-w-sm text-body-md font-body-md text-on-surface-variant">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Inline alert — validation summaries and confirmation notices inside forms.
 * ------------------------------------------------------------------------- */
const ALERT_TONES = {
  error: { wrap: 'bg-error-container/60 text-on-error-container ring-error/20', icon: 'error' },
  success: {
    wrap: 'bg-tertiary-fixed text-on-tertiary-container ring-tertiary/20',
    icon: 'check_circle',
  },
  warning: {
    wrap: 'bg-warning-container/70 text-on-warning-container ring-warning/20',
    icon: 'warning',
  },
  info: { wrap: 'bg-primary-fixed text-on-primary-fixed-variant ring-primary/15', icon: 'info' },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof ALERT_TONES;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const t = ALERT_TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'flex items-start gap-3 rounded-2xl p-3.5 ring-1 ring-inset',
        t.wrap,
        className,
      )}
    >
      <Icon name={t.icon} size={19} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-button-text">{title}</p> : null}
        {children ? (
          <div className="break-words text-body-md font-body-md">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Skeletons
 *
 * Each one mirrors the real component's geometry so the page does not jump
 * when the data lands.
 * ------------------------------------------------------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

/** Matches the balance hero on the member dashboard. */
export function BalanceCardSkeleton() {
  return (
    <div className="h-36 rounded-2xl bg-surface-container-high p-5" aria-hidden="true">
      <Skeleton className="h-3.5 w-24 bg-white/50" />
      <Skeleton className="mt-4 h-8 w-48 bg-white/50" />
      <Skeleton className="mt-4 h-3 w-28 bg-white/50" />
    </div>
  );
}

/** Matches a row in the mobile transaction list. */
export function ListRowSkeleton() {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-neu-sm"
      aria-hidden="true"
    >
      <Skeleton className="h-11 w-11 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="mt-2 h-3 w-20" />
      </div>
      <div className="shrink-0 text-right">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="ml-auto mt-2 h-3 w-14" />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </div>
  );
}

/** Matches the desktop data table. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-surface shadow-neu"
      role="status"
    >
      <span className="sr-only">Loading…</span>
      <div className="flex gap-4 border-b border-outline-variant bg-surface-container-low p-4">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-outline-variant/70 p-4 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Matches the four-up stat row on the staff dashboard. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-gutter lg:grid-cols-4" role="status">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-2xl bg-surface p-5 shadow-neu"
        >
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="mt-6 h-3 w-20" />
          <Skeleton className="mt-2.5 h-7 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Matches a titled panel with a chart inside. */
export function PanelSkeleton({ height = 'h-64' }: { height?: string }) {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-surface shadow-neu"
      role="status"
    >
      <span className="sr-only">Loading…</span>
      <div className="border-b border-outline-variant/70 px-5 py-4">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className={clsx('p-5', height)}>
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}
