import { clsx } from '@/lib/clsx';
import { Icon } from './primitives';
import type { IconName } from '@/lib/icons';

/* ---------------------------------------------------------------------------
 * Empty state
 *
 * The brief's example: "No transactions yet / Your transactions will appear
 * here." Never a bare blank area — on a slow connection a blank area is
 * indistinguishable from a screen that has not loaded.
 * ------------------------------------------------------------------------- */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  className,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <div className="bg-surface-container-high text-on-surface-variant mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <Icon name={icon} size={28} />
      </div>
      <h3 className="text-button-text font-button-text text-on-surface">{title}</h3>
      {description ? (
        <p className="text-body-md font-body-md text-on-surface-variant mt-1 max-w-xs">
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
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <div className="bg-error-container text-on-error-container mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <Icon name="cloud_off" size={28} />
      </div>
      <h3 className="text-button-text font-button-text text-on-surface">{title}</h3>
      <p className="text-body-md font-body-md text-on-surface-variant mt-1 max-w-xs">
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
  error: { wrap: 'bg-error-container text-on-error-container', icon: 'error' },
  success: { wrap: 'bg-tertiary-fixed text-on-tertiary-fixed', icon: 'check_circle' },
  warning: { wrap: 'bg-secondary-fixed text-on-secondary-fixed', icon: 'warning' },
  info: { wrap: 'bg-primary-fixed text-on-primary-fixed', icon: 'info' },
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
      className={clsx('flex items-start gap-3 rounded-lg p-3', t.wrap, className)}
    >
      <Icon name={t.icon} size={20} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-button-text font-button-text">{title}</p> : null}
        {children ? (
          <div className="text-body-md font-body-md break-words">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Skeletons
 *
 * DESIGN.md requires a defined skeleton for every data-heavy component. Each
 * one mirrors the real component's geometry so the page does not jump when the
 * data lands.
 * ------------------------------------------------------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

/** Matches the balance hero on the member dashboard. */
export function BalanceCardSkeleton() {
  return (
    <div className="bg-surface-container-high elev-1 h-32 rounded-xl p-4" aria-hidden="true">
      <Skeleton className="h-4 w-24 bg-white/40" />
      <Skeleton className="mt-3 h-8 w-48 bg-white/40" />
      <Skeleton className="mt-4 h-3 w-28 bg-white/40" />
    </div>
  );
}

/** Matches a row in the mobile transaction list. */
export function ListRowSkeleton() {
  return (
    <div
      className="bg-surface border-surface-container elev-1 flex items-center gap-3 rounded-xl border p-3"
      aria-hidden="true"
    >
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-20" />
      </div>
      <div className="shrink-0 text-right">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-auto mt-2 h-3 w-14" />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
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
    <div className="bg-surface border-outline-variant/30 overflow-hidden rounded-xl border" role="status">
      <span className="sr-only">Loading…</span>
      <div className="border-outline-variant/50 bg-surface-container-low/50 flex gap-4 border-b p-4">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="border-outline-variant/30 flex gap-4 border-b p-4 last:border-0">
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
    <div className="gap-gutter grid grid-cols-2 lg:grid-cols-4" role="status">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-surface border-outline-variant/30 elev-1 rounded-xl border p-5">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="mt-6 h-3 w-20" />
          <Skeleton className="mt-2 h-7 w-28" />
        </div>
      ))}
    </div>
  );
}
