import Link from 'next/link';
import type { Metadata } from 'next';
import { requireStaff } from '@/lib/auth';
import { getNotifications, getUnreadCount } from '@/lib/queries';
import { PageTitle, Icon } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { MarkAllRead } from '@/components/MarkAllRead';
import { formatAgo } from '@/lib/format';
import { clsx } from '@/lib/clsx';

export const metadata: Metadata = { title: 'Notifications' };

const TONE = {
  info: { wrap: 'bg-primary-fixed text-on-primary-fixed-variant', icon: 'info' },
  success: { wrap: 'bg-tertiary-container/20 text-tertiary', icon: 'check_circle' },
  warning: { wrap: 'bg-secondary-container/40 text-on-secondary-container', icon: 'warning' },
  error: { wrap: 'bg-error-container text-on-error-container', icon: 'error' },
} as const;

export default async function StaffNotificationsPage() {
  await requireStaff();
  const [items, unread] = await Promise.all([getNotifications(50), getUnreadCount()]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'You are all caught up.'}
        action={unread > 0 ? <MarkAllRead /> : undefined}
      />

      {items.length === 0 ? (
        <div className="bg-surface border-outline-variant rounded-xl border">
          <EmptyState
            icon="notifications"
            title="No notifications yet"
            description="System alerts and approvals awaiting you will appear here."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => {
            const tone = TONE[n.kind];
            const body = (
              <>
                <span
                  className={clsx(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
                    tone.wrap,
                  )}
                >
                  <Icon name={tone.icon} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-body-md font-body-md text-on-surface block font-semibold">
                    {n.title}
                  </span>
                  <span className="text-body-md font-body-md text-on-surface-variant mt-0.5 block">
                    {n.body}
                  </span>
                  <span className="text-label-md font-label-md text-on-surface-variant/70 mt-1 block normal-case">
                    {formatAgo(n.created_at)}
                  </span>
                </span>
              </>
            );

            const className = clsx(
              'flex items-start gap-3 rounded-xl border p-3 transition-colors',
              n.read_at ? 'bg-surface border-outline-variant' : 'bg-surface-container-low border-primary/30',
            );

            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className={clsx(className, 'hover:bg-surface-container')}>
                    {body}
                  </Link>
                ) : (
                  <div className={className}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
