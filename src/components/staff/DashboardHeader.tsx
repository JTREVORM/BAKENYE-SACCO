import Link from 'next/link';
import { Icon } from '@/components/ui/primitives';

/**
 * The top of every role dashboard: whose dashboard it is, named after the
 * role the person actually holds, and the way to the whole-SACCO overview.
 */
export function DashboardHeader({
  roleName,
  fullName,
  subtitle,
  showOverviewLink = true,
}: {
  roleName: string;
  fullName: string;
  subtitle: string;
  showOverviewLink?: boolean;
}) {
  const first = fullName.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <header className="bg-ink relative isolate overflow-hidden rounded-2xl p-6 text-white shadow-brand md:p-7">
      <div aria-hidden="true" className="bg-secondary-container/20 absolute -right-10 -top-10 h-40 w-40 rounded-full blur-2xl" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-secondary-container text-label-md font-semibold uppercase tracking-[0.14em]">
            {roleName} Dashboard
          </p>
          <h1 className="mt-1.5 text-[24px] font-bold leading-tight md:text-[28px]">Welcome back, {first}</h1>
          <p className="text-body-md mt-1 text-white/75">
            {today} · {subtitle}
          </p>
        </div>
        {showOverviewLink ? (
          <Link
            href="/staff"
            className="h-touch-target-min text-button-text inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-white/10 px-4 font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/20 md:self-auto"
          >
            <Icon name="insights" size={18} />
            SACCO overview
          </Link>
        ) : null}
      </div>
    </header>
  );
}
